/**
 * Clear Poisoned ValidatedMapping Entries
 * 
 * Removes ValidatedMapping entries where the cached food has nutritional modifiers
 * (powdered, reduced fat, etc.) that don't belong to the base normalizedForm.
 * Also clears specific known-bad entries identified in the P0 investigation.
 * 
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/clear-poisoned-mappings.ts
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/clear-poisoned-mappings.ts --all
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const KNOWN_POISONED = [
  // P0: "peanut butter" → "Powdered Peanut Butter" (Great Value)
  { normalizedForm: 'peanut butter', source: 'fatsecret' },
  // P0: "matcha powder" → "ORGANIC MATCHA POWDER" (dry powder instead of tea)
  { normalizedForm: 'matcha powder', source: 'fatsecret' },
  // P1: "cheddar cheese" → "Cheddar Cheese (Reduced Fat)"
  { normalizedForm: 'cheddar cheese', source: 'fatsecret' },
];

async function main() {
  const clearAll = process.argv.includes('--all');

  if (clearAll) {
    console.log('Clearing ALL ValidatedMapping entries...');
    const { count } = await prisma.validatedMapping.deleteMany({});
    console.log(`Deleted ${count} ValidatedMapping entries.`);

    console.log('\nClearing ALL AiNormalizeCache entries...');
    const normCount = await prisma.aiNormalizeCache.deleteMany({});
    console.log(`Deleted ${normCount.count} AiNormalizeCache entries.`);
  } else {
    console.log('Clearing known-poisoned ValidatedMapping entries...\n');

    for (const entry of KNOWN_POISONED) {
      try {
        const existing = await prisma.validatedMapping.findUnique({
          where: {
            normalizedForm_source: {
              normalizedForm: entry.normalizedForm,
              source: entry.source,
            },
          },
        });

        if (existing) {
          await prisma.validatedMapping.delete({
            where: { id: existing.id },
          });
          console.log(`✅ Deleted: "${entry.normalizedForm}" → "${existing.foodName}" (usedCount: ${existing.usedCount})`);
        } else {
          console.log(`⏭️  Not found: "${entry.normalizedForm}" (already clean)`);
        }
      } catch (error) {
        console.error(`❌ Error clearing "${entry.normalizedForm}":`, (error as Error).message);
      }
    }

    // Also detect and report other potentially poisoned entries
    console.log('\n--- Scanning for other potential modifier mismatches ---\n');
    const MODIFIERS = ['powdered', 'reduced fat', 'low fat', 'fat free', 'sugar free', 'lite', 'light', 'diet'];

    const allMappings = await prisma.validatedMapping.findMany({
      select: { normalizedForm: true, foodName: true, usedCount: true },
    });

    let suspicious = 0;
    for (const m of allMappings) {
      const normLower = m.normalizedForm.toLowerCase();
      const foodLower = m.foodName.toLowerCase();
      for (const mod of MODIFIERS) {
        if (foodLower.includes(mod) && !normLower.includes(mod)) {
          console.log(`⚠️  Suspicious: "${m.normalizedForm}" → "${m.foodName}" (used ${m.usedCount}×)`);
          suspicious++;
          break;
        }
      }
    }

    if (suspicious === 0) {
      console.log('No additional suspicious entries found.');
    } else {
      console.log(`\nFound ${suspicious} suspicious entries. Run with --all to clear everything.`);
    }
  }

  await prisma.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
