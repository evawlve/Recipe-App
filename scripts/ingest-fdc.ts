/**
 * ingest-fdc.ts — Memory-efficient batch streaming ingestion script for FoodData Central (FDC) JSONL data.
 *
 * Processes FDC JSONL files line-by-line using Node.js readline, parses food items,
 * extracts macros and portions, and inserts/upserts them into the local PostgreSQL database
 * in batches of 1,000.
 */
import * as fs from 'fs';
import * as readline from 'readline';
import * as path from 'path';
import * as zlib from 'zlib';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ─── Config ─────────────────────────────────────────────────────────────────
const BATCH_SIZE = 1000;

// Helper to extract nutrient value by ID
function getNutrientValue(foodNutrients: any[], ids: number[]): number {
  const n = foodNutrients.find((x: any) => ids.includes(x.nutrient?.id) || ids.includes(x.nutrientId));
  return n?.amount || n?.value || 0;
}

// Main execution function
async function main() {
  const args = process.argv.slice(2);
  const filePathArg = args.find(arg => !arg.startsWith('--'));
  if (!filePathArg) {
    console.error('❌ Error: Please provide the path to the FDC JSONL (.jsonl or .jsonl.gz) file.');
    console.log('Usage: npx ts-node scripts/ingest-fdc.ts <path-to-fdc.jsonl[.gz]>');
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
  let processedCount = 0;
  let foodBatch: any[] = [];
  let servingBatch: any[] = [];

  for await (const line of rl) {
    totalLines++;
    if (!line.trim()) continue;
    try {
      const product = JSON.parse(line);
      const fdcId = product.fdcId || product.id;
      if (!fdcId || !product.description) continue;

      const foodNutrients = product.foodNutrients || [];
      
      // Build a hybrid nutrients object containing flat macros + raw array for compatibility
      const nutrients = {
        calories: getNutrientValue(foodNutrients, [1008, 2047, 2048]),
        energy: getNutrientValue(foodNutrients, [1008, 2047, 2048]),
        protein: getNutrientValue(foodNutrients, [1003]),
        carbohydrate: getNutrientValue(foodNutrients, [1005]),
        carbs: getNutrientValue(foodNutrients, [1005]),
        fat: getNutrientValue(foodNutrients, [1004]),
        totalFat: getNutrientValue(foodNutrients, [1004]),
        fiber: getNutrientValue(foodNutrients, [1079]),
        sugar: getNutrientValue(foodNutrients, [2000, 1084]),
        sodium: getNutrientValue(foodNutrients, [1093]),
        foodNutrients: foodNutrients, // Keep the raw array for compatibility with map-ingredient-fdc.ts
      };

      const servingSize = product.servingSize ? parseFloat(product.servingSize) : null;
      const servingSizeUnit = product.servingSizeUnit || null;

      foodBatch.push({
        fdcId: fdcId,
        description: product.description,
        brandName: product.brandName || null,
        dataType: product.dataType || 'Branded',
        nutrientsPer100g: nutrients,
        servingSize,
        servingSizeUnit,
      });

      // Parse portions/servings
      const portions = product.foodPortions || [];
      for (const portion of portions) {
        const description = portion.measureUnit?.name || portion.modifier || 'portion';
        const grams = portion.gramWeight || 0;
        
        if (description && grams > 0) {
          servingBatch.push({
            fdcId: fdcId,
            description: description,
            grams: grams,
            prepModifier: portion.modifier || null,
            source: 'fdc',
            isAiEstimated: false,
          });
        }
      }

      processedCount++;

      // Flush batch when size matches
      if (foodBatch.length >= BATCH_SIZE) {
        await flushBatch(foodBatch, servingBatch);
        foodBatch = [];
        servingBatch = [];
      }
    } catch (err) {
      // Ignore individual line parsing errors
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
  console.log('══════════════════════════════════════════════════════════════');
}

async function flushBatch(foods: any[], servings: any[]) {
  try {
    // Insert foods (ignore conflicts/duplicates if run repeatedly)
    await prisma.fdcFood.createMany({
      data: foods,
      skipDuplicates: true,
    });

    // Insert servings matching the foods
    if (servings.length > 0) {
      // Filter out duplicate fdcId + description combinations from the batch to prevent unique constraint failures
      const uniqueServingsMap = new Map<string, any>();
      for (const s of servings) {
        const key = `${s.fdcId}::${s.description.toLowerCase().trim()}`;
        if (!uniqueServingsMap.has(key)) {
          uniqueServingsMap.set(key, s);
        }
      }
      
      await prisma.fdcServing.createMany({
        data: Array.from(uniqueServingsMap.values()),
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
