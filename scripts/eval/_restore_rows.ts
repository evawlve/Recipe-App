/**
 * _restore_rows.ts — put evicted FoodMapping rows back from a snapshot.
 *
 * The counterpart to _evict_rows.ts. Written BEFORE the eviction ran, because a
 * restore path you have not written is a restore path you do not have.
 *
 * WHICH SNAPSHOT: the FRESH pre-execute snapshot (Role B, the restore anchor) —
 * the one taken at step 3, immediately before `_evict_rows --execute` (handoff
 * §2b). NOT the screen-time snapshot (Role A) that anchored the audit verdicts:
 * that file can be hours older and holds pre-flywheel row content, so restoring
 * from it can resurrect stale rows. The full five-step procedure is in the
 * _evict_rows.ts header:
 *   1. screen runs; _snap_foodmapping.ts -> S_screen        (Role A, verdict anchor)
 *   2. _evict_rows.ts <keys> --screen-snapshot S_screen              (dry run)
 *   3. _snap_foodmapping.ts -> S_fresh                      (Role B, restore anchor)
 *   4. _evict_rows.ts <keys> --screen-snapshot S_screen --execute
 *   5. THIS script:  _restore_rows.ts S_fresh <keys> --execute
 *
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register \
 *     scripts/eval/_restore_rows.ts <fresh-pre-execute-snapshot.json> [keys.json] [--execute]
 *
 * With keys.json: restores only those keys. Without: restores every snapshot row
 * that is currently missing. Uses createMany({skipDuplicates}) so it never
 * clobbers a row that has since been re-resolved by live traffic. That property
 * is CORRECT — but it is also the LIMIT on reversibility: a key that live
 * traffic re-resolves after the eviction is skipped and never returns to its
 * snapshot value. A silent skip is playbook §11 class B (absence of restore
 * encoded as a clean run), so every skipped key is COUNTED and PRINTED, and the
 * run exits with a DISTINCT code when anything was skipped:
 *
 *   exit 0 = fully restored (or dry run with nothing that would be skipped)
 *   exit 3 = completed, but >=1 key was NOT restored (already live) — the
 *            printed list is the residue an operator must reconcile by hand
 *   exit 2 = refused / error
 *
 * The keys file gets the SAME validation as _evict_rows.ts (parseKeysText), and
 * additionally every requested key must exist in the snapshot — the mirror of
 * evictGuard's unbacked-keys refusal. A degenerate-but-valid-JSON keys file
 * ('[]', a bare string, mixed types) or a keys/snapshot pairing that doesn't
 * line up must REFUSE (exit 2), never quietly become "restore nothing" or
 * "restore partial" with exit 0: restore is the post-disaster path, and a false
 * green here is unrecoverable (playbook §11 class B).
 */
import 'dotenv/config';
import * as fs from 'fs';
import { PrismaClient, Prisma } from '@prisma/client';
import { loadSnapshot, parseKeysText } from './_evict_rows';

// ---------------------------------------------------------------------------
// Pure, unit-testable pieces (scripts/eval/__tests__/cache-ops-guards.test.ts)
// ---------------------------------------------------------------------------

export interface RestorePartition<R extends { normalizedForm: string }> {
    /** rows absent from the live cache — these WILL be restored */
    missing: R[];
    /** rows already live — these will be SKIPPED (never clobbered) */
    skipped: R[];
}

export function partitionRestore<R extends { normalizedForm: string }>(
    rows: R[],
    liveKeys: Set<string>,
): RestorePartition<R> {
    const missing: R[] = [];
    const skipped: R[] = [];
    for (const r of rows) (liveKeys.has(r.normalizedForm) ? skipped : missing).push(r);
    return { missing, skipped };
}

/**
 * createMany({skipDuplicates}) can skip MORE rows than the partition predicted
 * if a key re-resolves in the window between the live-key read and the write.
 * That residue has no key list (Prisma reports only a count), so it is reported
 * as a count — but it still counts toward the exit code.
 */
export function raceSkips(submitted: number, created: number): number {
    return Math.max(0, submitted - created);
}

/** Every skipped key is printed — the skip list IS the reconciliation worklist. */
export function skipReportLines(skippedKeys: string[], raceSkipped = 0): string[] {
    const lines: string[] = [];
    if (skippedKeys.length) {
        lines.push(`NOT RESTORED — ${skippedKeys.length} key(s) already live (re-resolved since eviction; left untouched):`);
        for (const k of skippedKeys) lines.push(`  SKIPPED ${JSON.stringify(k)}`);
    }
    if (raceSkipped > 0) {
        lines.push(`NOT RESTORED — ${raceSkipped} additional row(s) appeared live mid-run (createMany skipDuplicates).`);
    }
    return lines;
}

