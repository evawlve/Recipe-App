/**
 * ingest-off.ts — Memory-efficient batch streaming ingestion script for Open Food Facts JSONL data.
 *
 * Processes a 9GB+ OFF JSONL file (or .jsonl.gz file) line-by-line using Node.js readline module,
 * filters for US/English products with valid nutrition macros, and inserts/upserts
 * them to the local PostgreSQL database using Prisma createMany in batches of 1,000.
 */
import * as fs from 'fs';
import * as readline from 'readline';
import * as path from 'path';
import * as zlib from 'zlib';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ─── Config ─────────────────────────────────────────────────────────────────
const BATCH_SIZE = 1000;

// Categories to skip — these aren't useful recipe ingredients
const SKIP_CATEGORY_PATTERNS = [
  /beauty|cosmetic|pet food|dog food|cat food|baby formula|infant formula/i,
  /supplement|vitamins|dietary supplement/i,
];

// Helper to parse float or default to -1
function parseFloat0(v: any): number {
  if (typeof v === 'number') return v;
  const parsed = parseFloat(String(v));
  return isNaN(parsed) ? -1 : parsed;
}

// Helper to parse default serving weight in grams
function parseServingGrams(servingQuantity: any, servingSize: string): number | null {
  if (typeof servingQuantity === 'number' && servingQuantity > 0) return servingQuantity;
  const q = parseFloat(servingQuantity);
  if (!isNaN(q) && q > 0) return q;
  if (!servingSize) return null;
  const gMatch = servingSize.match(/(\d+(?:\.\d+)?)\s*g\b/i);
  if (gMatch) return parseFloat(gMatch[1]);
  const ozMatch = servingSize.match(/(\d+(?:\.\d+)?)\s*oz\b/i);
  if (ozMatch) return parseFloat(ozMatch[1]) * 28.3495;
  const mlMatch = servingSize.match(/(\d+(?:\.\d+)?)\s*ml\b/i);
  if (mlMatch) return parseFloat(mlMatch[1]);
  return null;
}

/** Atwater check: estimated kcal from macros should be within 30% of labeled kcal */
function atwaterValid(kcal: number, protein: number, carbs: number, fat: number): boolean {
  if (kcal <= 0) return false;
  const estimated = protein * 4 + carbs * 4 + fat * 9;
  if (estimated <= 0) return false;
  return kcal >= estimated * 0.7 && kcal <= estimated * 1.3;
}

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
  let skippedNoBrand = 0;
  let skippedCategory = 0;
  let skippedNoMacros = 0;
  let skippedAtwater = 0;
  let processedCount = 0;
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
      // Extract raw fields
      const barcode = product.code || product._id || '';
      const rawName = product.product_name || product.product_name_en || '';
      const brand = product.brands ? product.brands.split(',')[0].trim() : '';
      const categories = product.categories || product.categories_en || '';
      const servingSize = product.serving_size || '';
      const servingQuantity = product.serving_quantity || '';

      // Basic Name Check
      if (!barcode || !rawName || rawName.length < 2) {
        skippedNoName++;
        continue;
      }

      // Skip non-food categories
      const skipCat = SKIP_CATEGORY_PATTERNS.some(p => p.test(categories));
      if (skipCat) {
        skippedCategory++;
        continue;
      }

      // Macro parsing
      const nutriments = product.nutriments || {};
      const kcal = parseFloat0(nutriments['energy-kcal_100g'] || nutriments['energy_100g'] || -1);
      const fat = parseFloat0(nutriments['fat_100g'] || -1);
      const carbs = parseFloat0(nutriments['carbohydrates_100g'] || -1);
      const protein = parseFloat0(nutriments['proteins_100g'] || -1);
      const fiber = parseFloat0(nutriments['fiber_100g'] === undefined ? 0 : nutriments['fiber_100g']);
      const sugar = parseFloat0(nutriments['sugars_100g'] === undefined ? 0 : nutriments['sugars_100g']);
      const sodium = parseFloat0(nutriments['sodium_100g'] === undefined ? 0 : nutriments['sodium_100g']);

      // Validate nutrition consistency (only if all four macros are present)
      if (kcal >= 0 && fat >= 0 && carbs >= 0 && protein >= 0) {
        if (!atwaterValid(kcal, protein, carbs, fat)) {
          skippedAtwater++;
          continue;
        }
      }

      const servingGrams = parseServingGrams(servingQuantity, servingSize);
      const offId = `off_${barcode}`;

      foodBatch.push({
        barcode: String(barcode),
        name: rawName,
        brandName: brand || null,
        nutrientsPer100g: {
          calories: kcal >= 0 ? kcal : null,
          protein: protein >= 0 ? protein : null,
          carbs: carbs >= 0 ? carbs : null,
          fat: fat >= 0 ? fat : null,
          fiber: fiber >= 0 ? fiber : null,
          sugars: sugar >= 0 ? sugar : null,
          sodium: sodium >= 0 ? sodium : null,
        },
        servingSize: servingSize || null,
        servingGrams,
      });

      // If a standard serving size was extracted, prepare an OffServing record
      if (servingSize && servingGrams) {
        servingBatch.push({
          barcode: String(barcode),
          description: servingSize,
          grams: servingGrams,
          source: 'openfoodfacts',
          isAiEstimated: false,
        });
      }

      processedCount++;

      // Flush batch when size matches
      if (foodBatch.length >= BATCH_SIZE) {
        await flushBatch(foodBatch, servingBatch);
        foodBatch = [];
        servingBatch = [];
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
  console.log(`  Skipped (No name/code) : ${skippedNoName.toLocaleString()}`);
  console.log(`  Skipped (No brand)     : ${skippedNoBrand.toLocaleString()}`);
  console.log(`  Skipped (Not US/EN)    : ${skippedNoUsOrEn.toLocaleString()}`);
  console.log(`  Skipped (Non-food cat) : ${skippedCategory.toLocaleString()}`);
  console.log(`  Skipped (Bad macros)   : ${skippedNoMacros.toLocaleString()}`);
  console.log(`  Skipped (Atwater fail) : ${skippedAtwater.toLocaleString()}`);
  console.log('══════════════════════════════════════════════════════════════');
}

async function flushBatch(foods: any[], servings: any[]) {
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
