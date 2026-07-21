/**
 * mark-corrupt-off.ts — write OffFood.corruptReason from a corrupt-panel scan.
 *
 * Input: a results/corrupt-panel-scan-*.json produced by
 * scripts/eval/detect-corrupt-panel.ts. Each flagged entry is passed through
 * the shared trust rules (src/lib/mapping/corrupt-mark.ts):
 *   - panel-low flags whose sibling median exceeds the physical ceiling are
 *     skipped (the SIBLING group is the corrupt one — kJ-as-kcal family);
 *   - panel-inflated flags from groups smaller than 8 are skipped.
 * Surviving flags are re-checked against the live row (barcode still exists,
 * stored kcal/100g still matches the scan within 0.5 — the corpus may have
 * changed since the scan) and then written as corruptReason = "<direction>:<tier>".
 *
 * corruptReason is a SEPARATE column from duplicateOfBarcode on purpose:
 * dedupe-off-mark.ts clears and recomputes duplicate marks on every run.
 * This script never touches rows it did not decide about, and re-runs are
 * idempotent (already-marked rows are counted, not rewritten).
 *
 * DRY-RUN BY DEFAULT — nothing is written without --apply.
 *
 * Run (from repo root; DATABASE_URL must point at the target DB):
 *   npx ts-node --transpile-only --compilerOptions '{"module":"commonjs","moduleResolution":"node"}' \
 *     scripts/mark-corrupt-off.ts --file scripts/eval/results/corrupt-panel-scan-<ts>.json [--apply]
 *
 * Flags:
 *   --file <path>   scan JSON (required)
 *   --apply         actually write marks (default: dry-run report only)
 *   --clear         instead of marking, set corruptReason = NULL on every row
 *                   whose reason matches --clear-prefix (default: all rows);
 *                   requires --apply to take effect
 *   --clear-prefix <p>  with --clear: only clear reasons starting with <p>
 *
 * After applying: run scripts/purge-corrupt-typesense.ts to drop the marked
 * docs from the live off_foods index (full rebuilds via sync-typesense.ts
 * exclude them automatically).
 */

import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient, Prisma } from '@prisma/client';
import { decideMark, CorruptScanFlag } from '../src/lib/mapping/corrupt-mark';

const prisma = new PrismaClient();

const args = process.argv.slice(2);
function argValue(flag: string): string | undefined {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
}
const APPLY = args.includes('--apply');
const CLEAR = args.includes('--clear');
const CLEAR_PREFIX = argValue('--clear-prefix');
const FILE = argValue('--file');

const FETCH_CHUNK = 1000;
const WRITE_BATCH = 5000;

function kcalOf(nutrients: unknown): number | null {
    if (!nutrients || typeof nutrients !== 'object') return null;
    const n = nutrients as Record<string, unknown>;
    const v = n.calories ?? n.energy ?? n.kcal;
    return typeof v === 'number' ? v : null;
}

async function clearMarks(): Promise<void> {
    const where = CLEAR_PREFIX
        ? Prisma.sql`"corruptReason" LIKE ${CLEAR_PREFIX + '%'}`
        : Prisma.sql`"corruptReason" IS NOT NULL`;
    const count = await prisma.$queryRaw<Array<{ n: bigint }>>(
        Prisma.sql`SELECT count(*)::bigint AS n FROM "OffFood" WHERE ${where}`
    );
    const n = Number(count[0]?.n ?? 0);
    if (!APPLY) {
        console.log(`[dry-run] --clear would null corruptReason on ${n} rows` +
            (CLEAR_PREFIX ? ` (prefix "${CLEAR_PREFIX}")` : ''));
        return;
    }
    const res = await prisma.$executeRaw(
        Prisma.sql`UPDATE "OffFood" SET "corruptReason" = NULL WHERE ${where}`
    );
    console.log(`Cleared corruptReason on ${res} rows` +
        (CLEAR_PREFIX ? ` (prefix "${CLEAR_PREFIX}")` : ''));
}

