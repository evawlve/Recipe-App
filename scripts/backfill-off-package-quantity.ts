/**
 * backfill-off-package-quantity.ts — populate OffFood.packageQuantity(+Unit)
 * from OFF's CSV export (Cluster A pt2 Defect 3, Jul 2026).
 *
 * The OFF CSV carries `product_quantity` (normalized net quantity, g or ml)
 * and the raw `quantity` label string ("591 ml", "1.75 L") that our JSONL
 * ingest never selected. This streams the CSV, collects (barcode, quantity,
 * unit) for rows with a usable product_quantity, loads them into a temp table
 * on ONE connection (transaction-pinned), and joins onto OffFood — barcodes we
 * never ingested are simply skipped by the join.
 *
 * Run on the Mini-PC (CSV + Postgres both local; node streaming keeps RAM low):
 *   ts-node --project tsconfig.scripts.json --transpile-only \
 *     -r tsconfig-paths/register scripts/backfill-off-package-quantity.ts \
 *     ~/Recipe-App/data/openfoodfacts.csv.gz
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import zlib from 'zlib';
import { PrismaClient, Prisma } from '@prisma/client';

// 1-indexed tab-separated columns of the OFF CSV export (verified 2026-07-19
// against the Apr-2026 file: 1=code, 14=quantity, 73=product_quantity).
const COL_CODE = 0;
const COL_QUANTITY = 13;
const COL_PRODUCT_QUANTITY = 72;

const INSERT_BATCH = 5000;

/** 'ml' for volume-labeled packages, 'g' for weight-labeled, null if unclear. */
function inferUnit(quantityStr: string): 'g' | 'ml' | null {
    const s = quantityStr.toLowerCase();
    if (/\d\s*(ml|cl|dl|l|litre|liter|fl\s*\.?\s*oz)\b/.test(s)) return 'ml';
    if (/\d\s*(g|gr|grams?|kg|mg|oz|lbs?|pounds?)\b/.test(s)) return 'g';
    return null;
}

async function main() {
    const csvPath = process.argv[2];
    if (!csvPath || !fs.existsSync(csvPath)) {
        console.error('Usage: backfill-off-package-quantity.ts <openfoodfacts.csv[.gz]>');
        process.exit(1);
    }

    const prisma = new PrismaClient();
    let input: NodeJS.ReadableStream = fs.createReadStream(csvPath);
    if (path.extname(csvPath) === '.gz') input = (input as fs.ReadStream).pipe(zlib.createGunzip());
    const rl = readline.createInterface({ input, crlfDelay: Infinity });

    // Collect qualifying rows first (tiny objects; ~1.3M rows ≈ manageable),
    // then load in one transaction so the temp table stays on one connection.
    const rows: Array<{ barcode: string; qty: number; unit: string | null }> = [];
    let lineNo = 0;
    for await (const line of rl) {
        lineNo++;
        if (lineNo === 1) continue; // header
        const cols = line.split('\t');
        const barcode = cols[COL_CODE];
        const pq = Number(cols[COL_PRODUCT_QUANTITY]);
        if (!barcode || !Number.isFinite(pq) || pq <= 0 || pq > 100000) continue;
        const quantityStr = cols[COL_QUANTITY] ?? '';
        // Multipacks ("6 x 355 ml"): product_quantity is the TOTAL, which
        // would overbill "1 bottle" by the pack count. Skip them.
        if (/\d\s*[x×*]\s*\d/i.test(quantityStr)) continue;
        // Buffer round-trip detaches the barcode from its parent line: V8's
        // split() returns sliced strings that pin the ENTIRE multi-KB CSV line
        // in memory — retaining 1M+ of those OOMs a 4GB heap.
        rows.push({ barcode: Buffer.from(barcode).toString(), qty: pq, unit: inferUnit(quantityStr) });
        if (rows.length % 200000 === 0) console.log(`collected ${rows.length.toLocaleString()} (scanned ${lineNo.toLocaleString()})`);
    }
    console.log(`CSV done: ${rows.length.toLocaleString()} rows with product_quantity (of ${lineNo.toLocaleString()} scanned).`);

    const updated = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
            `CREATE TEMP TABLE pkg_tmp (barcode TEXT PRIMARY KEY, qty DOUBLE PRECISION, unit TEXT) ON COMMIT DROP`);
        for (let i = 0; i < rows.length; i += INSERT_BATCH) {
            const chunk = rows.slice(i, i + INSERT_BATCH);
            const values = Prisma.join(chunk.map(r => Prisma.sql`(${r.barcode}, ${r.qty}, ${r.unit})`));
            await tx.$executeRaw`INSERT INTO pkg_tmp (barcode, qty, unit) VALUES ${values} ON CONFLICT (barcode) DO NOTHING`;
            if ((i / INSERT_BATCH) % 40 === 0) console.log(`loaded ${Math.min(i + INSERT_BATCH, rows.length).toLocaleString()} into temp`);
        }
        const n = await tx.$executeRawUnsafe(`
            UPDATE "OffFood" f
            SET "packageQuantity" = t.qty, "packageQuantityUnit" = t.unit
            FROM pkg_tmp t WHERE f.barcode = t.barcode`);
        return n;
    }, { timeout: 1000 * 60 * 30 });

    console.log(`\n✅ Done. ${updated.toLocaleString()} OffFood rows now carry packageQuantity.`);
    await prisma.$disconnect();
}

main().catch(err => {
    console.error('❌ Backfill crashed:', err);
    process.exit(1);
});
