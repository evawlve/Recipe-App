/**
 * _snap_foodmapping.ts — full reversible snapshot of FoodMapping before a cache op.
 * Read-only against prod. Writes ONE json file. Standing rule: snapshot before any
 * cache-touching operation, because there is no staging copy of this database.
 *
 * A SNAPSHOT FILE HAS NO INHERENT ROLE — the operator assigns one by USE, which
 * is why this script labels its output role-neutrally and stamps a meta note
 * instead of baking a role (like "pre-evict") into the payload. The same output
 * plays two different jobs in the eviction procedure:
 *
 *   Role A — SCREEN snapshot (verdict anchor): the file taken when the
 *     audit/screen ran. `_evict_rows.ts --screen-snapshot` guards against THIS
 *     file; a fresher file makes that guard vacuously green.
 *   Role B — FRESH pre-execute snapshot (restore anchor): the file taken
 *     immediately before `_evict_rows --execute` (handoff §2b).
 *     `_restore_rows.ts` restores from THIS file.
 *
 * Five-step procedure (full text in the _evict_rows.ts header):
 *   1. screen runs; THIS script -> S_screen                 (Role A)
 *   2. _evict_rows.ts <keys> --screen-snapshot S_screen     (dry run)
 *   3. THIS script -> S_fresh                               (Role B)
 *   4. _evict_rows.ts <keys> --screen-snapshot S_screen --execute
 *   5. _restore_rows.ts S_fresh <keys> --execute            (rollback path)
 *
 * Name the outfile for the role you are about to give it (e.g.
 * FoodMapping-screen-<date>.json vs FoodMapping-pre-execute-<date>.json) —
 * the filename is the only place the role can live.
 *
 *   npx ts-node --project tsconfig.scripts.json --transpile-only \
 *     -r tsconfig-paths/register scripts/eval/_snap_foodmapping.ts <outfile>
 */
import 'dotenv/config';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
    const out = process.argv[2];
    if (!out) throw new Error('usage: _snap_foodmapping.ts <outfile>');

    const rows = await prisma.foodMapping.findMany({ orderBy: { normalizedForm: 'asc' } });
    const payload = {
        table: 'FoodMapping',
        // Role-neutral on purpose: the role (verdict anchor vs restore anchor) is
        // assigned by how the file is USED, not by this script. See header.
        label: 'FoodMapping snapshot (role unassigned at capture)',
        roleNote:
            'Two roles exist: Role A / SCREEN snapshot = verdict anchor for _evict_rows.ts --screen-snapshot '
            + '(must be the file the audit verdicts were derived from); Role B / FRESH pre-execute snapshot = '
            + 'restore anchor for _restore_rows.ts (re-taken immediately before any --execute). '
            + 'This file becomes one or the other by use — record which, in its filename.',
        count: rows.length,
        // Callers must NOT trust a snapshot they cannot date; stamp it from the DB clock.
        takenAt: (await prisma.$queryRawUnsafe<{ now: Date }[]>('SELECT now() as now'))[0].now,
        rows,
    };
    fs.writeFileSync(out, JSON.stringify(payload, null, 1));
    console.log(`snapshot ${rows.length} FoodMapping rows -> ${out}`);
    console.log(`bytes: ${fs.statSync(out).size}`);
    console.log(
        'ROLE: unassigned at capture — this file is the verdict anchor (Role A) if the screen ran against it, '
        + 'or the restore anchor (Role B) if taken immediately before an --execute. Name it accordingly.',
    );
}

main()
    .catch(e => { console.error(e); process.exit(2); })
    .finally(() => prisma.$disconnect());
