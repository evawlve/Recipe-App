/**
 * Migrate all ValidatedMapping normalizedForm values to canonical cache keys.
 *
 * For each entry:
 * 1. Compute the new canonical key (lowercase + singularize + sort)
 * 2. If the canonical key collides with another entry:
 *    - Keep the entry with the highest usedCount
 *    - Merge usage counts from the loser into the winner
 *    - Delete the loser
 * 3. Update normalizedForm to the canonical key
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/migrate-canonical-keys.ts
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/migrate-canonical-keys.ts --apply
 */

import { PrismaClient } from '@prisma/client';
import { canonicalizeCacheKey, singularize } from '../src/lib/fatsecret/normalization-rules';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
  console.log(APPLY ? '🔧 APPLY MODE' : '🔍 DRY-RUN MODE (pass --apply to write)');
  console.log('='.repeat(70));

  // Quick sanity check on singularize
  const tests: [string, string][] = [
    ['tomatoes', 'tomato'],
    ['berries', 'berry'],
    ['carrots', 'carrot'],
    ['potatoes', 'potato'],
    ['onions', 'onion'],
    ['mushrooms', 'mushroom'],
    ['leaves', 'leaf'],
    ['hummus', 'hummus'],
    ['asparagus', 'asparagus'],
    ['couscous', 'couscous'],
    ['swiss', 'swiss'],
    ['cherries', 'cherry'],
    ['radishes', 'radish'],
    ['sauces', 'sauce'],
    ['olives', 'olive'],
    ['noodles', 'noodle'],
    ['tortillas', 'tortilla'],
  ];

  console.log('\nSingularize sanity check:');
  let allPassed = true;
  for (const [input, expected] of tests) {
    const result = singularize(input);
    const ok = result === expected;
    if (!ok) allPassed = false;
    console.log(`  ${ok ? '✓' : '✗'} singularize("${input}") = "${result}" ${ok ? '' : `(expected "${expected}")`}`);
  }

  // Canonical key sanity check
  const keyTests: [string, string][] = [
    ['sour cream light', 'cream light sour'],
    ['light sour cream', 'cream light sour'],
    ['onions', 'onion'],
    ['onion', 'onion'],
    ['bell peppers', 'bell pepper'],
    ['Greek yogurt', 'greek yogurt'],
    ['creamy peanut butter', 'butter creamy peanut'],
    ['peanut butter', 'butter peanut'],
    ['red bell pepper', 'bell pepper red'],
    ['2% milk', '2% milk'],
    ['all-purpose flour', 'all-purpose flour'],
    ['all purpose flour', 'all flour purpose'],
  ];

  console.log('\nCanonical key sanity check:');
  for (const [input, expected] of keyTests) {
    const result = canonicalizeCacheKey(input);
    const ok = result === expected;
    if (!ok) allPassed = false;
    console.log(`  ${ok ? '✓' : '✗'} canonical("${input}") = "${result}" ${ok ? '' : `(expected "${expected}")`}`);
  }

  if (!allPassed) {
    console.log('\n❌ Some sanity checks failed. Aborting.');
    return;
  }
  console.log('\n✓ All sanity checks passed\n');

  // Load all mappings
  const allMappings = await prisma.validatedMapping.findMany({
    orderBy: { usedCount: 'desc' },
  });
  console.log(`Total ValidatedMappings: ${allMappings.length}`);

  // Group by (canonical_key, source) to find collisions
  type Entry = typeof allMappings[0];
  const groups = new Map<string, Entry[]>();

  for (const m of allMappings) {
    const canonical = canonicalizeCacheKey(m.normalizedForm);
    const groupKey = `${canonical}::${m.source}`;
    const existing = groups.get(groupKey) || [];
    existing.push(m);
    groups.set(groupKey, existing);
  }

  let updatedCount = 0;
  let deletedCount = 0;
  let mergedUsage = 0;
  let alreadyCanonical = 0;

  for (const [groupKey, entries] of groups) {
    const [canonical] = groupKey.split('::');

    if (entries.length === 1) {
      // No collision — just update normalizedForm if different
      const entry = entries[0];
      if (entry.normalizedForm === canonical) {
        alreadyCanonical++;
        continue;
      }

      console.log(`  UPDATE "${entry.normalizedForm}" → "${canonical}"  (${entry.usedCount}x, ${entry.foodName})`);
      updatedCount++;

      if (APPLY) {
        await prisma.validatedMapping.update({
          where: { id: entry.id },
          data: { normalizedForm: canonical },
        });
      }
    } else {
      // Collision — merge duplicates
      // Sort by usedCount descending — winner is the most-used
      entries.sort((a, b) => b.usedCount - a.usedCount);
      const winner = entries[0];
      const losers = entries.slice(1);
      const loserUsageTotal = losers.reduce((sum, e) => sum + e.usedCount, 0);

      // Delete losers FIRST (before updating winner) to avoid unique constraint violations
      // if a loser's normalizedForm already equals the target canonical key
      for (const loser of losers) {
        console.log(`  DELETE "${loser.normalizedForm}" (${loser.usedCount}x) → merged into "${canonical}" (${winner.foodName})`);
        deletedCount++;
        mergedUsage += loser.usedCount;

        if (APPLY) {
          await prisma.validatedMapping.delete({
            where: { id: loser.id },
          });
        }
      }

      // Now update winner's normalizedForm and merge usage counts
      const needsUpdate = winner.normalizedForm !== canonical || loserUsageTotal > 0;
      if (needsUpdate) {
        if (winner.normalizedForm !== canonical) {
          console.log(`  UPDATE (winner) "${winner.normalizedForm}" → "${canonical}"  (${winner.usedCount}x, ${winner.foodName})`);
          updatedCount++;
        }

        if (APPLY) {
          await prisma.validatedMapping.update({
            where: { id: winner.id },
            data: {
              normalizedForm: canonical,
              usedCount: { increment: loserUsageTotal },
            },
          });
        }
      }
    }
  }

  console.log('\n' + '='.repeat(70));
  console.log(` ${APPLY ? 'APPLIED' : 'DRY-RUN'} Summary`);
  console.log('='.repeat(70));
  console.log(`  Already canonical:      ${alreadyCanonical}`);
  console.log(`  Updated normalizedForm: ${updatedCount}`);
  console.log(`  Deleted (merged):       ${deletedCount}`);
  console.log(`  Usage counts merged:    ${mergedUsage}`);

  if (APPLY) {
    const remaining = await prisma.validatedMapping.count();
    console.log(`  Remaining mappings:     ${remaining}`);
  } else {
    console.log(`\n  ➡️  Run with --apply to execute these changes`);
  }
  console.log('='.repeat(70));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
