/**
 * _evict_rows.ts — delete screened-bad rows from FoodMapping.
 *
 * DRY RUN BY DEFAULT. Pass --execute to actually delete.
 *
 * TWO SNAPSHOT ROLES — the same _snap_foodmapping.ts output plays two different
 * jobs, and feeding the wrong file to the wrong script silently voids a guard:
 *
 *   Role A — SCREEN snapshot (verdict anchor). Taken when the audit/screen ran;
 *     it holds the rows the verdicts were issued AGAINST. The identity guard in
 *     THIS script is only meaningful against Role A: it asks "is the live row
 *     still the row the screen judged?". Feed it a snapshot taken seconds ago
 *     and the check is vacuously green — live trivially matches itself — and
 *     the guard proves NOTHING about screen-time state.
 *   Role B — FRESH pre-execute snapshot (restore anchor). Re-taken immediately
 *     before any --execute (handoff §2b). _restore_rows.ts restores from THIS
 *     file, because it holds the rows exactly as they were the moment before
 *     deletion. It must NEVER be passed to --screen-snapshot.
 *
 * The five-step procedure (also in _snap_foodmapping.ts / _restore_rows.ts):
 *   1. screen/audit runs; _snap_foodmapping.ts -> S_screen   (Role A)
 *   2. THIS script, dry run:   _evict_rows.ts <keys> --screen-snapshot S_screen
 *   3. immediately before execute: _snap_foodmapping.ts -> S_fresh  (Role B)
 *   4. THIS script, execute:   _evict_rows.ts <keys> --screen-snapshot S_screen --execute
 *   5. rollback if needed:     _restore_rows.ts S_fresh <keys> --execute
 *
 * The snapshot argument is therefore a NAMED flag (--screen-snapshot), and a
 * bare positional snapshot path REFUSES: a positional cannot say which role the
 * file is playing, and the failure mode (operator hands over the fresh Role-B
 * file, guard goes vacuously green) is invisible at run time. This deliberately
 * breaks the CLI documented in handoff_cache_audit_2026-07-27.md §1(a).
 *
 * Safety properties, in order of importance:
 *  1. Refuses to run without a snapshot file that CONTAINS every key being deleted.
 *     A delete you cannot undo is not a delete, it is data loss.
 *  2. Refuses if the live row count no longer matches the snapshot.
 *  3. Refuses if ANY evict-list key's live identity no longer matches its snapshot
 *     row. The count check alone is FAIL-OPEN (playbook §11 class B): on 2026-07-27
 *     the 04:35 flywheel-sweep updated 305 rows IN PLACE — count unchanged, guard
 *     green — while the evict-set key "and ben jerry" had been fully re-resolved to
 *     a DIFFERENT food. Deleting it would have destroyed a verdict-less row: the
 *     screen judged the OLD mapping, not the one now live. So every key in the
 *     evict list is content-checked against the snapshot, and on ANY mismatch the
 *     ENTIRE run refuses and prints every moved key. The operator re-cuts the list;
 *     this script never skips-and-continues.
 *  4. Prints what it will do and requires --execute to do it.
 *
 * Identity fields compared: source, foodName, brandName, offBarcode, fdcId, fsId,
 * validatedBy. (FoodMapping has no single `foodId` column — its record pointer is
 * the per-source trio offBarcode/fdcId/fsId; foodName/brandName are included
 * because they are the identity the screen's record card actually judged.)
 * Deliberately NOT compared: usedCount / lastUsedAt / validatedAt / updatedAt /
 * aiConfidence — traffic counters and re-validation timestamps move on every hit,
 * and a guard that refuses on heartbeat noise is a guard nobody can ever run.
 * Rows OUTSIDE the evict list may change in place without refusal: their verdicts
 * are not being acted on.
 *
 * Exit codes: 0 = ok (dry run or executed), 2 = refused / error.
 *
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register \
 *     scripts/eval/_evict_rows.ts <keys.json> --screen-snapshot <screen-time-snapshot.json> [--execute]
 */
