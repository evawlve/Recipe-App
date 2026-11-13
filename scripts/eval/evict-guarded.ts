/**
 * evict-guarded.ts — the S63 §4.4 eviction protocol, in code.
 *
 * Diego, s454 chat 2026-11-09: "yes, cut the eviction wrapper now".
 *
 * Integrity and caps guard against ACCIDENTS (a branch checked out, a Syncthing
 * delivery), not against a session that edits these files. Warms, sweeps,
 * RULES_VERSION and §4.4's "the evict-after fix is LIVE" are NOT covered: the
 * caller owns them. A second run on one screen refuses at the dry run (the row
 * count moved): take a new screen; derived anchors are unsupported.
 *
 *   evict-guarded.sh --keys F --screen-snapshot F --reason TEXT [--execute]
 *
 * Steps (every refusal prints "REFUSING: <why>" and exits 2):
 *   a  parse args
 *   b  INTEGRITY: the row's files are byte-identical to origin/master
 *   c  refuse inside the 03:30-05:30 America/Los_Angeles blackout
 *   d  keys parse; at most MAX_KEYS_PER_RUN; no tab / CR / LF / '|' in a key
 *   e  refuse any key the triage corpus marks coldVerdict MISS
 *   f  Role A snapshot loads, is 15 min .. 24 h old, and is not under RUNS_ROOT
 *   g  take RUNS_ROOT/run.lock (released on every exit path)
 *   h  at most MAX_EXECUTE_RUNS_PER_DAY executes per LA date
 *   i  RUN dir: keys.json, reason.txt, roleA-screen.json (a COPY of Role A)
 *   j  dry run of _evict_rows.ts against the copy; non-zero refuses
 *   k  no --execute: log the dry run, exit 0
 *   l  fresh Role B snapshot; every key must be in it
 *   m  re-check blackout; log the execute row BEFORE spawning (a crashed or
 *      refused execute still spends one of the day's runs); execute
 *   n  _verify_evicted.ts on a separate connection
 *   o  log the result row
 *   p  print the box-ledger bullet and the rollback line; exit 0 only if verified
 */
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawnSync } from 'child_process';
import { loadSnapshot, parseKeysText, SUSPICIOUSLY_FRESH_MS } from './_evict_rows';

export const MAX_KEYS_PER_RUN = 5;
export const MAX_EXECUTE_RUNS_PER_DAY = 2;
export const RUNS_ROOT = '/Users/diego/dev/snapshots/evict-guarded';
const REPO = path.resolve(__dirname, '..', '..');
const TRIAGE_TSV = path.join(__dirname, 'triage-regression-corpus-2026-11-09.tsv');
const USAGE = 'usage: evict-guarded.sh --keys <keys.json> --screen-snapshot <RoleA.json> --reason "<10-300 chars>" [--execute]';

export const RUN_COLUMNS = [
    'utc', 'laDate', 'hhmmss', 'mode', 'keyCount', 'keys', 'reason',
    'roleA', 'roleASha256', 'roleB', 'deleted', 'after', 'verify',
] as const;

// ---------------------------------------------------------------------------
// Pure guards (scripts/eval/__tests__/evict-guarded.test.ts)
// ---------------------------------------------------------------------------

export type GuardedArgs =
    | { ok: true; keys: string; screenSnapshot: string; reason: string; execute: boolean }
    | { ok: false; reason: string };

export function parseGuardedArgs(argv: string[]): GuardedArgs {
    const fail = (why: string): GuardedArgs => ({ ok: false, reason: `${why}. ${USAGE}` });
    const vals: Record<string, string> = {};
    let execute = false;
    let sawExecute = false;
    const named = ['--keys', '--screen-snapshot', '--reason'];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--execute') {
            if (sawExecute) return fail('--execute given twice');
            sawExecute = true;
            execute = true;
            continue;
        }
        if (named.includes(a)) {
            if (a in vals) return fail(`${a} given twice`);
            const v = argv[i + 1];
            if (v === undefined || v === '' || v.startsWith('-')) return fail(`${a} requires a value`);
            vals[a] = v;
            i++;
            continue;
        }
        if (a.startsWith('-')) return fail(`unknown flag ${JSON.stringify(a)}`);
        return fail(`unexpected positional ${JSON.stringify(a)}`);
    }
    for (const n of named) if (!(n in vals)) return fail(`missing ${n}`);
    const reason = vals['--reason'];
    if (reason.length < 10 || reason.length > 300) return fail('--reason must be 10 to 300 characters');
    if (/[\t\r\n]/.test(reason)) return fail('--reason must not contain a tab, CR or LF');
    return { ok: true, keys: vals['--keys'], screenSnapshot: vals['--screen-snapshot'], reason, execute };
}

