/**
 * _snap_off_servings.ts — snapshot the DERIVED OffServing rows before a refresh.
 * Read-only against prod. Writes ONE json file.
 *
 * WHY THIS EXISTS: `ingest-off.ts --fresh` runs `DELETE FROM "OffServing"`,
 * which destroys every serving row — including the ones NO upstream source can
 * regenerate. OFF's own label servings (source 'openfoodfacts') come back with
 * the next ingest; these do not:
 *
 *   - source 'ai'             — an LLM serving estimate, persisted by upsertServing()
 *   - source 'sibling_borrow' — a weight borrowed from a brand sibling
 *
 * Those are draws, not derivations: re-running the estimator does not reproduce
 * them, it re-rolls them. That is not hypothetical. The 2026-07-30 refresh
 * deleted a cached 150 g "sleeve" for saltines; the estimator redrew 200 g and
 * upsertServing() persisted it, turning an intermittent bad sample into a
 * permanent golden-eval red (n-svk-05) that took a hand-authored seed rung to
 * clear. Preserving the old draw is strictly better than re-rolling it.
 *
 * The test for whether something belongs in this snapshot is NOT "is it
 * valuable" but "does any upstream source regenerate it?" — the question the
 * blast-radius analysis kept failing to ask. OFF label servings fail that test
 * and are deliberately excluded; keeping them would fight the fresh ingest.
 *
 *   npx ts-node --project tsconfig.scripts.json --transpile-only \
 *     -r tsconfig-paths/register scripts/eval/_snap_off_servings.ts <outfile>
 */
import 'dotenv/config';
import * as fs from 'fs';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Sources the ingest CAN regenerate — excluded from the snapshot. */
const REGENERATED_SOURCES = ['openfoodfacts'];

async function main(): Promise<void> {
    const out = process.argv[2];
    if (!out) throw new Error('usage: _snap_off_servings.ts <outfile>');

    const rows = await prisma.offServing.findMany({
        where: { source: { notIn: REGENERATED_SOURCES } },
        orderBy: [{ barcode: 'asc' }, { description: 'asc' }],
    });

    // Report the split so the operator can see what was left behind and why.
    const bySource = new Map<string, number>();
    for (const r of rows) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);
    const totalAll = await prisma.offServing.count();

    const payload = {
        table: 'OffServing',
        label: 'derived OffServing rows (sources no upstream ingest regenerates)',
        excludedSources: REGENERATED_SOURCES,
        excludedNote:
            'OFF label servings are excluded on purpose: the fresh ingest rewrites them from the dump, '
            + 'so replaying a snapshot of them would fight the ingest rather than protect anything.',
        count: rows.length,
        totalServingRowsAtCapture: totalAll,
        bySource: Object.fromEntries([...bySource].sort()),
        takenAt: (await prisma.$queryRawUnsafe<{ now: Date }[]>('SELECT now() as now'))[0].now,
        rows,
    };
    fs.writeFileSync(out, JSON.stringify(payload, null, 1));
    console.log(`snapshot ${rows.length} derived OffServing rows (of ${totalAll} total) -> ${out}`);
    for (const [src, n] of [...bySource].sort()) console.log(`  ${src}: ${n}`);
    console.log(`bytes: ${fs.statSync(out).size}`);
}

main()
    .catch(e => { console.error(e); process.exit(2); })
    .finally(() => prisma.$disconnect());
