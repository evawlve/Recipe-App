/**
 * dedupe-off-mark.ts — Offline near-duplicate marking pass over OffFood.
 *
 * The OFF ingest (ingest-off.ts) only dedupes on exact barcode, so the corpus
 * carries ~80-160k near-identical rows (e.g. 1,160 rows literally named
 * "chicken breast"). This script groups rows by
 *   (normalized name, normalized brand, bucketed macro signature)
 * — the same normalizeNameKey/macroSignature used by the query-time dedupe in
 * src/lib/search/dedupe-candidates.ts, plus brand so distinct brands' products
 * never collapse — picks one best representative per group, and marks every
 * other member with duplicateOfBarcode = <representative's barcode>.
 *
 * Nothing is deleted: barcodes are identity (FoodMapping FKs, logged foods),
 * so direct barcode lookups still resolve marked rows. Only search/candidate
 * paths filter on duplicateOfBarcode IS NULL, and sync-typesense.ts skips
 * marked rows so the search index shrinks.
 *
 * Usage: npx ts-node scripts/dedupe-off-mark.ts [--dry-run] [--clear]
 *   --dry-run  compute and print group stats, write nothing
 *   --clear    reset all duplicateOfBarcode marks to NULL and exit
 *
 * Re-runnable: each run recomputes marks from scratch (clears existing marks
 * first) so it stays correct after new ingests or delta updates.
 */
import 'dotenv/config';
import { PrismaClient, Prisma } from '@prisma/client';
import { normalizeNameKey, macroSignature } from '../src/lib/search/dedupe-candidates';

const prisma = new PrismaClient();

const DRY_RUN = process.argv.includes('--dry-run');
const CLEAR = process.argv.includes('--clear');

const READ_BATCH = 20_000;
const WRITE_BATCH = 5_000;

interface Row {
    barcode: string;
    name: string;
    brandName: string | null;
    nutrientsPer100g: { calories?: number; protein?: number; carbs?: number; fat?: number } | null;
    servingGrams: number | null;
    servingSize: string | null;
}

/** Same completeness idea as dedupe-candidates.ts isBetterRepresentative,
 *  adapted to raw OffFood rows: macro coverage + serving info. */
function completenessScore(r: Row): number {
    const n = r.nutrientsPer100g ?? {};
    let score = 0;
    if ((n.calories ?? 0) > 0) score++;
    if ((n.protein ?? 0) > 0) score++;
    if ((n.carbs ?? 0) > 0) score++;
    if ((n.fat ?? 0) > 0) score++;
    if (r.servingGrams != null) score++;
    else if (r.servingSize) score += 0.5;
    return score;
}

/** True when a should survive over b. Ties broken deterministically so
 *  re-runs pick the same representative. */
function isBetterRepresentative(a: Row, b: Row): boolean {
    const ac = completenessScore(a);
    const bc = completenessScore(b);
    if (ac !== bc) return ac > bc;
    if (a.name.length !== b.name.length) return a.name.length < b.name.length;
    return a.barcode < b.barcode;
}

function groupKey(r: Row): string {
    const nameKey = normalizeNameKey(r.name);
    const brandKey = (r.brandName ?? '').trim().toLowerCase();
    const sig = macroSignature({
        kcal: r.nutrientsPer100g?.calories ?? 0,
        protein: r.nutrientsPer100g?.protein ?? 0,
        carbs: r.nutrientsPer100g?.carbs ?? 0,
        fat: r.nutrientsPer100g?.fat ?? 0,
        per100g: true,
    });
    return `${nameKey}|${brandKey}|${sig}`;
}

