/**
 * ingest-off.ts — Memory-efficient batch streaming ingestion script for Open Food Facts JSONL data.
 *
 * Processes an OFF JSONL file (or .jsonl.gz) line-by-line using Node.js readline module,
 * filters for US/English products with valid nutrition macros, and inserts/upserts
 * them to the local PostgreSQL database using Prisma createMany in batches of 1,000.
 *
 * ⚠️ PREFERRED INPUT: the slim JSONL produced by scripts/off-parquet-to-jsonl.sh
 * from OFF's Parquet export — NOT the official openfoodfacts-products.jsonl.gz
 * dump. The official JSONL dump omits the entire `nutriments` object for
 * ~100-140K US products that the Parquet export has (verified 2026-07-12 via
 * the Mission Carb Balance line; see the mobile repo's
 * sync-docs/handoff_food_data_quality_audit.md "TRUE root cause" section).
 *
 * For picking up nutrition edits OFF's community makes to already-ingested
 * products (without re-running this full multi-hour ingest), see
 * ingest-off-delta.ts, which applies the same filters (scripts/lib/off-parse.ts)
 * against OFF's rolling 14-day delta export and upserts.
 */
import * as fs from 'fs';
import * as readline from 'readline';
import * as path from 'path';
import * as zlib from 'zlib';
import { PrismaClient } from '@prisma/client';
import { parseOffProduct, KEEP_COUNTRIES, REQUIRE_MACROS } from './lib/off-parse';

const prisma = new PrismaClient();

// ─── Config ─────────────────────────────────────────────────────────────────
const BATCH_SIZE = 1000;

// When true (--fresh flag), clear OffFood/OffServing before ingesting so a
// re-ingest actually replaces the polluted dataset instead of appending to it
// (createMany + skipDuplicates only ever adds rows). Destructive — off by default.
const FRESH = process.argv.includes('--fresh');

// When true (--dry-run flag), scan + apply all filters and print the summary
// counts but write NOTHING to the database (no deletes, no inserts). Use this to
// preview how many rows survive the filters against a real dump before committing
// to a destructive --fresh re-ingest.
const DRY_RUN = process.argv.includes('--dry-run');

