/**
 * cli.ts — the hard-case loop (Lane A S63, pm109; design: mobile
 * sync-docs/reports/2026-09-27_s49-the-week-plan-and-the-hard-case-loop.md §3, placement and
 * CLI measurements: sync-docs/reports/2026-09-28_s50b-the-hard-case-loop-brief.md).
 *
 * WHY. The golden set and the nightly sweep re-test cases we already know. Every class
 * that has bitten Diego was new when it arrived (a count word over small branded pieces,
 * a fractional volume word, a misheard brand, a brand the rerank swaps). This loop looks
 * at what the app actually served and asks, cheaply, whether it is plausible.
 *
 * THREE SUBCOMMANDS
 *   observe    Mode O. READ-ONLY. MappingEventLog `noCache=false` traffic over a window,
 *              minus our own instruments' traffic (filters.ts), grouped by (line, record,
 *              grams), run through the Tier D bounds (tier-d.ts), then the judge on the
 *              rows Tier D passed plus a capped sample of the rows it flagged. MEL is
 *              winner-only: the judge rules on the row AS SERVED and never names a
 *              runner-up. This is the nightly job (ops/mac/adversary.sh).
 *   generate   Mode G. ON DEMAND ONLY. Lines in the hard shapes — a fixed `--seeds` list,
 *              or the generator's ≤ 40 — probed serially with a keyed `nosave=1` parse.
 *              nosave still writes a MappingEventLog row per item, bumps usedCount, and
 *              can CREATE LearnedSynonym, AiGeneratedFood and AiNormalizeCache rows; an
 *              AiGeneratedFood row is a record later requests can retrieve. So each run is
 *              bracketed by those four counts + /api/ok, aborts if the build changes, and
 *              records every probe in logs/adversary-probed.tsv so Mode O never mistakes
 *              it for traffic. Whether it runs nightly is Diego's call.
 *   calibrate  ROW 0. The 81 hand-labelled batch-01 rows (23 BAD / 10 SUSPECT / 48 GOOD,
 *              scripts/eval/__tests__/fixtures/correctness-screen-batch01.json) through
 *              THIS judge, per model and draw, in identical batches. It compares models
 *              on one harness; its numbers are NOT comparable with correctness-screen's
 *              22/23 and 0/48, which are the combined `--policy balanced --llm` screen,
 *              one row per call at temperature 0 (and the 0/48 is fitted; held-out 6/48).
 *              The CLI arm has no temperature control, so draws are reported separately.
 *
 * USAGE (repo root; the launchd wrapper passes absolute paths)
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register \
 *     scripts/eval/adversary/cli.ts observe [--since 'YYYY-MM-DD[ HH:MM]' --until '…' | --since-state]
 *       [--expect <melId,…>] [--trace <substring>] [--out <md>] [JUDGE FLAGS]
 *   … cli.ts generate (--seeds <tsv> | --count N) [--generate-only] [--nocache] [--days 7] [JUDGE FLAGS]
 *   … cli.ts calibrate [--models claude-sonnet-5,claude-sonnet-5-5] [--draws 2] [JUDGE FLAGS]
 *
 *   JUDGE FLAGS  --judge claude-cli|openrouter (default claude-cli) · --model <id> (default claude-sonnet-5, chosen by ROW 0)
 *                --rows-per-call 25 · --max-calls 8 · --max-rows 150 · --tierd-sample 8
 *                --budget-per-call 0.50 (USD, the CLI's --max-budget-usd) · --claude <path>
 *                --effort low|medium|high|xhigh|max (claude-cli only; default high — see DEFAULT_MODEL)
 *   Times are America/Los_Angeles. `--until` is exclusive.
 *
 * EXIT: 0 = ran, nothing flagged · 1 = ran, something flagged (a flag is not a verdict) ·
 * 2 = the run is not a result (refused preflight, box unreachable, judge unusable, build
 * changed mid-run). A run that judged nothing because nothing survived the filters is 0
 * and says so; a run whose every judge call failed is 2.
 *
 * NEVER: writes a golden case, knownIssue pin, punch row or FoodMapping row; evicts,
 * warms, deploys or flips a flag.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { tierD, type ParsedLine, type ServedItem } from './tier-d';
import {
    applyFilters, eventHours, formatLedgerRow, groupEvents, normLine, parseLedger, stamp,
    type EventGroup, type LedgerEntry, type MelEvent, type ProbeWindow,
} from './filters';
import {
    DEFAULT_EFFORT, DEFAULT_MODEL, generateLines, judgeRows, totals,
    type CallRecord, type JudgeArm, type JudgeConfig, type JudgeRow, type Verdict,
} from './judge';
import {
    apiOk, fetchMelBetweenUtc, fetchMelWindow, fetchSweepStrings, probeParse, readDevKey, tableCounts,
    type ApiOk, type TableCounts,
} from './box';
import { FLAG_IS_NOT_A_VERDICT, flagTable, table, usageTable, why, type Flag } from './report';

const REPO = path.resolve(__dirname, '..', '..', '..');
const HERE = __dirname;
const STATE_DIR = path.join(os.homedir(), '.adversary');
const LEDGER = path.join(REPO, 'logs', 'adversary-probed.tsv');
const LOG_DIR = path.join(REPO, 'logs', 'adversary');

class FlagError extends Error {}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const val = (f: string): string | undefined => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
function intFlag(f: string, dflt: number, min: number, max: number): number {
    const raw = val(f);
    if (raw === undefined) return dflt;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min || n > max) throw new FlagError(`${f} must be an integer in ${min}..${max}, got ${raw}`);
    return n;
}
function numFlag(f: string, dflt: number, min: number, max: number): number {
    const raw = val(f);
    if (raw === undefined) return dflt;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < min || n > max) throw new FlagError(`${f} must be a number in ${min}..${max}, got ${raw}`);
    return n;
}

/** `YYYY-MM-DD HH:MM:SS` in America/Los_Angeles. */
export function ptStamp(d: Date): string {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).map(x => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}
export function utcStamp(d: Date): string { return d.toISOString().replace('T', ' ').slice(0, 19); }
/** Shift a PT wall-clock stamp by whole days (calendar arithmetic; DST-exact to the day). */
export function ptShiftDays(pt: string, days: number): string {
    const d = new Date(`${stamp(pt).replace(' ', 'T')}Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return utcStamp(d);
}
function normalizeWhen(s: string): string {
    const t = s.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return `${t} 00:00:00`;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(t)) return `${t}:00`;
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(t)) return t;
    throw new FlagError(`not a PT time: ${s} (use YYYY-MM-DD or 'YYYY-MM-DD HH:MM')`);
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function judgeConfig(): JudgeConfig {
    const arm = (val('--judge') ?? 'claude-cli') as JudgeArm;
    if (arm !== 'claude-cli' && arm !== 'openrouter') throw new FlagError(`--judge must be claude-cli or openrouter, got ${arm}`);
    const cfg: JudgeConfig = {
        arm,
        model: val('--model') ?? DEFAULT_MODEL[arm],
        claudeBin: val('--claude') ?? path.join(os.homedir(), '.local', 'bin', 'claude'),
        cwd: STATE_DIR,
        rowsPerCall: intFlag('--rows-per-call', 25, 1, 60),
        maxCalls: intFlag('--max-calls', 8, 1, 40),
        budgetPerCallUsd: numFlag('--budget-per-call', 0.5, 0.01, 5),
        timeoutMs: 300_000,
        effort: arm === 'claude-cli' ? (val('--effort') ?? DEFAULT_EFFORT) : undefined,
    };
    if (cfg.effort && !['low', 'medium', 'high', 'xhigh', 'max'].includes(cfg.effort)) throw new FlagError(`--effort must be low|medium|high|xhigh|max, got ${cfg.effort}`);
    if (arm === 'openrouter') {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('dotenv').config({ path: path.join(REPO, '.env') });
        const apiKey = process.env.OPENROUTER_API_KEY;
        if (!apiKey) throw new FlagError('--judge openrouter needs OPENROUTER_API_KEY (backend .env)');
        cfg.openrouter = { apiKey, baseUrl: process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1' };
    }
    return cfg;
}

/**
 * The claude-cli arm bills the subscription only if nothing redirects it: any ANTHROPIC_*
 * variable would, so it is refused rather than inherited. `claude auth status` must read a
 * claude.ai login, and ~/.adversary must have no CLAUDE.md in it or above it.
 */
function preflightJudge(cfg: JudgeConfig): void {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    if (cfg.arm !== 'claude-cli') return;
    const anth = Object.keys(process.env).filter(k => k.startsWith('ANTHROPIC_'));
    if (anth.length) throw new FlagError(`refusing the claude-cli judge: ${anth.join(', ')} set (it would bill an API key, not the subscription)`);
    for (let d = STATE_DIR; ; d = path.dirname(d)) {
        if (fs.existsSync(path.join(d, 'CLAUDE.md'))) throw new FlagError(`refusing: ${d}/CLAUDE.md would load into every judge call`);
        if (path.dirname(d) === d) break;
    }
    const r = spawnSync(cfg.claudeBin, ['auth', 'status'], { cwd: STATE_DIR, encoding: 'utf8', timeout: 30_000 });
    let st: { loggedIn?: boolean; authMethod?: string } = {};
    try { st = JSON.parse(r.stdout || '{}'); } catch { /* handled below */ }
    if (r.status !== 0 || st.loggedIn !== true || st.authMethod !== 'claude.ai') {
        throw new FlagError(`claude auth status failed (exit ${r.status}, loggedIn ${st.loggedIn}, authMethod ${st.authMethod})`);
    }
}

/** Golden-set lines, coverage-corpus seeds and the warm corpus — our instruments' vocabulary. */
function loadScriptStrings(): Set<string> {
    const out = new Set<string>();
    const add = (s: unknown) => { if (typeof s === 'string' && s.trim()) out.add(normLine(s)); };
    const golden = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'eval', 'golden-set.json'), 'utf8')) as {
        nlp?: { item?: { rawText?: string; name?: string } }[]; search?: { query?: string }[];
    };
    for (const c of golden.nlp ?? []) { add(c.item?.rawText); add(c.item?.name); }
    for (const c of golden.search ?? []) add(c.query);
    for (const f of fs.readdirSync(path.join(REPO, 'scripts', 'eval')).filter(x => /^coverage-corpus.*\.tsv$/.test(x))) {
        const rows = fs.readFileSync(path.join(REPO, 'scripts', 'eval', f), 'utf8').split('\n').slice(1);
        for (const r of rows) add(r.split('\t')[2]);
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { assembleSeeds } = require('../warm-cache') as { assembleSeeds: () => string[] };
    for (const s of assembleSeeds()) add(s);
    return out;
}

function loadWindows(): ProbeWindow[] {
    return (JSON.parse(fs.readFileSync(path.join(HERE, 'lane-a-probe-windows.json'), 'utf8')) as { windows: ProbeWindow[] }).windows;
}
function loadLedger(): LedgerEntry[] {
    return fs.existsSync(LEDGER) ? parseLedger(fs.readFileSync(LEDGER, 'utf8')) : [];
}

let parser: ((l: string) => ParsedLine | null) | null = null;
/** The SHIPPED parser, lazy-required (it pulls the parse chain, which constructs a PrismaClient but never queries). */
function parseLine(line: string): ParsedLine | null {
    if (!parser) {
        if (!process.env.DATABASE_URL) process.env.DATABASE_URL = 'postgresql://adversary:unused@127.0.0.1:1/unused';
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const m = require('../../../src/lib/parse/ingredient-line') as { parseIngredientLine: (l: string) => ParsedLine | null };
        parser = m.parseIngredientLine;
    }
    try { return parser(line); } catch { return null; }
}

function writeOut(kind: string, mdText: string, json: unknown, outPath: string): void {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const tag = utcStamp(new Date()).replace(/[-: ]/g, '').slice(0, 13);
    fs.writeFileSync(path.join(LOG_DIR, `${tag}-${kind}.md`), mdText);
    fs.writeFileSync(path.join(LOG_DIR, `${tag}-${kind}.json`), JSON.stringify(json, null, 1));
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, mdText);
    console.log(`wrote ${outPath} and logs/adversary/${tag}-${kind}.{md,json}`);
}

function servedItem(line: string, e: { foodName: string | null; grams: number | null; totalKcal: number | null; servingTier: string | null }): ServedItem {
    return { rawLine: line, parsed: parseLine(line), foodName: e.foodName ?? '', grams: e.grams, kcal: e.totalKcal, tier: e.servingTier };
}
function kcal100(g: number | null, k: number | null): number | null {
    return g != null && g > 0 && k != null ? (k / g) * 100 : null;
}

// ---------------------------------------------------------------------------
// observe (Mode O)
// ---------------------------------------------------------------------------

async function observe(): Promise<number> {
    const cfg = judgeConfig();
    preflightJudge(cfg);
    const maxRows = intFlag('--max-rows', 150, 1, 1000);
    const sample = intFlag('--tierd-sample', 8, 0, 100);
    const now = new Date();
    const statePath = path.join(STATE_DIR, 'state.json');
    let sincePt: string;
    let untilPt: string;
    if (has('--since-state')) {
        untilPt = ptStamp(now);
        const floor = ptShiftDays(untilPt, -7);
        let last: string | null = null;
        try { last = (JSON.parse(fs.readFileSync(statePath, 'utf8')) as { lastUntilPt?: string }).lastUntilPt ?? null; } catch { /* first run */ }
        sincePt = last && last > floor ? last : (last ? floor : ptShiftDays(untilPt, -1));
    } else {
        sincePt = normalizeWhen(val('--since') ?? ptShiftDays(ptStamp(now), -1));
        untilPt = normalizeWhen(val('--until') ?? ptStamp(now));
    }

    const ok = await apiOk();
    const events = fetchMelWindow(sincePt, untilPt);
    const sweep = new Set(fetchSweepStrings(ptShiftDays(sincePt, -7), untilPt).map(normLine));
    const { kept, dropped } = applyFilters(events, {
        scriptStrings: loadScriptStrings(), sweepStrings: sweep, windows: loadWindows(), ledger: loadLedger(),
    });
    const groups = groupEvents(kept);

    interface G { g: EventGroup; item: ServedItem; hits: ReturnType<typeof tierD>; jid: string | null }
    const gs: G[] = groups.map(g => {
        const item = servedItem(g.rep.rawLine, g.rep);
        return { g, item, hits: g.rep.foodId ? tierD(item) : [], jid: null };
    });
    const byWeight = (a: G, b: G) => b.g.events.length - a.g.events.length || b.g.events[b.g.events.length - 1].pt.localeCompare(a.g.events[a.g.events.length - 1].pt);
    const withRecord = gs.filter(x => x.g.rep.foodId);
    const passed = withRecord.filter(x => !x.hits.length).sort(byWeight);
    const failed = withRecord.filter(x => x.hits.length).sort(byWeight);
    const sampled = failed.slice(0, Math.min(sample, maxRows));
    const toJudge = [...sampled, ...passed].slice(0, maxRows);
    const capDropped = [...sampled, ...passed].length - toJudge.length;
    toJudge.forEach((x, i) => { x.jid = `r${String(i + 1).padStart(3, '0')}`; });
    const rows: JudgeRow[] = toJudge.map(x => ({
        id: x.jid as string, line: x.g.rep.rawLine, record: x.g.rep.foodName ?? '', brand: x.g.rep.brandName ?? '',
        source: x.g.rep.source ?? '', foodId: x.g.rep.foodId ?? '', grams: x.g.rep.grams, kcal: x.g.rep.totalKcal,
        kcalPer100g: kcal100(x.g.rep.grams, x.g.rep.totalKcal), tier: x.g.rep.servingTier,
    }));
    const jr = rows.length ? await judgeRows(rows, cfg, path.join(HERE, 'judge.md')) : { verdicts: new Map<string, Verdict>(), calls: [] as CallRecord[], unjudged: [] as string[] };
    const t = totals(jr.calls);
    if (rows.length && t.failed === t.calls) {
        console.error(`every judge call failed (${t.calls}): ${jr.calls.map(c => c.error).join(' / ')}`);
    }

    const toFlag = (x: G): Flag => ({
        mode: 'O', ref: x.g.events.map(e => e.id).slice(0, 3).join(', ') + (x.g.events.length > 3 ? ` (+${x.g.events.length - 3})` : ''),
        line: x.g.rep.rawLine, hours: eventHours(x.g), tier: x.g.rep.servingTier, foodId: x.g.rep.foodId,
        foodName: x.g.rep.foodName, brand: x.g.rep.brandName, grams: x.g.rep.grams, kcal: x.g.rep.totalKcal,
        tierD: x.hits, verdict: x.jid ? jr.verdicts.get(x.jid) ?? null : null,
    });
    const flagged = gs.filter(x => x.hits.length || (x.jid && jr.verdicts.get(x.jid)?.verdict === 'BAD')).map(toFlag);
    const review = gs.filter(x => !x.hits.length && x.jid && jr.verdicts.get(x.jid)?.verdict === 'UNSURE').map(toFlag);
    const noRecord = gs.filter(x => !x.g.rep.foodId);

    // --expect / --trace: where did a named event go? (Acceptance evidence, never a hint to the judge.)
    const fateOf = (id: string): string => {
        const d = dropped.find(x => x.event.id === id);
        if (d) return `DROPPED (${d.reason}${d.by ? `: ${d.by}` : ''})`;
        const x = gs.find(y => y.g.events.some(e => e.id === id));
        if (!x) return events.some(e => e.id === id) ? 'read, not grouped (bug)' : 'NOT IN WINDOW';
        const f = flagged.find(ff => ff.line === x.g.rep.rawLine && ff.foodId === x.g.rep.foodId && ff.grams === x.g.rep.grams);
        return f ? `FLAGGED — ${why(f)}` : `kept, not flagged${x.jid ? ` (judge ${jr.verdicts.get(x.jid)?.verdict ?? '—'})` : ''}`;
    };
    const expectIds = (val('--expect') ?? '').split(',').map(s => s.trim()).filter(Boolean);
    const traceSub = val('--trace');
    const traced = traceSub ? events.filter(e => e.rawLine.toLowerCase().includes(traceSub.toLowerCase())) : [];

    const reasons = ['hour-04', 'lane-a-probe', 'adversary-probe', 'script-string', 'sweep-string'] as const;
    const out: string[] = [];
    out.push(`# Hard-case loop — Mode O (live traffic)`, '');
    out.push(`Ran ${ptStamp(now)} PDT · window **${sincePt} → ${untilPt}** PDT (\`noCache=false\`, non-sweep traffic — not "Diego's lines": MEL carries no user id) · box build \`${ok.buildId}\` · judge \`${cfg.arm} ${cfg.model}\``, '');
    out.push(`- events read: **${events.length}**; dropped: ${reasons.map(r => `${r} ${dropped.filter(d => d.reason === r).length}`).join(' · ')}; kept **${kept.length}** in **${groups.length}** groups (line × record × grams).`);
    out.push(`- Tier D flagged **${failed.length}** group(s); passed ${passed.length}; no record ${noRecord.length} (a no-match writes a row with no food; a vanished item writes none, so "vanished" is Mode G only).`);
    out.push(`- judged **${rows.length}** (${sampled.length} Tier-D-flagged sample + ${rows.length - sampled.length} Tier-D-passed; caps: rows ${maxRows}, calls ${cfg.maxCalls}, ${cfg.rowsPerCall}/call, $${cfg.budgetPerCallUsd}/call)`
        + `${capDropped ? `; **${capDropped} left unjudged by the row cap**` : ''}${jr.unjudged.length ? `; **${jr.unjudged.length} left unjudged by the call cap**` : ''}.`);
    out.push(`- judge verdicts: BAD ${[...jr.verdicts.values()].filter(v => v.verdict === 'BAD').length} · UNSURE ${[...jr.verdicts.values()].filter(v => v.verdict === 'UNSURE').length} · OK ${[...jr.verdicts.values()].filter(v => v.verdict === 'OK').length}; calls ${t.calls} (${t.failed} failed); tokens in ${t.input} + cache-write ${t.cacheCreation} + cache-read ${t.cacheRead}, out ${t.output}; notional $${t.costUsd.toFixed(4)}.`, '');
    out.push(`## Flags (${flagged.length})`, '', flagTable(flagged));
    out.push(`## For a human: judge UNSURE (${review.length})`, '', flagTable(review));
    const agree = sampled.map(x => [x.g.rep.rawLine, x.hits.map(h => h.rule).join(', '), jr.verdicts.get(x.jid as string)?.verdict ?? '—', jr.verdicts.get(x.jid as string)?.reason ?? '']);
    out.push(`## Tier-D flags the judge also saw (sample of ${sampled.length})`, '', table(['line', 'Tier D', 'judge', 'judge reason'], agree));
    if (expectIds.length) {
        out.push(`## Expected events`, '', table(['MEL id', 'fate'], expectIds.map(id => [id, fateOf(id)])));
    }
    if (traceSub) {
        out.push(`## Trace: events whose line contains "${traceSub}" (${traced.length})`, '',
            table(['MEL id', 'PDT', 'line', 'food', 'g', 'fate'], traced.map(e => [e.id, e.pt, e.rawLine, e.foodName ?? '', String(e.grams ?? ''), fateOf(e.id)])));
    }
    out.push(`## Lane A probe windows that dropped events`, '',
        table(['session', 'MEL id', 'PDT', 'line', 'g'], dropped.filter(d => d.reason === 'lane-a-probe').map(d => [d.by ?? '', d.event.id, d.event.pt, d.event.rawLine, String(d.event.grams ?? '')])));
    out.push(`## Judge calls`, '', usageTable(jr.calls));
    out.push(`---`, '', FLAG_IS_NOT_A_VERDICT, '');
    const mdText = out.join('\n');
    writeOut('observe', mdText, {
        ranAtPt: ptStamp(now), sincePt, untilPt, buildId: ok.buildId, judge: { arm: cfg.arm, model: cfg.model },
        counts: { events: events.length, kept: kept.length, groups: groups.length, tierDFlagged: failed.length, judged: rows.length },
        dropped: dropped.map(d => ({ id: d.event.id, pt: d.event.pt, line: d.event.rawLine, reason: d.reason, by: d.by })),
        flagged, review, calls: jr.calls, expect: expectIds.map(id => ({ id, fate: fateOf(id) })),
    }, val('--out') ?? path.join(REPO, 'sync-docs', 'adversary-latest.md'));
    for (const id of expectIds) console.log(`expect ${id}: ${fateOf(id)}`);
    console.log(`flags ${flagged.length} · review ${review.length} · judged ${rows.length} · calls ${t.calls} (${t.failed} failed)`);

    if (rows.length && t.failed === t.calls) return 2;
    if (has('--since-state')) fs.writeFileSync(statePath, JSON.stringify({ lastUntilPt: untilPt, at: ptStamp(new Date()) }, null, 1));
    return flagged.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// generate (Mode G)
// ---------------------------------------------------------------------------

interface SeedLine { line: string; foods: number; expect?: string; expectAxis?: string; shape?: string; mutationOf?: string | null }

/** `line \t foods \t expected verdict \t expected axis` — the last two optional. `#` comments. */
export function parseSeedTsv(text: string): SeedLine[] {
    return text.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim() && !l.startsWith('#')).map(l => {
        const [line, foods, expect, expectAxis] = l.split('\t');
        return { line: line.trim(), foods: Math.max(1, Number(foods) || 1), expect: expect?.trim() || undefined, expectAxis: expectAxis?.trim() || undefined };
    });
}

function countDelta(a: TableCounts, b: TableCounts): string[][] {
    const k: (keyof TableCounts)[] = ['mel', 'learnedSynonym', 'aiGeneratedFood', 'aiNormalizeCache', 'foodMapping'];
    return k.map(x => [x, String(a[x]), String(b[x]), String(Number(b[x]) - Number(a[x]))]);
}
function okRows(a: ApiOk, b: ApiOk): string[][] {
    const ps = [...new Set([...Object.keys(a.purposes), ...Object.keys(b.purposes)])].sort();
    return ps.map(p => {
        const x = a.purposes[p] ?? { responses: null, logicalSuccesses: null };
        const y = b.purposes[p] ?? { responses: null, logicalSuccesses: null };
        const d = (u: number | null, v: number | null) => (u == null || v == null ? '—' : String(v - u));
        return [p, `${x.responses ?? '—'} / ${x.logicalSuccesses ?? '—'}`, `${y.responses ?? '—'} / ${y.logicalSuccesses ?? '—'}`, `${d(x.responses, y.responses)} / ${d(x.logicalSuccesses, y.logicalSuccesses)}`];
    });
}

async function generate(): Promise<number> {
    const cfg = judgeConfig();
    preflightJudge(cfg);
    const maxLines = 40;
    const seedsPath = val('--seeds');
    const calls: CallRecord[] = [];
    let seeds: SeedLine[];
    if (seedsPath) {
        seeds = parseSeedTsv(fs.readFileSync(seedsPath, 'utf8'));
    } else {
        const n = intFlag('--count', 20, 1, maxLines);
        const days = intFlag('--days', 7, 1, 30);
        const untilPt = ptStamp(new Date());
        const sincePt = ptShiftDays(untilPt, -days);
        const evs = fetchMelWindow(sincePt, untilPt);
        const { kept } = applyFilters(evs, {
            scriptStrings: loadScriptStrings(), sweepStrings: new Set(fetchSweepStrings(sincePt, untilPt).map(normLine)),
            windows: loadWindows(), ledger: loadLedger(),
        });
        const sources = [...new Set(kept.map(e => e.rawLine))].slice(-30);
        const g = await generateLines(sources, n, cfg, path.join(HERE, 'generator.md'));
        calls.push(g.call);
        if (g.call.error) { console.error(`generator failed: ${g.call.error}`); return 2; }
        seeds = g.lines.map(l => ({ line: l.line, foods: l.foods, shape: l.shape, mutationOf: l.mutationOf }));
    }
    if (seeds.length > maxLines) throw new FlagError(`${seeds.length} lines; Mode G probes at most ${maxLines} per run`);
    if (has('--generate-only')) {
        const mdText = [`# Hard-case loop — Mode G lines (generate-only, NOT probed)`, '', `Ran ${ptStamp(new Date())} PDT · ${cfg.arm} ${cfg.model}`, '',
            table(['#', 'line', 'shape', 'foods', 'mutation of'], seeds.map((s, i) => [String(i + 1), s.line, s.shape ?? '', String(s.foods), s.mutationOf ?? ''])),
            `## Generator call`, '', usageTable(calls)].join('\n');
        writeOut('generated-lines', mdText, { seeds, calls }, val('--out') ?? path.join(LOG_DIR, 'generated-lines-latest.md'));
        return 0;
    }

    // Probes land noCache=false (or noCache=true under --nocache) exactly like traffic, so
    // they must never run in the sweep's hour or while a Lane A window holds the box: the
    // hold file is created BEFORE a MEL quiet-window check and removed after the all-clear.
    if (ptStamp(new Date()).slice(11, 13) === '04') throw new FlagError('refusing to probe in the 04:xx PDT flywheel hour');
    if (fs.existsSync(path.join(os.homedir(), '.adversary-hold'))) throw new FlagError('refusing to probe: ~/.adversary-hold exists (a Lane A window holds the box)');
    const nocache = has('--nocache');
    const key = readDevKey(path.join(REPO, '.env'));
    const ok0 = await apiOk(key);
    if (!ok0.buildId) throw new Error('/api/ok returned no buildId');
    if (ok0.authorized !== true) throw new Error('/api/ok says the key is not authorized — wrong DEV_API_KEY');
    const c0 = tableCounts();
    console.log(`bracket OPEN ${c0.at} build ${ok0.buildId}: MEL ${c0.mel} · LearnedSynonym ${c0.learnedSynonym} · AiGeneratedFood ${c0.aiGeneratedFood} · AiNormalizeCache ${c0.aiNormalizeCache} · FoodMapping ${c0.foodMapping}`);

    interface Probed { seed: SeedLine; startUtc: string; endUtc: string; res: Awaited<ReturnType<typeof probeParse>>; mel: MelEvent[]; foreign: MelEvent[] }
    const probed: Probed[] = [];
    let abort: string | null = null;
    fs.mkdirSync(path.dirname(LEDGER), { recursive: true });
    for (const seed of seeds) {
        const now = await apiOk();
        if (now.buildId !== ok0.buildId) { abort = `build changed mid-run: ${ok0.buildId} → ${now.buildId}`; break; }
        const start = new Date();
        const res = await probeParse(seed.line, key, nocache);
        const end = new Date(Date.now() + 2000);
        await sleep(1500);
        const window = fetchMelBetweenUtc(utcStamp(start), utcStamp(end));
        const nl = normLine(seed.line);
        const mine = window.filter(m => { const r = normLine(m.rawLine); return r === nl || nl.includes(r) || r.includes(nl); });
        const foreign = window.filter(m => !mine.includes(m));
        const entry: LedgerEntry = { line: seed.line, startUtc: utcStamp(start), endUtc: utcStamp(end), melRawLines: [...new Set(mine.map(m => m.rawLine))] };
        fs.appendFileSync(LEDGER, formatLedgerRow(entry));
        probed.push({ seed, startUtc: entry.startUtc, endUtc: entry.endUtc, res, mel: mine, foreign });
        console.log(`probe ${probed.length}/${seeds.length} ${res.status} ${res.ms} ms, ${res.items.length} item(s), ${mine.length} MEL row(s): ${seed.line}`);
    }
    const ok1 = await apiOk(key);
    const c1 = tableCounts();
    if (!abort && ok1.buildId !== ok0.buildId) abort = `build changed by close: ${ok0.buildId} → ${ok1.buildId}`;
    console.log(`bracket CLOSE ${c1.at}: MEL +${c1.mel - c0.mel} · LearnedSynonym +${c1.learnedSynonym - c0.learnedSynonym} · AiGeneratedFood +${c1.aiGeneratedFood - c0.aiGeneratedFood} · AiNormalizeCache +${c1.aiNormalizeCache - c0.aiNormalizeCache} · FoodMapping +${c1.foodMapping - c0.foodMapping}`);

    // One row per served item: the response item, with tier and grams from the MEL row it wrote
    // (a nosave response carries no servingTier). Matched by foodId, first unused row wins.
    interface Item { p: Probed; idx: number; foodId: string | null; foodName: string | null; brand: string | null; source: string | null; grams: number | null; kcal: number | null; tier: string | null; melLine: string; melId: string | null }
    const items: Item[] = [];
    for (const p of probed) {
        const used = new Set<string>();
        p.res.items.forEach((it, idx) => {
            const m = p.mel.find(r => !used.has(r.id) && r.foodId === it.foodId);
            if (m) used.add(m.id);
            items.push({
                p, idx, foodId: it.foodId, foodName: it.foodName, brand: it.brandName, source: it.source,
                grams: m?.grams ?? it.grams, kcal: m?.totalKcal ?? it.kcal, tier: m?.servingTier ?? null,
                melLine: m?.rawLine ?? p.seed.line, melId: m?.id ?? null,
            });
        });
    }
    const hitsOf = items.map(it => (it.foodId ? tierD(servedItem(it.melLine, { foodName: it.foodName, grams: it.grams, totalKcal: it.kcal, servingTier: it.tier })) : []));
    const rows: JudgeRow[] = items.map((it, i) => ({
        id: `p${String(i + 1).padStart(3, '0')}`, line: it.melLine === it.p.seed.line ? it.p.seed.line : `${it.p.seed.line}  [this item: "${it.melLine}"]`,
        record: it.foodName ?? '', brand: it.brand ?? '', source: it.source ?? '', foodId: it.foodId ?? '',
        grams: it.grams, kcal: it.kcal, kcalPer100g: kcal100(it.grams, it.kcal), tier: it.tier,
    })).filter((_, i) => items[i].foodId);
    const maxRows = intFlag('--max-rows', 150, 1, 1000);
    const jr = await judgeRows(rows.slice(0, maxRows), cfg, path.join(HERE, 'judge.md'));
    calls.push(...jr.calls);
    const rowIdOf = new Map(items.map((it, i) => [it, `p${String(i + 1).padStart(3, '0')}`]));

    const flags: Flag[] = [];
    const perLine = new Map<Probed, { flagged: boolean; verdicts: Verdict[]; hits: string[] }>();
    for (const p of probed) perLine.set(p, { flagged: false, verdicts: [], hits: [] });
    items.forEach((it, i) => {
        const v = jr.verdicts.get(rowIdOf.get(it) as string) ?? null;
        const hits = hitsOf[i];
        const agg = perLine.get(it.p)!;
        if (v) agg.verdicts.push(v);
        agg.hits.push(...hits.map(h => h.rule));
        if (hits.length || v?.verdict === 'BAD') {
            agg.flagged = true;
            flags.push({
                mode: 'G', ref: it.p.seed.line, line: it.melLine, hours: `${stamp(it.p.startUtc).slice(5, 16)} UTC`,
                tier: it.tier, foodId: it.foodId, foodName: it.foodName, brand: it.brand, grams: it.grams, kcal: it.kcal,
                tierD: hits, verdict: v,
            });
        }
    });
    for (const p of probed) {
        if (p.res.error || p.res.items.length < p.seed.foods) {
            perLine.get(p)!.flagged = true;
            flags.push({
                mode: 'G', ref: p.seed.line, line: p.seed.line, hours: `${stamp(p.startUtc).slice(5, 16)} UTC`, tier: null, foodId: null,
                foodName: null, brand: null, grams: null, kcal: null, tierD: [], verdict: null,
                vanished: p.res.error ? `probe failed: ${p.res.error}` : `asked for ${p.seed.foods} food(s), the response has ${p.res.items.length} item(s)`,
            });
        }
    }

    const expRows = probed.filter(p => p.seed.expect).map(p => {
        const agg = perLine.get(p)!;
        const worst = agg.verdicts.find(v => v.verdict === 'BAD') ?? agg.verdicts.find(v => v.verdict === 'UNSURE') ?? agg.verdicts[0];
        const got = agg.flagged ? (worst?.verdict === 'BAD' ? `BAD (${worst.axis})` : `flagged${agg.hits.length ? ` by ${[...new Set(agg.hits)].join(', ')}` : ''}${worst ? `; judge ${worst.verdict}` : ''}`)
            : (worst ? `${worst.verdict}${worst.axis !== 'none' ? ` (${worst.axis})` : ''}` : '—');
        const want = `${p.seed.expect}${p.seed.expectAxis ? ` (${p.seed.expectAxis})` : ''}`;
        const met = p.seed.expect === 'BAD' ? agg.flagged : p.seed.expect === 'UNSURE' ? (worst?.verdict === 'UNSURE' || agg.flagged) : !agg.flagged;
        return [p.seed.line, want, got, met ? 'met' : 'NOT met', worst?.reason ?? ''];
    });

    const t = totals(calls);
    const out: string[] = [];
    out.push(`# Hard-case loop — Mode G (generated hard cases, on demand)`, '');
    out.push(`Ran ${ptStamp(new Date())} PDT · ${seedsPath ? `fixed seed list \`${path.basename(seedsPath)}\`` : 'generator lines'} · box build \`${ok0.buildId}\` · judge \`${cfg.arm} ${cfg.model}\`${abort ? ` · **ABORTED: ${abort}**` : ''}`, '');
    out.push(`- probed **${probed.length}** of ${seeds.length} line(s), serially, keyed \`nosave=1\`${nocache ? '&`nocache=1` (COLD pipeline, not what a user is served)' : ' (warm: what a user is served)'}; ${items.length} item(s) served; ledger \`logs/adversary-probed.tsv\`.`);
    out.push(`- flags **${flags.length}** over ${[...perLine.values()].filter(x => x.flagged).length} line(s); judge calls ${t.calls} (${t.failed} failed).`, '');
    out.push(`## Bracket`, '', table(['table', 'open', 'close', 'Δ'], countDelta(c0, c1)));
    out.push(`\`/api/ok\` (keyed): build \`${ok0.buildId}\` → \`${ok1.buildId}\`; since ${ok0.since} → ${ok1.since}; pid ${ok0.pid} → ${ok1.pid}. Per purpose, responses / logicalSuccesses:`, '');
    out.push(table(['purpose', 'open', 'close', 'Δ'], okRows(ok0, ok1)));
    if (expRows.length) out.push(`## Expected verdicts`, '', table(['line', 'expected', 'got', '', 'judge reason'], expRows));
    out.push(`## Flags (${flags.length})`, '', flagTable(flags));
    out.push(`## Every probe`, '', table(['line', 'foods asked', 'items', 'ms', 'MEL rows', 'receipt', 'foreign MEL rows in window'],
        probed.map(p => [p.seed.line, String(p.seed.foods), String(p.res.items.length), String(p.res.ms), String(p.mel.length), p.res.receipt ?? '—', p.foreign.map(f => `${f.rawLine} (${f.id})`).join('; ')])));
    out.push(`## Every served item`, '', table(['line', 'item', 'food', 'g', 'kcal', 'tier', 'Tier D', 'judge'],
        items.map((it, i) => [it.p.seed.line, it.melLine, `${it.foodName ?? '—'} \`${it.foodId ?? '—'}\``, String(it.grams ?? '—'), String(it.kcal == null ? '—' : Math.round(it.kcal)), it.tier ?? '—',
            hitsOf[i].map(h => h.rule).join(', '), (() => { const v = jr.verdicts.get(rowIdOf.get(it) as string); return v ? `${v.verdict}${v.axis !== 'none' ? ` ${v.axis}` : ''}: ${v.reason}` : '—'; })()])));
    out.push(`## Model calls`, '', usageTable(calls));
    out.push(`---`, '', FLAG_IS_NOT_A_VERDICT, '');
    writeOut('generate', out.join('\n'), { seeds, probed: probed.map(p => ({ ...p, foreign: p.foreign.map(f => f.id) })), counts: { open: c0, close: c1 }, apiOk: { open: ok0, close: ok1 }, flags, calls, abort },
        val('--out') ?? path.join(REPO, 'sync-docs', 'adversary-latest-generated.md'));
    for (const r of expRows) console.log(`expect ${r[3]}: ${r[0]} — want ${r[1]}, got ${r[2]}`);
    if (abort) { console.error(abort); return 2; }
    if (rows.length && t.failed === t.calls) return 2;
    return flags.length ? 1 : 0;
}