export function laClock(now: Date): { date: string; hhmm: string; hhmmss: string } {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Los_Angeles', hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(now);
    const p: Record<string, string> = {};
    for (const x of parts) p[x.type] = x.value;
    return {
        date: `${p.year}-${p.month}-${p.day}`,
        hhmm: `${p.hour}:${p.minute}`,
        hhmmss: `${p.hour}${p.minute}${p.second}`,
    };
}

/** 03:30 <= LA time < 05:30 — the nightly sweep / flywheel window. */
export function inBlackout(now: Date): boolean {
    const { hhmm } = laClock(now);
    return hhmm >= '03:30' && hhmm < '05:30';
}

export function keyRefusal(keys: string[]): string | null {
    if (keys.length > MAX_KEYS_PER_RUN) return `${keys.length} keys exceeds MAX_KEYS_PER_RUN (${MAX_KEYS_PER_RUN})`;
    const bad = keys.find(k => /[\t\r\n|]/.test(k));
    if (bad !== undefined) return `key ${JSON.stringify(bad)} contains a tab, CR, LF or '|'`;
    return null;
}

export function dailyCapRefusal(executedCount: number): string | null {
    return executedCount >= MAX_EXECUTE_RUNS_PER_DAY
        ? `${executedCount} execute run(s) already logged today; the cap is ${MAX_EXECUTE_RUNS_PER_DAY} per LA day`
        : null;
}

function tsvColumns(tsvText: string, needed: string[]): { idx: number[]; rows: string[][] } {
    const lines = tsvText.split(/\r?\n/).filter(l => l !== '');
    if (lines.length === 0) throw new Error('TSV is empty (no header)');
    const header = lines[0].split('\t');
    const idx = needed.map(n => header.indexOf(n));
    const missing = needed.filter((_, i) => idx[i] < 0);
    if (missing.length) throw new Error(`TSV header lacks column(s): ${missing.join(', ')}`);
    const rows = lines.slice(1).map((l, i) => {
        const cells = l.split('\t');
        if (cells.length !== header.length) {
            throw new Error(`TSV row ${i + 2} has ${cells.length} cells, header has ${header.length}`);
        }
        return cells;
    });
    return { idx, rows };
}

/** Keys the triage corpus marks coldVerdict MISS (cache rows masking a cold defect). */
export function triageRefusals(keys: string[], tsvText: string): { key: string; id: string }[] {
    const { idx: [iId, iKey, iVerdict], rows } = tsvColumns(tsvText, ['id', 'key', 'coldVerdict']);
    const wanted = new Set(keys);
    const out: { key: string; id: string }[] = [];
    for (const r of rows) {
        if (r[iVerdict] === 'MISS' && wanted.has(r[iKey])) out.push({ key: r[iKey], id: r[iId] });
    }
    return out;
}

export function roleARefusal(takenAt: string, now: Date): string | null {
    const t = new Date(takenAt);
    if (Number.isNaN(t.getTime())) return `Role A snapshot takenAt ${JSON.stringify(takenAt)} is unparseable`;
    const age = now.getTime() - t.getTime();
    if (age < 0) return `Role A snapshot takenAt ${takenAt} is in the future`;
    if (age > 24 * 3_600_000) return `Role A snapshot is ${(age / 3_600_000).toFixed(1)} h old (limit 24 h)`;
    if (age < SUSPICIOUSLY_FRESH_MS) {
        return `Role A snapshot is only ${(age / 60_000).toFixed(1)} min old: almost certainly a fresh Role B file fed to the wrong flag`;
    }
    return null;
}

/** Count 'execute' rows for one LA date. Missing file is the caller's 0; a bad file THROWS. */
export function executedToday(runsTsvText: string, laDate: string): number {
    const { idx: [iDate, iMode], rows } = tsvColumns(runsTsvText, ['laDate', 'mode']);
    return rows.filter(r => r[iMode] === 'execute' && r[iDate] === laDate).length;
}

export function parseDeleted(text: string): { deleted: number; after: number } | null {
    const m = /DELETED (\d+) row\(s\)\. FoodMapping now (\d+) rows\./.exec(text);
    return m ? { deleted: Number(m[1]), after: Number(m[2]) } : null;
}

// ---------------------------------------------------------------------------
// Impure helpers
// ---------------------------------------------------------------------------

const TS_NODE = ['ts-node', '--project', 'tsconfig.scripts.json', '--transpile-only', '-r', 'tsconfig-paths/register'];