import 'dotenv/config';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// Pure, unit-testable guards (scripts/eval/__tests__/cache-ops-guards.test.ts).
// Nothing below this block until main() touches the database.
// ---------------------------------------------------------------------------

export const IDENTITY_FIELDS = [
    'source', 'foodName', 'brandName', 'offBarcode', 'fdcId', 'fsId', 'validatedBy',
] as const;
export type IdentityField = (typeof IDENTITY_FIELDS)[number];
export type Identity = Record<IdentityField, string | number | null>;

export interface SnapshotRow {
    normalizedForm: string;
    [k: string]: unknown;
}
export interface Snapshot {
    count: number;
    takenAt: string;
    rows: SnapshotRow[];
}

export type ParseResult =
    | { ok: true; snap: Snapshot }
    | { ok: false; reason: string };

export interface MovedKey { key: string; diffs: string[] }

export type GuardVerdict =
    | { ok: true }
    | { ok: false; reasons: string[]; movedKeys: MovedKey[] };

/** undefined and null are the same absence; everything else must match exactly. */
function norm(v: unknown): string | number | null {
    return v === undefined || v === null ? null : (v as string | number);
}

export function identityOf(row: Record<string, unknown>): Identity {
    const id = {} as Identity;
    for (const f of IDENTITY_FIELDS) id[f] = norm(row[f]);
    return id;
}

/**
 * Parse + validate the evict-keys file. Refuses anything that is not a
 * non-empty array of strings — a truncated or wrong-shaped keys file must not
 * quietly become "evict nothing" (that is how a broken instrument reads as a
 * clean run).
 */
export function parseKeysText(text: string): { ok: true; keys: string[] } | { ok: false; reason: string } {
    if (!text.trim()) return { ok: false, reason: 'keys file is EMPTY' };
    let raw: unknown;
    try { raw = JSON.parse(text); } catch (e) {
        return { ok: false, reason: `keys file is not parseable JSON (truncated?): ${(e as Error).message}` };
    }
    if (!Array.isArray(raw) || raw.length === 0) {
        return { ok: false, reason: 'keys file must be a non-empty JSON array of strings' };
    }
    if (!raw.every(k => typeof k === 'string' && k.trim() !== '')) {
        return { ok: false, reason: 'keys file contains non-string or empty entries' };
    }
    return { ok: true, keys: raw as string[] };
}

/**
 * Parse + validate a snapshot file's text. An empty, truncated, or internally
 * inconsistent snapshot must REFUSE, never read as "0 rows, nothing to check":
 * the snapshot is the entire rollback path, and a rollback path that parses to
 * nothing is data loss wearing a green light.
 */
export function parseSnapshotText(text: string): ParseResult {
    if (!text.trim()) return { ok: false, reason: 'snapshot file is EMPTY' };
    let raw: unknown;
    try { raw = JSON.parse(text); } catch (e) {
        return { ok: false, reason: `snapshot is not parseable JSON (truncated file?): ${(e as Error).message}` };
    }
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        return { ok: false, reason: 'snapshot is not an object with {count, takenAt, rows}' };
    }
    const snap = raw as Partial<Snapshot>;
    if (typeof snap.count !== 'number' || !Array.isArray(snap.rows)) {
        return { ok: false, reason: 'snapshot lacks a numeric `count` or a `rows` array' };
    }
    if (snap.rows.length !== snap.count) {
        return {
            ok: false,
            reason: `snapshot is internally inconsistent: count=${snap.count} but rows.length=${snap.rows.length} (partial write?)`,
        };
    }
    if (snap.rows.length === 0) return { ok: false, reason: 'snapshot contains ZERO rows' };
    if (!snap.rows.every(r => typeof (r as SnapshotRow).normalizedForm === 'string')) {
        return { ok: false, reason: 'snapshot rows are missing `normalizedForm`' };
    }
    return { ok: true, snap: snap as Snapshot };
}