async function main() {
    console.log(`🚀 dedupe-off-mark ${DRY_RUN ? '(DRY RUN)' : CLEAR ? '(CLEAR)' : ''}`);
    console.log(`Database: ${process.env.DATABASE_URL ? '✓ configured' : '❌ MISSING'}`);

    if (CLEAR) {
        const cleared = await prisma.offFood.updateMany({
            where: { duplicateOfBarcode: { not: null } },
            data: { duplicateOfBarcode: null },
        });
        console.log(`🧹 Cleared ${cleared.count.toLocaleString()} marks. Done.`);
        return;
    }

    // Pass 1: stream every row, keep the best representative per group and
    // the member barcodes. Memory: ~1M entries of small strings — fine.
    console.log('📖 Pass 1: streaming OffFood and grouping...');
    const groups = new Map<string, { rep: Row; members: string[] }>();
    let scanned = 0;
    let lastBarcode = '';

    while (true) {
        const batch: Row[] = await prisma.offFood.findMany({
            where: { barcode: { gt: lastBarcode } },
            select: {
                barcode: true,
                name: true,
                brandName: true,
                nutrientsPer100g: true,
                servingGrams: true,
                servingSize: true,
            },
            orderBy: { barcode: 'asc' },
            take: READ_BATCH,
        }) as unknown as Row[];
        if (batch.length === 0) break;
        lastBarcode = batch[batch.length - 1].barcode;

        for (const row of batch) {
            const key = groupKey(row);
            const g = groups.get(key);
            if (!g) {
                groups.set(key, { rep: row, members: [row.barcode] });
            } else {
                g.members.push(row.barcode);
                if (isBetterRepresentative(row, g.rep)) g.rep = row;
            }
        }
        scanned += batch.length;
        if (scanned % 200_000 === 0) {
            console.log(`  scanned ${scanned.toLocaleString()} rows, ${groups.size.toLocaleString()} groups...`);
        }
    }

    let dupGroups = 0;
    let dupRows = 0;
    for (const g of groups.values()) {
        if (g.members.length > 1) {
            dupGroups++;
            dupRows += g.members.length - 1;
        }
    }
    console.log('──────────────────────────────────────────────');
    console.log(`  Rows scanned          : ${scanned.toLocaleString()}`);
    console.log(`  Unique groups         : ${groups.size.toLocaleString()}`);
    console.log(`  Groups with dupes     : ${dupGroups.toLocaleString()}`);
    console.log(`  Rows to mark          : ${dupRows.toLocaleString()} (${((dupRows / scanned) * 100).toFixed(1)}%)`);
    console.log('──────────────────────────────────────────────');

    if (DRY_RUN) {
        console.log('🔍 Dry run — no writes. Done.');
        return;
    }

    // Reset existing marks so re-runs never leave stale pointers behind.
    console.log('🧹 Clearing previous marks...');
    const cleared = await prisma.offFood.updateMany({
        where: { duplicateOfBarcode: { not: null } },
        data: { duplicateOfBarcode: null },
    });
    if (cleared.count > 0) console.log(`  cleared ${cleared.count.toLocaleString()} stale marks`);

    // Pass 2: write marks in batches via UPDATE ... FROM (VALUES ...).
    console.log('✍️  Pass 2: marking duplicates...');
    let pairs: Array<[string, string]> = []; // [dupBarcode, repBarcode]
    let written = 0;

    const flush = async () => {
        if (pairs.length === 0) return;
        const values = Prisma.join(
            pairs.map(([dup, rep]) => Prisma.sql`(${dup}, ${rep})`)
        );
        await prisma.$executeRaw`
            UPDATE "OffFood" AS f
            SET "duplicateOfBarcode" = v.rep
            FROM (VALUES ${values}) AS v(dup, rep)
            WHERE f.barcode = v.dup
        `;
        written += pairs.length;
        if (written % 25_000 < WRITE_BATCH) {
            console.log(`  marked ${written.toLocaleString()} / ${dupRows.toLocaleString()}`);
        }
        pairs = [];
    };

    for (const g of groups.values()) {
        if (g.members.length < 2) continue;
        for (const barcode of g.members) {
            if (barcode === g.rep.barcode) continue;
            pairs.push([barcode, g.rep.barcode]);
            if (pairs.length >= WRITE_BATCH) await flush();
        }
    }
    await flush();

    console.log(`✅ Done. Marked ${written.toLocaleString()} near-duplicate rows.`);
    console.log('Next: re-run scripts/sync-typesense.ts — marked rows are now skipped,');
    console.log('so the rebuilt off_foods index drops them.');
}

main()
    .catch(err => {
        console.error('❌ Crashed:', err);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