function git(args: string[]): number {
    return spawnSync('git', args, { cwd: REPO, encoding: 'utf8' }).status ?? 1;
}

function runChild(runDir: string, step: string, file: string, args: string[]): { status: number; out: string } {
    const r = spawnSync('npx', [...TS_NODE, file, ...args], { cwd: REPO, encoding: 'utf8' });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    fs.writeFileSync(path.join(runDir, `${step}.txt`), out);
    process.stdout.write(out);
    return { status: r.status ?? 1, out };
}

function appendRun(file: string, row: Record<string, string | number>, now: Date): void {
    const clock = laClock(now);
    const full: Record<string, string | number> = { utc: now.toISOString(), laDate: clock.date, hhmmss: clock.hhmmss, ...row };
    const exists = fs.existsSync(file);
    const fd = fs.openSync(file, 'a');
    try {
        if (!exists) fs.writeSync(fd, RUN_COLUMNS.join('\t') + '\n');
        fs.writeSync(fd, RUN_COLUMNS.map(c => String(full[c] ?? '')).join('\t') + '\n');
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
}

function refuse(why: string): number {
    console.error(`REFUSING: ${why}`);
    return 2;
}

function rollbackLine(roleB: string, keysJson: string): string {
    return `cd /Users/diego/dev/Recipe-App && npx ${TS_NODE.join(' ')} scripts/eval/_restore_rows.ts ${roleB} ${keysJson} --execute`;
}

const INTEGRITY_FILES = [
    'scripts/eval/triage-regression-corpus-2026-11-09.tsv',
    'scripts/eval/evict-guarded.sh',
    'scripts/eval/evict-guarded.ts',
    'scripts/eval/_verify_evicted.ts',
    'scripts/eval/__tests__/evict-guarded.test.ts',
    'scripts/eval/_evict_rows.ts',
    'scripts/eval/_snap_foodmapping.ts',
    'scripts/eval/_restore_rows.ts',
];

async function main(): Promise<number> {
    const now = new Date();
    const args = parseGuardedArgs(process.argv.slice(2));
    if (!args.ok) return refuse(args.reason);

    for (const p of new Set(INTEGRITY_FILES)) {
        if (git(['cat-file', '-e', `origin/master:${p}`]) !== 0 || git(['diff', '--quiet', 'origin/master', '--', p]) !== 0) {
            return refuse(`${p} is not merged origin/master content`);
        }
    }

    if (inBlackout(now)) return refuse('inside the 03:30-05:30 America/Los_Angeles blackout (nightly sweep window)');

    let keysText: string;
    try { keysText = fs.readFileSync(args.keys, 'utf8'); } catch (e) {
        return refuse(`cannot read keys file ${args.keys}: ${(e as Error).message}`);
    }
    const parsedKeys = parseKeysText(keysText);
    if (!parsedKeys.ok) return refuse(parsedKeys.reason);
    const keys = parsedKeys.keys;
    const kr = keyRefusal(keys);
    if (kr) return refuse(kr);

    let hits: { key: string; id: string }[];
    try { hits = triageRefusals(keys, fs.readFileSync(TRIAGE_TSV, 'utf8')); } catch (e) {
        return refuse(`triage corpus unreadable: ${(e as Error).message}`);
    }
    if (hits.length) {
        return refuse(`triage corpus marks coldVerdict MISS: ${hits.map(h => `${h.id} ${JSON.stringify(h.key)}`).join(', ')}`);
    }

    const snap = loadSnapshot(args.screenSnapshot);
    if (!snap.ok) return refuse(snap.reason);
    const ar = roleARefusal(snap.snap.takenAt, now);
    if (ar) return refuse(ar);
    let realA: string;
    try { realA = fs.realpathSync(args.screenSnapshot); } catch (e) {
        return refuse(`cannot resolve ${args.screenSnapshot}: ${(e as Error).message}`);
    }
    if (realA === RUNS_ROOT || realA.startsWith(RUNS_ROOT + path.sep)) {
        return refuse(`Role A snapshot ${realA} is under ${RUNS_ROOT}: derived anchors are unsupported`);
    }

    fs.mkdirSync(RUNS_ROOT, { recursive: true });
    const lock = path.join(RUNS_ROOT, 'run.lock');
    try { fs.mkdirSync(lock); } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EEXIST') {
            return refuse(`${lock} exists; remove only after reading the newest RUN dir`);
        }
        return refuse(`cannot take ${lock}: ${(e as Error).message}`);
    }
    try {
        return await locked(args, keys, realA, now);
    } finally {
        try { fs.rmdirSync(lock); } catch { /* already gone */ }
    }
}