/** Read + parse a snapshot from disk; an unreadable file is a refusal, not a crash. */
export function loadSnapshot(path: string): ParseResult {
    let text: string;
    try { text = fs.readFileSync(path, 'utf8'); } catch (e) {
        return { ok: false, reason: `cannot read snapshot file ${path}: ${(e as Error).message}` };
    }
    return parseSnapshotText(text);
}

/**
 * The population guard. Pure: the caller supplies the live count and the live
 * identity of every evict-list key that still exists.
 *
 *   (1) every evict key must be restorable from the snapshot;
 *   (2) the live row count must equal the snapshot count;
 *   (3) every evict key's live identity must equal its snapshot identity —
 *       a key missing live is a mismatch too (deleted or re-keyed since the
 *       snapshot; there is nothing left that the screen's verdict describes).
 *
 * ANY mismatch refuses the entire run and names every moved key.
 */
export function evictGuard(
    keys: string[],
    snap: Snapshot,
    liveCount: number,
    liveByKey: Map<string, Record<string, unknown>>,
): GuardVerdict {
    const reasons: string[] = [];
    const movedKeys: MovedKey[] = [];

    const snapByKey = new Map(snap.rows.map(r => [r.normalizedForm, r]));

    // (1) every key must be restorable from the snapshot
    const unbacked = keys.filter(k => !snapByKey.has(k));
    if (unbacked.length) {
        reasons.push(
            `${unbacked.length} key(s) are not in the snapshot and could not be restored — `
            + `e.g. ${unbacked.slice(0, 5).join(' | ')}`,
        );
    }

    // (2) the population must not have grown or shrunk since the screen ran
    if (liveCount !== snap.count) {
        reasons.push(
            `FoodMapping now has ${liveCount} rows, snapshot has ${snap.count}. `
            + 'The cache changed after the screen ran, so these verdicts describe a different population. '
            + 'Re-snapshot and re-screen.',
        );
    }

    // (3) per-key CONTENT check — the part the count cannot see. 305 rows moved
    // in place under an unchanged count on 2026-07-27; a verdict follows the row
    // it was issued against, not the key.
    for (const key of keys) {
        const snapRow = snapByKey.get(key);
        if (!snapRow) continue; // already refused in (1)
        const liveRow = liveByKey.get(key);
        if (!liveRow) {
            movedKeys.push({ key, diffs: ['row no longer exists live (deleted or re-keyed since the snapshot)'] });
            continue;
        }
        const a = identityOf(snapRow);
        const b = identityOf(liveRow);
        const diffs = IDENTITY_FIELDS
            .filter(f => a[f] !== b[f])
            .map(f => `${f}: snapshot ${JSON.stringify(a[f])} -> live ${JSON.stringify(b[f])}`);
        if (diffs.length) movedKeys.push({ key, diffs });
    }
    if (movedKeys.length) {
        reasons.push(
            `${movedKeys.length} evict-list key(s) have MOVED since the snapshot (identity fields changed under an `
            + 'unchanged or checked count). The screen judged the OLD row, not what is live now. '
            + 'Re-snapshot, re-screen, and re-cut the list.',
        );
    }

    return reasons.length ? { ok: false, reasons, movedKeys } : { ok: true };
}

// ---------------------------------------------------------------------------
// CLI argument parsing — pure and testable, because the refusal it implements
// (a role-ambiguous positional snapshot) is itself a guard.
// ---------------------------------------------------------------------------

export const EVICT_USAGE =
    'usage: _evict_rows.ts <keys.json> --screen-snapshot <screen-time-snapshot.json> [--execute]';

export type EvictCliParse =
    | { ok: true; keysPath: string; screenSnapshotPath: string; execute: boolean }
    | { ok: false; reason: string };

/**
 * The snapshot is a NAMED argument because the file plays one of two roles
 * (see header) and a positional cannot state which. A second positional is
 * refused, never guessed at: the old CLI shape is exactly how an operator
 * hands the FRESH restore-anchor snapshot to the verdict guard.
 */