/** Distinct from both success (0) and refusal (2): a partial restore is its own outcome. */
export function restoreExitCode(totalSkipped: number): number {
    return totalSkipped > 0 ? 3 : 0;
}

/**
 * Validate the optional keys file and select the snapshot rows it names.
 * Refuses (never silently narrows) when:
 *   - the file fails parseKeysText (empty / truncated / not a non-empty array
 *     of non-empty strings) — same gate the evict side runs;
 *   - ANY requested key is absent from the snapshot. There is nothing to
 *     restore such a key FROM, so proceeding would strand it with no report:
 *     partitionRestore never sees it and skipReportLines never prints it,
 *     breaking the header contract that every unrestored key is counted and
 *     printed. A missing key means the wrong snapshot or the wrong keys file —
 *     an operator problem to fix, not a filter to apply.
 */
export function selectRestoreRows<R extends { normalizedForm: string }>(
    keysText: string,
    snapRows: R[],
): { ok: true; keys: string[]; rows: R[] } | { ok: false; reason: string } {
    const parsed = parseKeysText(keysText);
    if (!parsed.ok) return { ok: false, reason: `keys file: ${parsed.reason}` };
    const inSnap = new Set(snapRows.map(r => r.normalizedForm));
    const unbacked = parsed.keys.filter(k => !inSnap.has(k));
    if (unbacked.length) {
        return {
            ok: false,
            reason:
                `${unbacked.length} requested key(s) are NOT in the snapshot — there is nothing to restore them from `
                + `(wrong snapshot? wrong keys file?): e.g. ${unbacked.slice(0, 5).map(k => JSON.stringify(k)).join(' | ')}`,
        };
    }
    const want = new Set(parsed.keys);
    return { ok: true, keys: parsed.keys, rows: snapRows.filter(r => want.has(r.normalizedForm)) };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(): Promise<number> {
    const args = process.argv.slice(2).filter(a => a !== '--execute');
    const execute = process.argv.includes('--execute');
    const [snapPath, keysPath] = args;
    if (!snapPath) {
        throw new Error(
            'usage: _restore_rows.ts <fresh-pre-execute-snapshot.json> [keys.json] [--execute] — '
            + 'the snapshot here is the Role-B RESTORE ANCHOR (taken immediately before the evict --execute), '
            + 'not the screen-time snapshot the verdicts came from (see header).',
        );
    }

    const parsed = loadSnapshot(snapPath);
    if (!parsed.ok) {
        console.error(`REFUSING: ${parsed.reason}`);
        return 2;
    }
    const snap = parsed.snap;

    let rows = snap.rows as unknown as Prisma.FoodMappingCreateManyInput[];
    if (keysPath) {
        let keysText: string;
        try { keysText = fs.readFileSync(keysPath, 'utf8'); } catch (e) {
            console.error(`REFUSING: cannot read keys file ${keysPath}: ${(e as Error).message}`);
            return 2;
        }
        const sel = selectRestoreRows(keysText, snap.rows);
        if (!sel.ok) {
            console.error(`REFUSING: ${sel.reason}`);
            return 2;
        }
        rows = sel.rows as unknown as Prisma.FoodMappingCreateManyInput[];
    }

    const prisma = new PrismaClient();
    try {
        const liveKeys = new Set(
            (await prisma.foodMapping.findMany({ select: { normalizedForm: true } })).map(r => r.normalizedForm),
        );
        const { missing, skipped } = partitionRestore(rows, liveKeys);
        console.log(`restore anchor (Role B — must be the FRESH pre-execute snapshot, step 3 of 5): ${snapPath}`);
        console.log(`snapshot ${snap.count} rows (taken ${snap.takenAt})`);
        console.log(`candidates ${rows.length}, currently MISSING from the cache: ${missing.length}`);
        for (const line of skipReportLines(skipped.map(r => r.normalizedForm))) console.log(line);

        if (!execute) {
            console.log('\nDRY RUN — nothing written. Re-run with --execute to restore.');
            return restoreExitCode(skipped.length);
        }
        if (!missing.length) {
            console.log('nothing to restore.');
            return restoreExitCode(skipped.length);
        }

        const res = await prisma.foodMapping.createMany({ data: missing, skipDuplicates: true });
        const raced = raceSkips(missing.length, res.count);
        console.log(`RESTORED ${res.count} row(s). FoodMapping now ${await prisma.foodMapping.count()} rows.`);
        for (const line of skipReportLines([], raced)) console.log(line);
        return restoreExitCode(skipped.length + raced);
    } finally {
        await prisma.$disconnect();
    }
}

if (require.main === module) {
    main()
        .then(c => process.exit(c))
        .catch(e => { console.error(e); process.exit(2); });
}