// ---------------------------------------------------------------------------
// calibrate (ROW 0)
// ---------------------------------------------------------------------------

async function calibrate(): Promise<number> {
    const cfg0 = judgeConfig();
    preflightJudge(cfg0);
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const screen = require('../correctness-screen') as typeof import('../correctness-screen');
    const fixture = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'eval', '__tests__', 'fixtures', 'correctness-screen-batch01.json'), 'utf8')) as {
        rows: { verdict: 'GOOD' | 'SUSPECT' | 'BAD'; axes: string[]; row: import('../correctness-screen').ScreenRow }[];
    };
    const labels = new Map<string, string>();
    const rows: JudgeRow[] = fixture.rows.map((fr, i) => {
        const r = fr.row;
        const id = `r${String(i + 1).padStart(2, '0')}`;
        labels.set(id, fr.verdict);
        const sg = screen.realServing(r);
        const grams = r.real && !r.real.error ? r.real.grams : sg.grams;
        const p = r.per100g ?? {};
        const kcal = r.real && !r.real.error && r.real.kcal != null ? r.real.kcal : grams != null ? (Number(p.calories ?? 0) * grams) / 100 : null;
        return {
            id, line: r.seed ?? r.key, record: r.recname || r.mapfoodname, brand: r.recbrand || r.mapbrand, source: r.src, foodId: r.recid,
            grams, kcal, kcalPer100g: Number.isFinite(Number(p.calories)) ? Number(p.calories) : null, tier: r.real?.tier ?? null,
            extra: [`per 100 g: protein ${Number(p.protein ?? 0).toFixed(1)} g, carbs ${Number(p.carbs ?? 0).toFixed(1)} g, fat ${Number(p.fat ?? 0).toFixed(1)} g`],
        };
    });
    const dEvict = new Set<string>();
    const dAny = new Set<string>();
    fixture.rows.forEach((fr, i) => {
        const hits = screen.tierD(fr.row, 'balanced');
        const id = `r${String(i + 1).padStart(2, '0')}`;
        if (hits.some(h => h.severity === 'EVICT')) dEvict.add(id);
        if (hits.some(h => h.severity !== 'INFO')) dAny.add(id);
    });

    const models = (val('--models') ?? 'claude-sonnet-5,claude-sonnet-5-5').split(',').map(s => s.trim()).filter(Boolean);
    const draws = intFlag('--draws', 2, 1, 5);
    const per = intFlag('--rows-per-call', 27, 1, 81);
    const results: { model: string; draw: number; verdicts: Map<string, Verdict>; calls: CallRecord[] }[] = [];
    for (const model of models) {
        for (let d = 1; d <= draws; d++) {
            const cfg = { ...cfg0, model, rowsPerCall: per, maxCalls: Math.ceil(rows.length / per) };
            const jr = await judgeRows(rows, cfg, path.join(HERE, 'judge.md'));
            results.push({ model, draw: d, verdicts: jr.verdicts, calls: jr.calls });
            const tt = totals(jr.calls);
            console.log(`${model} draw ${d}: ${tt.calls} calls (${tt.failed} failed), in ${tt.input + tt.cacheCreation + tt.cacheRead} out ${tt.output}`);
        }
    }
    const tally = (pred: (id: string) => boolean) => {
        const c = { BAD: 0, SUSPECT: 0, GOOD: 0 } as Record<string, number>;
        for (const [id, l] of labels) if (pred(id)) c[l]++;
        return c;
    };
    const lab = tally(() => true);
    const hdr = ['model · draw', `BAD flagged /${lab.BAD}`, `BAD flagged+UNSURE /${lab.BAD}`, `SUSPECT flagged /${lab.SUSPECT}`, `SUSPECT +UNSURE /${lab.SUSPECT}`, `GOOD flagged /${lab.GOOD}`, `GOOD +UNSURE /${lab.GOOD}`, 'failed rows'];
    const judgeOnly = results.map(r => {
        const bad = tally(id => r.verdicts.get(id)?.verdict === 'BAD');
        const any = tally(id => r.verdicts.get(id)?.verdict !== 'OK');
        const failedRows = [...r.verdicts.values()].filter(v => v.error).length;
        return [`${r.model} · ${r.draw}`, String(bad.BAD), String(any.BAD), String(bad.SUSPECT), String(any.SUSPECT), String(bad.GOOD), String(any.GOOD), String(failedRows)];
    });
    const combined = results.map(r => {
        const ev = tally(id => dEvict.has(id) || r.verdicts.get(id)?.verdict === 'BAD');
        return [`${r.model} · ${r.draw}`, String(ev.BAD), String(ev.SUSPECT), String(ev.GOOD)];
    });
    const dOnly = tally(id => dEvict.has(id));
    const dAnyT = tally(id => dAny.has(id));
    const callRows = results.flatMap(r => r.calls.map((c, i) => [`${r.model} · ${r.draw}`, String(i + 1), String(c.rows), String(c.inputTokens + c.cacheCreationTokens + c.cacheReadTokens), String(c.outputTokens), c.costUsd == null ? '—' : `$${c.costUsd.toFixed(4)}`, `${(c.durationMs / 1000).toFixed(1)} s`, c.error ?? '']));
    const missesOf = (r: typeof results[number]) => [...labels].filter(([id, l]) => l === 'BAD' && r.verdicts.get(id)?.verdict !== 'BAD').map(([id]) => `${id} ${rows.find(x => x.id === id)?.line} → ${rows.find(x => x.id === id)?.record}`);
    const fpOf = (r: typeof results[number]) => [...labels].filter(([id, l]) => l === 'GOOD' && r.verdicts.get(id)?.verdict === 'BAD').map(([id]) => `${id} ${rows.find(x => x.id === id)?.line} → ${rows.find(x => x.id === id)?.record}: ${r.verdicts.get(id)?.reason}`);

    const out: string[] = [];
    out.push(`# Hard-case loop — ROW 0 calibration`, '');
    out.push(`Ran ${ptStamp(new Date())} PDT · ${rows.length} fixture rows (${lab.BAD} BAD / ${lab.SUSPECT} SUSPECT / ${lab.GOOD} GOOD) · arm \`${cfg0.arm}\`${cfg0.effort ? ` --effort ${cfg0.effort}` : ' (default effort)'} · ${per} rows per call, fixture order, identical across models · ${draws} draw(s) per model (the CLI has no temperature control).`, '');
    out.push(`"Flagged" = judge BAD. The line is the fixture's seed phrase with no amount, so the judge reads one ordinary serving at the row's billed anchor. NOT comparable with correctness-screen's 22/23 · 0/48 (combined \`--policy balanced --llm\`, one row per call, temperature 0; 0/48 is fitted, held-out 6/48).`, '');
    out.push(`## Judge alone`, '', table(hdr, judgeOnly));
    out.push(`## Combined with correctness-screen's Tier D (\`balanced\`, EVICT rules) — D-EVICT ∪ judge BAD`, '',
        `Tier D EVICT alone: BAD ${dOnly.BAD}/${lab.BAD}, SUSPECT ${dOnly.SUSPECT}/${lab.SUSPECT}, GOOD ${dOnly.GOOD}/${lab.GOOD}; any non-INFO rule: BAD ${dAnyT.BAD}, SUSPECT ${dAnyT.SUSPECT}, GOOD ${dAnyT.GOOD}. The fixture rows carry their real anchor (\`row.real\`), so D5/D6 judge it here.`, '',
        table(['model · draw', `BAD /${lab.BAD}`, `SUSPECT /${lab.SUSPECT}`, `GOOD /${lab.GOOD}`], combined));
    out.push(`## Calls (tokens per call; input = input + cache write + cache read)`, '', table(['model · draw', 'call', 'rows', 'input', 'output', 'notional $', 'time', 'error'], callRows));
    for (const r of results) {
        out.push(`### ${r.model} · draw ${r.draw}`, '', `BAD missed (${missesOf(r).length}):`, '', ...missesOf(r).map(s => `- ${s}`), '', `GOOD flagged BAD (${fpOf(r).length}):`, '', ...fpOf(r).map(s => `- ${s}`), '');
    }
    const mdText = out.join('\n');
    writeOut('calibrate', mdText, { models, draws, per, labels: Object.fromEntries(labels), results: results.map(r => ({ model: r.model, draw: r.draw, verdicts: Object.fromEntries(r.verdicts), calls: r.calls })) },
        val('--out') ?? path.join(LOG_DIR, 'calibrate-latest.md'));
    console.log(mdText.split('## Calls')[0]);
    return results.some(r => totals(r.calls).failed === r.calls.length) ? 2 : 0;
}

// ---------------------------------------------------------------------------

async function main(): Promise<number> {
    const cmd = argv[0];
    if (cmd === 'observe') return observe();
    if (cmd === 'generate') return generate();
    if (cmd === 'calibrate') return calibrate();
    console.error('usage: cli.ts observe|generate|calibrate [flags] — see the header of scripts/eval/adversary/cli.ts');
    return 2;
}

if (require.main === module) {
    main().then(code => process.exit(code)).catch(err => {
        console.error(err instanceof FlagError ? `REFUSED: ${err.message}` : err);
        process.exit(2);
    });
}