export function parseEvictArgs(argv: string[]): EvictCliParse {
    let execute = false;
    let screenSnapshotPath: string | undefined;
    const positionals: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--execute') { execute = true; continue; }
        if (a === '--screen-snapshot') {
            if (screenSnapshotPath !== undefined) {
                return { ok: false, reason: `--screen-snapshot given twice. ${EVICT_USAGE}` };
            }
            const v = argv[i + 1];
            if (!v || v.startsWith('--')) {
                return { ok: false, reason: `--screen-snapshot requires a file path. ${EVICT_USAGE}` };
            }
            screenSnapshotPath = v;
            i++;
            continue;
        }
        if (a.startsWith('--')) {
            // An unrecognised flag must refuse, not fall through as a positional:
            // "--screen-snapshit typo silently ignored" is a class-B hole.
            return { ok: false, reason: `unknown flag ${JSON.stringify(a)}. ${EVICT_USAGE}` };
        }
        positionals.push(a);
    }
    if (positionals.length > 1) {
        return {
            ok: false,
            reason: [
                `REFUSING a bare positional snapshot path (${JSON.stringify(positionals[1])}): this argument cannot`,
                'say which ROLE the file plays. The identity guard is only meaningful against the AT-SCREEN-TIME',
                'snapshot the audit verdicts were derived from (Role A). If this file is the FRESH pre-execute',
                'snapshot (Role B, the restore anchor for _restore_rows.ts), the guard would be vacuously green —',
                'live trivially matches a snapshot taken seconds ago — and would prove nothing about screen-time',
                'state. Re-run naming the role explicitly:',
                `  ${EVICT_USAGE}`,
            ].join('\n'),
        };
    }
    if (positionals.length === 0) return { ok: false, reason: EVICT_USAGE };
    if (!screenSnapshotPath) {
        return {
            ok: false,
            reason: `missing --screen-snapshot <file>: the guard needs the AT-SCREEN-TIME snapshot (Role A). ${EVICT_USAGE}`,
        };
    }
    return { ok: true, keysPath: positionals[0], screenSnapshotPath, execute };
}

/** Age warning threshold: a screen snapshot younger than this is almost certainly the wrong file. */
export const SUSPICIOUSLY_FRESH_MS = 15 * 60 * 1000;

/**
 * The run-start banner: names the file anchoring the verdicts, its role, its
 * age, and which step of the five-step procedure this run is. Pure so the
 * fresh-file warning is testable.
 */
