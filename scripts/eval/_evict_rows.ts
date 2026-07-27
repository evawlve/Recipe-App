/**
 * _evict_rows.ts — delete screened-bad rows from FoodMapping.
 *
 * DRY RUN BY DEFAULT. Pass --execute to actually delete.
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
 *     scripts/eval/_evict_rows.ts <keys.json> <snapshot.json> [--execute]
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
// CLI
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
    const [keysPath, snapPath] = process.argv.slice(2).filter(a => a !== '--execute');
    const execute = process.argv.includes('--execute');
    if (!keysPath || !snapPath) throw new Error('usage: _evict_rows.ts <keys.json> <snapshot.json> [--execute]');

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
        console.log(`Restore with: _restore_rows.ts ${snapPath} ${keysPath}`);
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