async function locked(
    args: Extract<GuardedArgs, { ok: true }>,
    keys: string[],
    realA: string,
    now: Date,
): Promise<number> {
    const runsFile = path.join(RUNS_ROOT, 'runs.tsv');
    let count: number;
    try {
        count = fs.existsSync(runsFile) ? executedToday(fs.readFileSync(runsFile, 'utf8'), laClock(now).date) : 0;
    } catch (e) {
        return refuse(`runs.tsv unreadable: ${(e as Error).message}`);
    }
    const cap = dailyCapRefusal(count);
    if (cap) return refuse(cap);

    const clock = laClock(now);
    const runDir = path.join(RUNS_ROOT, clock.date, clock.hhmmss);
    fs.mkdirSync(runDir, { recursive: true });
    const keysJson = path.join(runDir, 'keys.json');
    const roleACopy = path.join(runDir, 'roleA-screen.json');
    fs.writeFileSync(keysJson, JSON.stringify(keys));
    fs.writeFileSync(path.join(runDir, 'reason.txt'), args.reason + '\n');
    fs.copyFileSync(realA, roleACopy);
    const sha = crypto.createHash('sha256').update(fs.readFileSync(roleACopy)).digest('hex');
    const base = { keyCount: keys.length, keys: keys.join('|'), reason: args.reason, roleA: realA, roleASha256: sha };

    const dry = runChild(runDir, 'dry-run', 'scripts/eval/_evict_rows.ts', [keysJson, '--screen-snapshot', roleACopy]);
    if (dry.status !== 0) return refuse(`dry run exited ${dry.status}; see ${path.join(runDir, 'dry-run.txt')}`);
    if (!args.execute) {
        appendRun(runsFile, { ...base, mode: 'dry' }, now);
        console.log('DRY RUN OK');
        return 0;
    }

    const roleB = path.join(runDir, 'FoodMapping-pre-execute.json');
    const snapB = runChild(runDir, 'snap-pre-execute', 'scripts/eval/_snap_foodmapping.ts', [roleB]);
    if (snapB.status !== 0) return refuse(`Role B snapshot exited ${snapB.status}`);
    const loadedB = loadSnapshot(roleB);
    if (!loadedB.ok) return refuse(`Role B snapshot: ${loadedB.reason}`);
    const inB = new Set(loadedB.snap.rows.map(r => r.normalizedForm));
    const absent = keys.filter(k => !inB.has(k));
    if (absent.length) return refuse(`key(s) not in the Role B snapshot: ${absent.join(' | ')}`);

    if (inBlackout(new Date())) return refuse('entered the 03:30-05:30 America/Los_Angeles blackout during the run');
    const rb = rollbackLine(roleB, keysJson);
    const execNow = new Date();
    appendRun(runsFile, { ...base, mode: 'execute', roleB, deleted: '?', after: '?', verify: '?' }, execNow);
    let code = 2;
    try {
        const ex = runChild(runDir, 'execute', 'scripts/eval/_evict_rows.ts', [keysJson, '--screen-snapshot', roleACopy, '--execute']);
        const del = parseDeleted(ex.out);
        if (ex.status !== 0 || !del) {
            appendRun(runsFile, { ...base, mode: 'execute-result', roleB, deleted: '?', after: '?', verify: 'FAIL' }, new Date());
            console.error(`REFUSING: execute exited ${ex.status} / DELETED line ${del ? 'found' : 'missing'}; check the DB by hand`);
            return 2;
        }
        const ver = runChild(runDir, 'verify', 'scripts/eval/_verify_evicted.ts', [keysJson, '--expect-count', String(del.after)]);
        const ok = ver.status === 0;
        appendRun(runsFile, { ...base, mode: 'execute-result', roleB, deleted: del.deleted, after: del.after, verify: ok ? 'OK' : 'FAIL' }, new Date());
        console.log(`\nbox-ledger bullet:\n- ${clock.date} ${clock.hhmmss} LA eviction: ${del.deleted} row(s) (${keys.join(' | ')}); reason: ${args.reason}; FoodMapping now ${del.after}; verify ${ok ? 'OK' : 'FAIL'}; run dir ${runDir}`);
        code = ok ? 0 : 2;
        return code;
    } finally {
        console.log(`\nROLLBACK: ${rb}`);
    }
}

if (require.main === module) {
    main()
        .then(c => process.exit(c))
        .catch(e => { console.error(e); process.exit(2); });
}