export function snapshotRoleBanner(opts: {
    screenSnapshotPath: string;
    takenAt: string;
    execute: boolean;
    now: Date;
}): string[] {
    const lines: string[] = [];
    const taken = new Date(opts.takenAt);
    const ageMs = Number.isNaN(taken.getTime()) ? null : opts.now.getTime() - taken.getTime();
    const ageText = ageMs === null
        ? `taken ${JSON.stringify(opts.takenAt)} (unparseable date — check this file by hand)`
        : `taken ${opts.takenAt} (${(ageMs / 3_600_000).toFixed(1)} h before this run)`;

    lines.push('======================================================================');
    lines.push('SNAPSHOT ROLES — this run anchors its verdicts to:');
    lines.push(`  verdict anchor (Role A, --screen-snapshot): ${opts.screenSnapshotPath}`);
    lines.push(`    ${ageText}`);
    lines.push('    This must be the AT-SCREEN-TIME snapshot the audit verdicts were');
    lines.push('    derived from — NOT the fresh pre-execute snapshot (Role B).');
    if (ageMs !== null && ageMs < SUSPICIOUSLY_FRESH_MS) {
        lines.push(`    WARNING: this snapshot is only ${(ageMs / 60_000).toFixed(1)} min old. A screen takes time;`);
        lines.push('    a minutes-old file is almost certainly the FRESH restore-anchor snapshot');
        lines.push('    fed to the wrong flag — the identity guard would be vacuously green.');
        lines.push('    STOP unless you know why this file is this fresh.');
    }
    lines.push(opts.execute
        ? '  procedure step: 4 of 5 (EXECUTE). Step 3 — a FRESH pre-execute snapshot'
        : '  procedure step: 2 of 5 (DRY RUN). Before any --execute, take a FRESH');
    lines.push(opts.execute
        ? '    (_snap_foodmapping.ts) — must ALREADY exist; it is the restore anchor'
        : '    snapshot (_snap_foodmapping.ts); that file is the restore anchor');
    lines.push('    for _restore_rows.ts and must NOT be passed to --screen-snapshot.');
    lines.push('======================================================================');
    return lines;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
    const cli = parseEvictArgs(process.argv.slice(2));
    if (!cli.ok) {
        console.error(`REFUSING: ${cli.reason}`);
        return 2;
    }
    const { keysPath, screenSnapshotPath: snapPath, execute } = cli;

    let keysText: string;
    try { keysText = fs.readFileSync(keysPath, 'utf8'); } catch (e) {
        console.error(`REFUSING: cannot read keys file ${keysPath}: ${(e as Error).message}`);
        return 2;
    }
    const parsedKeys = parseKeysText(keysText);
    if (!parsedKeys.ok) {
        console.error(`REFUSING: ${parsedKeys.reason}`);
        return 2;
    }
    const keys = parsedKeys.keys;

    const parsedSnap = loadSnapshot(snapPath);
    if (!parsedSnap.ok) {
        console.error(`REFUSING: ${parsedSnap.reason}`);
        return 2;
    }
    const snap = parsedSnap.snap;

    // Prominent, first thing on the console: which file anchors the verdicts,
    // what role it must be playing, and where the operator is in the procedure.
    for (const line of snapshotRoleBanner({
        screenSnapshotPath: snapPath,
        takenAt: snap.takenAt,
        execute,
        now: new Date(),
    })) console.log(line);

    const prisma = new PrismaClient();
    try {
        const live = await prisma.foodMapping.count();
        const liveRows = await prisma.foodMapping.findMany({
            where: { normalizedForm: { in: keys } },
            select: {
                normalizedForm: true, source: true, foodName: true, brandName: true,
                offBarcode: true, fdcId: true, fsId: true, validatedBy: true,
            },
        });
        const liveByKey = new Map<string, Record<string, unknown>>(liveRows.map(r => [r.normalizedForm, r]));

        const verdict = evictGuard(keys, snap, live, liveByKey);
        if (!verdict.ok) {
            for (const r of verdict.reasons) console.error(`REFUSING: ${r}`);
            // Print EVERY moved key — the operator re-cuts the list from this output.
            for (const m of verdict.movedKeys) {
                console.error(`  MOVED ${JSON.stringify(m.key)}`);
                for (const d of m.diffs) console.error(`        ${d}`);
            }
            return 2;
        }

        console.log(`snapshot   : ${snap.count} rows, taken ${snap.takenAt}`);
        console.log(`live       : ${live} rows`);
        console.log(`to evict   : ${keys.length} key(s), ${liveByKey.size} currently present`);
        console.log(`identity   : all ${keys.length} key(s) verified unchanged since the snapshot`);
        console.log(`remaining  : ${live - liveByKey.size} rows after eviction`);

        if (!execute) {
            console.log('\nDRY RUN — nothing deleted. Re-run with --execute to apply.');
            return 0;
        }

        const res = await prisma.foodMapping.deleteMany({ where: { normalizedForm: { in: keys } } });
        const after = await prisma.foodMapping.count();
        console.log(`\nDELETED ${res.count} row(s). FoodMapping now ${after} rows.`);
        console.log(
            `Restore with: _restore_rows.ts <FRESH-pre-execute-snapshot.json> ${keysPath} — `
            + 'the restore anchor is the Role-B snapshot taken at step 3, '
            + `NOT the screen snapshot (${snapPath}) this guard ran against.`,
        );
        return 0;
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    main()
        .then(c => process.exit(c))
        .catch(e => { console.error(e); process.exit(2); });
}
