/**
 * backfill-off-package-quantity.ts — populate OffFood.packageQuantity(+Unit)
 * from OFF's CSV export (Cluster A pt2 Defect 3, Jul 2026).
 *
 * The OFF export carries `product_quantity` (normalized net quantity, g or ml)
 * and the raw `quantity` label string ("591 ml", "1.75 L"). This streams the
 * file, collects (barcode, quantity, unit) for rows with a usable
 * product_quantity, loads them into a temp table on ONE connection
 * (transaction-pinned), and joins onto OffFood — barcodes we never ingested
 * are simply skipped by the join.
 *
 * SCOPE: this is a REPAIR tool, not the pipeline. Since 2026-07-31 the normal
 * ingest writes these columns itself (product_quantity/quantity are in
 * off-parquet-to-jsonl.sh's SELECT and parseOffProduct() reads them), so a
 * fresh rebuild no longer needs this script. Keep it for repairing a corpus
 * ingested before that fix — e.g. the 2026-07-30 refresh, which left the
 * column at 0 of 1,085,525 rows.
 *
 * Run on the box (input + Postgres both local; node streaming keeps RAM low):
 *   ts-node --project tsconfig.scripts.json --transpile-only \
 *     -r tsconfig-paths/register scripts/backfill-off-package-quantity.ts \
 *     ~/Downloads/off-package-quantity-2026-07-31.csv.gz [--dry-run]
 *
 * --dry-run reports how many OffFood rows the join WOULD touch, then rolls
 * back. Production writes to a 1M-row table deserve a measured count first.
 */

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import zlib from 'zlib';
import { PrismaClient, Prisma } from '@prisma/client';
import { parsePackageQuantity } from './lib/off-parse';

// 1-indexed tab-separated columns of the OFF CSV export (verified 2026-07-19
// against the Apr-2026 file: 1=code, 14=quantity, 73=product_quantity).
const TSV_COL_CODE = 0;
const TSV_COL_QUANTITY = 13;
const TSV_COL_PRODUCT_QUANTITY = 72;

const INSERT_BATCH = 5000;

/**
 * Two input shapes are accepted, chosen by sniffing the header line:
 *
 *  - `tsv`: OFF's own full CSV export (tab-separated, ~200 columns, fixed
 *    positions above). What the original 2026-07-19 backfill consumed.
 *  - `csv`: a narrow comma-separated extract with a
 *    `code,product_quantity,product_quantity_unit,quantity` header, produced
 *    by a DuckDB SELECT straight off the Parquet export. Far cheaper than
 *    re-downloading the 9GB CSV when only these fields are wanted.
 *
 * Columns are located BY NAME in csv mode, so extra/reordered columns are fine.
 */
type Layout = { split: (line: string) => string[]; code: number; qty: number; label: number };

/** RFC4180-ish field splitter: honours "quoted, fields" and "" escapes. */
function splitCsv(line: string): string[] {
    const out: string[] = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inQuotes) {
            if (c === '"') {
                if (line[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
            } else field += c;
        } else if (c === '"') inQuotes = true;
        else if (c === ',') { out.push(field); field = ''; }
        else field += c;
    }
    out.push(field);
    return out;
}

function detectLayout(header: string): Layout {
    if (header.includes('\t')) {
        return {
            split: (l) => l.split('\t'),
            code: TSV_COL_CODE, qty: TSV_COL_PRODUCT_QUANTITY, label: TSV_COL_QUANTITY,
        };
    }
    const cols = splitCsv(header).map(c => c.trim().replace(/^﻿/, ''));
    const at = (name: string) => {
        const i = cols.indexOf(name);
        if (i < 0) throw new Error(`CSV header is missing required column "${name}" (saw: ${cols.join(', ')})`);
        return i;
    };
    return { split: splitCsv, code: at('code'), qty: at('product_quantity'), label: at('quantity') };
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = args.includes('--dry-run');
    const csvPath = args.find(a => !a.startsWith('--'));
    if (!csvPath || !fs.existsSync(csvPath)) {
        console.error('Usage: backfill-off-package-quantity.ts <off-export.csv[.gz]> [--dry-run]');
        process.exit(1);
    }

    const prisma = new PrismaClient();
    let input: NodeJS.ReadableStream = fs.createReadStream(csvPath);
    if (path.extname(csvPath) === '.gz') input = (input as fs.ReadStream).pipe(zlib.createGunzip());
    const rl = readline.createInterface({ input, crlfDelay: Infinity });

    // Collect qualifying rows first (tiny objects; ~1.3M rows ≈ manageable),
    // then load in one transaction so the temp table stays on one connection.
    const rows: Array<{ barcode: string; qty: number; unit: string | null }> = [];
    let layout: Layout | null = null;
    let lineNo = 0;
    for await (const line of rl) {
        lineNo++;
        if (lineNo === 1) { layout = detectLayout(line); continue; }
        const cols = layout!.split(line);
        const barcode = cols[layout!.code];
        if (!barcode) continue;
        // Qualification (bounds + the multipack rejection) is shared with the
        // ingest so the two writers of this column cannot drift apart.
        const pkg = parsePackageQuantity(cols[layout!.qty], cols[layout!.label] ?? '');
        if (!pkg) continue;
        // Buffer round-trip detaches the barcode from its parent line: V8's
        // split() returns sliced strings that pin the ENTIRE multi-KB CSV line
        // in memory — retaining 1M+ of those OOMs a 4GB heap.
        rows.push({ barcode: Buffer.from(barcode).toString(), qty: pkg.quantity, unit: pkg.unit });
        if (rows.length % 200000 === 0) console.log(`collected ${rows.length.toLocaleString()} (scanned ${lineNo.toLocaleString()})`);
    }
    console.log(`CSV done: ${rows.length.toLocaleString()} rows with product_quantity (of ${lineNo.toLocaleString()} scanned).`);

    // Dry run executes the real UPDATE and then aborts the transaction, so the
    // reported count is the actual join result, not an estimate of it.
    class DryRunAbort extends Error { constructor(readonly count: number) { super('dry-run'); } }

    let updated: number;
    try {
        updated = await prisma.$transaction(async (tx) => {
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
        if (dryRun) throw new DryRunAbort(n);
        return n;
        }, { timeout: 1000 * 60 * 30 });
    } catch (err) {
        if (err instanceof DryRunAbort) {
            console.log(`\n🔎 DRY RUN — rolled back. ${err.count.toLocaleString()} OffFood rows WOULD be updated.`);
            await prisma.$disconnect();
            return;
        }
        throw err;
    }

    console.log(`\n✅ Done. ${updated.toLocaleString()} OffFood rows now carry packageQuantity.`);
    await prisma.$disconnect();
}

main().catch(err => {
    console.error('❌ Backfill crashed:', err);
    process.exit(1);
});