// Main execution function
async function main() {
  const args = process.argv.slice(2);
  const filePathArg = args.find(arg => !arg.startsWith('--'));
  if (!filePathArg) {
    console.error('❌ Error: Please provide the path to the OFF JSONL (.jsonl or .jsonl.gz) file.');
    console.log('Usage: npx ts-node scripts/ingest-off.ts <path-to-off.jsonl[.gz]>');
    process.exit(1);
  }
  const jsonlPath = path.resolve(filePathArg);
  if (!fs.existsSync(jsonlPath)) {
    console.error(`❌ Error: File not found at ${jsonlPath}`);
    process.exit(1);
  }

  console.log(`🚀 Starting ingestion of ${jsonlPath}...`);
  console.log(`Database URL: ${process.env.DATABASE_URL ? '✓ Configured' : '❌ MISSING'}`);
  console.log(`Filters: countries=[${KEEP_COUNTRIES.join(', ') || 'ALL'}] requireMacros=${REQUIRE_MACROS} fresh=${FRESH}`);

  if (FRESH && !DRY_RUN) {
    // Clear existing OFF data so the re-ingest replaces it rather than appending
    // (createMany + skipDuplicates only adds). Done as DELETEs in FK-safe order
    // instead of TRUNCATE CASCADE so the FoodMapping cache (which has a nullable
    // FK to OffFood.barcode) survives — we only null its now-stale OFF links.
    console.log('🧹 --fresh: clearing existing OFF data (OffServing, OffFood; preserving FoodMapping)...');
    await prisma.$executeRawUnsafe('DELETE FROM "OffServing"');
    await prisma.$executeRawUnsafe('UPDATE "FoodMapping" SET "offBarcode" = NULL WHERE "offBarcode" IS NOT NULL');
    await prisma.$executeRawUnsafe('DELETE FROM "OffFood"');
    console.log('🧹 Clear complete. Ingesting into an empty OffFood table.');
  }

  let input: NodeJS.ReadableStream = fs.createReadStream(jsonlPath);
  if (jsonlPath.endsWith('.gz')) {
    console.log('📦 Detected gzipped file. Streaming and decompressing on the fly...');
    input = input.pipe(zlib.createGunzip());
  }

  const rl = readline.createInterface({
    input: input,
    crlfDelay: Infinity,
  });

  let totalLines = 0;
  let skippedNoUsOrEn = 0;
  let skippedNoName = 0;
  let skippedCategory = 0;
  let skippedNoMacros = 0;
  let skippedAtwater = 0;
  let processedCount = 0;
  let derivedFromServing = 0;
  let foodBatch: any[] = [];
  let servingBatch: any[] = [];

  for await (const line of rl) {
    totalLines++;
    if (totalLines % 50000 === 0) {
      console.log(`🔍 Scanned ${totalLines.toLocaleString()} lines... Processed ${processedCount.toLocaleString()} products...`);
    }
    if (!line.trim()) continue;
    try {
      const product = JSON.parse(line);
      const parsed = parseOffProduct(product);
      if (parsed.skip) {
        switch (parsed.reason) {
          case 'no_name': skippedNoName++; break;
          case 'not_us_or_en': skippedNoUsOrEn++; break;
          case 'category': skippedCategory++; break;
          case 'no_macros': skippedNoMacros++; break;
          case 'atwater': skippedAtwater++; break;
        }
      } else {
        const d = parsed.data;

        foodBatch.push({
          barcode: d.barcode,
          name: d.name,
          brandName: d.brandName,
          nutrientsPer100g: {
            calories: d.kcal >= 0 ? d.kcal : null,
            protein: d.protein >= 0 ? d.protein : null,
            carbs: d.carbs >= 0 ? d.carbs : null,
            fat: d.fat >= 0 ? d.fat : null,
            fiber: d.fiber >= 0 ? d.fiber : null,
            sugars: d.sugar >= 0 ? d.sugar : null,
            sodium: d.sodium >= 0 ? d.sodium : null,
          },
          servingSize: d.servingSize,
          servingGrams: d.servingGrams,
        });

        // If a standard serving size was extracted, prepare an OffServing record
        if (d.servingSize && d.servingGrams) {
          servingBatch.push({
            barcode: d.barcode,
            description: d.servingSize,
            grams: d.servingGrams,
            source: 'openfoodfacts',
            isAiEstimated: false,
          });
        }

        processedCount++;
        if (d.derivedFromServing) derivedFromServing++;

        // Flush batch when size matches
        if (foodBatch.length >= BATCH_SIZE) {
          await flushBatch(foodBatch, servingBatch);
          foodBatch = [];
          servingBatch = [];
        }
      }
    } catch (err) {
      // Avoid printing errors for malformed individual lines to keep logs clean
    }
  }

  // Flush remaining records
  if (foodBatch.length > 0) {
    await flushBatch(foodBatch, servingBatch);
  }

  console.log('\n✅ Ingestion finished successfully!');
  console.log('══════════════════════════════════════════════════════════════');
  console.log(`  Total Lines Scanned    : ${totalLines.toLocaleString()}`);
  console.log(`  Qualifying Products    : ${processedCount.toLocaleString()}`);
  console.log(`    ...derived from _serving : ${derivedFromServing.toLocaleString()}`);
  console.log(`  Skipped (No name/code) : ${skippedNoName.toLocaleString()}`);
  console.log(`  Skipped (Not US/EN)    : ${skippedNoUsOrEn.toLocaleString()}`);
  console.log(`  Skipped (Non-food cat) : ${skippedCategory.toLocaleString()}`);
  console.log(`  Skipped (Bad macros)   : ${skippedNoMacros.toLocaleString()}`);
  console.log(`  Skipped (Atwater fail) : ${skippedAtwater.toLocaleString()}`);
  console.log('══════════════════════════════════════════════════════════════');
}

async function flushBatch(foods: any[], servings: any[]) {
  if (DRY_RUN) return; // preview mode — count only, never write
  try {
    // Insert foods (ignore conflicts/duplicates if run repeatedly)
    await prisma.offFood.createMany({
      data: foods,
      skipDuplicates: true,
    });

    // Insert servings matching the foods
    if (servings.length > 0) {
      await prisma.offServing.createMany({
        data: servings,
        skipDuplicates: true,
      });
    }
  } catch (err) {
    console.error('⚠️  Failed to flush batch database write:', (err as Error).message);
  }
}

main()
  .catch(err => {
    console.error('❌ Process crashed:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