async function main(): Promise<void> {
    if (CLEAR) {
        await clearMarks();
        return;
    }

    if (!FILE) {
        console.error('Usage: mark-corrupt-off.ts --file <corrupt-panel-scan.json> [--apply]');
        process.exit(1);
    }
    const scan = JSON.parse(fs.readFileSync(FILE, 'utf8')) as {
        at: string;
        summary: { scanned: number; flagged: number };
        flagged: CorruptScanFlag[];
    };
    console.log(`Scan ${scan.at}: ${scan.flagged.length} flagged of ${scan.summary.scanned} scanned`);

    // 1. Trust rules (pure, shared with jest).
    const skips: Record<string, number> = {};
    const markable = new Map<string, { flag: CorruptScanFlag; reason: string }>();
    for (const flag of scan.flagged) {
        const decision = decideMark(flag);
        if (!decision.mark) {
            skips[decision.skip] = (skips[decision.skip] ?? 0) + 1;
            continue;
        }
        markable.set(flag.barcode, { flag, reason: decision.reason });
    }
    console.log(`Trust rules: ${markable.size} markable, skipped ${JSON.stringify(skips)}`);

    // 2. Staleness re-check against the live rows.
    const barcodes = [...markable.keys()];
    const toWrite: Array<{ barcode: string; reason: string }> = [];
    let missing = 0, stale = 0, alreadyMarked = 0;
    for (let i = 0; i < barcodes.length; i += FETCH_CHUNK) {
        const chunk = barcodes.slice(i, i + FETCH_CHUNK);
        const rows = await prisma.offFood.findMany({
            where: { barcode: { in: chunk } },
            select: { barcode: true, nutrientsPer100g: true, corruptReason: true },
        });
        const byBarcode = new Map(rows.map(r => [r.barcode, r]));
        for (const barcode of chunk) {
            const row = byBarcode.get(barcode);
            const entry = markable.get(barcode)!;
            if (!row) { missing++; continue; }
            if (row.corruptReason != null) { alreadyMarked++; continue; }
            const liveKcal = kcalOf(row.nutrientsPer100g);
            if (liveKcal == null || Math.abs(liveKcal - entry.flag.kcal100) > 0.5) {
                stale++;
                continue;
            }
            toWrite.push({ barcode, reason: entry.reason });
        }
    }
    console.log(`Live check: ${toWrite.length} to write ` +
        `(${alreadyMarked} already marked, ${stale} stale panels, ${missing} missing rows)`);
    const byReason: Record<string, number> = {};
    for (const w of toWrite) byReason[w.reason] = (byReason[w.reason] ?? 0) + 1;
    console.log(`By reason: ${JSON.stringify(byReason)}`);

    // 3. Cache rows pointing at soon-to-be-marked records (they will escape
    //    at read time as 'corrupt_record'; human-triage rows deserve eyes).
    const markSet = new Set(toWrite.map(w => w.barcode));
    const cacheRows = await prisma.foodMapping.findMany({
        where: { offBarcode: { not: null } },
        select: { normalizedForm: true, offBarcode: true, foodName: true, validatedBy: true },
    });
    const affected = cacheRows.filter(r => r.offBarcode && markSet.has(r.offBarcode));
    if (affected.length) {
        console.log(`\nFoodMapping rows pointing at marked records (${affected.length}) — these escape+re-resolve on next hit:`);
        for (const r of affected) {
            const tag = r.validatedBy === 'human-triage' ? '  ** HUMAN-TRIAGE **' : '';
            console.log(`  ${r.normalizedForm} -> off_${r.offBarcode} (${r.foodName})${tag}`);
        }
    } else {
        console.log('\nNo FoodMapping rows point at the records being marked.');
    }

    if (!APPLY) {
        console.log('\n[dry-run] no writes performed. Re-run with --apply to mark.');
        return;
    }

    // 4. Batched writes.
    let written = 0;
    for (let i = 0; i < toWrite.length; i += WRITE_BATCH) {
        const batch = toWrite.slice(i, i + WRITE_BATCH);
        const values = Prisma.join(
            batch.map(w => Prisma.sql`(${w.barcode}, ${w.reason})`)
        );
        written += await prisma.$executeRaw(Prisma.sql`
            UPDATE "OffFood" AS f
            SET "corruptReason" = v.reason
            FROM (VALUES ${values}) AS v(barcode, reason)
            WHERE f.barcode = v.barcode AND f."corruptReason" IS NULL
        `);
        console.log(`  wrote ${Math.min(i + WRITE_BATCH, toWrite.length)}/${toWrite.length}`);
    }
    console.log(`\nMarked ${written} rows. Next: scripts/purge-corrupt-typesense.ts to drop them from the live index.`);

    const outPath = path.join('scripts', 'eval', 'results',
        `corrupt-mark-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(outPath, JSON.stringify({
        at: new Date().toISOString(),
        scanFile: FILE,
        scanAt: scan.at,
        written,
        skips,
        stale,
        missing,
        alreadyMarked,
        byReason,
        affectedCacheRows: affected,
    }, null, 2));
    console.log(`Audit record: ${outPath}`);
}

main()
    .catch((err) => { console.error(err); process.exit(1); })
    .finally(() => prisma.$disconnect());
