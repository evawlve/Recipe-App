/**
 * migrate-off-kcal-to-calories.ts
 *
 * One-time migration: normalizes the nutrientsPer100g JSON column in
 * OpenFoodFactsCache for all rows seeded by bulk-seed-branded-off.ts.
 *
 * Problem: bulk-seed-branded-off.ts stored energy as { kcal: 232, ... }
 *          but hydrate.ts and search.ts expect { calories: 232, ... }.
 *          This causes scoring to think OFF entries have no nutrition.
 *
 * Fix: for each row where `kcal` key exists but `calories` key does not,
 *       rename kcal → calories in place.
 *
 * Safe to re-run (idempotent — rows already using 'calories' are untouched).
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only \
 *     -r tsconfig-paths/register scripts/migrate-off-kcal-to-calories.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const BATCH_SIZE = 200;

async function main() {
  console.log('OFF nutrientsPer100g migration: kcal → calories');
  console.log('='.repeat(55));

  // Count affected rows first
  const total = await prisma.openFoodFactsCache.count();
  console.log(`Total OFF cache rows: ${total}`);

  let offset = 0;
  let migrated = 0;
  let alreadyCorrect = 0;
  let nullNutrients = 0;
  let noKcalKey = 0;

  while (true) {
    const rows = await prisma.openFoodFactsCache.findMany({
      select: { id: true, nutrientsPer100g: true },
      skip: offset,
      take: BATCH_SIZE,
      orderBy: { id: 'asc' },
    });

    if (rows.length === 0) break;
    offset += rows.length;

    // Collect rows that need updating, then apply sequentially
    const toUpdate: Array<{ id: string; data: Record<string, unknown> }> = [];

    for (const row of rows) {
      if (!row.nutrientsPer100g) {
        nullNutrients++;
        continue;
      }

      const n = row.nutrientsPer100g as Record<string, unknown>;

      // Already has calories key — nothing to do
      if (n.calories != null) {
        alreadyCorrect++;
        continue;
      }

      // Has kcal key but no calories — migrate it
      if (n.kcal != null) {
        const migrated_n: Record<string, unknown> = {
          calories: n.kcal,
        };
        if (n.protein != null) migrated_n.protein = n.protein;
        if (n.carbs   != null) migrated_n.carbs   = n.carbs;
        if (n.fat     != null) migrated_n.fat     = n.fat;
        if (n.fiber   != null) migrated_n.fiber   = n.fiber;
        if (n.sugars  != null) migrated_n.sugars  = n.sugars;
        if (n.sodium  != null) migrated_n.sodium  = n.sodium;

        toUpdate.push({ id: row.id, data: migrated_n });
        migrated++;
        continue;
      }

      // Has neither kcal nor calories key
      noKcalKey++;
    }

    // Execute updates one at a time to avoid connection pool exhaustion
    for (const { id, data } of toUpdate) {
      await prisma.openFoodFactsCache.update({
        where: { id },
        data: { nutrientsPer100g: data as any },
      });
    }

    const processed = offset;
    if (processed % 2000 === 0 || rows.length < BATCH_SIZE) {
      console.log(
        `  [${processed}/${total}] migrated: ${migrated} | already correct: ${alreadyCorrect} | no kcal/calories: ${noKcalKey} | null: ${nullNutrients}`
      );
    }
  }

  console.log('');
  console.log('='.repeat(55));
  console.log('MIGRATION COMPLETE');
  console.log('='.repeat(55));
  console.log(`Total rows scanned   : ${total}`);
  console.log(`Migrated (kcal→cal)  : ${migrated}`);
  console.log(`Already correct      : ${alreadyCorrect}`);
  console.log(`No energy key at all : ${noKcalKey}`);
  console.log(`Null nutrientsPer100g: ${nullNutrients}`);

  if (migrated === 0 && alreadyCorrect > 0) {
    console.log('\n✅ All rows already use the canonical "calories" key — migration not needed.');
  } else if (migrated > 0) {
    console.log(`\n✅ Successfully migrated ${migrated} rows from "kcal" → "calories".`);
  }
}

main()
  .catch(err => { console.error(err); process.exit(1); })
  .finally(() => prisma.$disconnect());
