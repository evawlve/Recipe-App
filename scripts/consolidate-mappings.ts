/**
 * Consolidate ValidatedMapping duplicates.
 *
 * Two categories:
 * 1. SAME-FOOD DUPS: Different normalizedForms → same foodId.
 *    Keep the most-used entry, delete the rest (the cache lookup has a
 *    token-set fallback that handles word-order variance, and normalization
 *    should collapse singular/plural at runtime).
 *
 * 2. CROSS-FOOD DUPS: Different normalizedForms → different foodIds,
 *    but the forms are semantically equivalent (e.g. "all-purpose flour"
 *    vs "all purpose flour"). Consolidate to the most-used food.
 *
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/consolidate-mappings.ts
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/consolidate-mappings.ts --apply
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

// ─── helpers ───────────────────────────────────────────────────────────────

/** Canonical key: lowercase, sort tokens, strip filler words */
function canonicalKey(name: string): string {
  const STOP = new Set([
    'raw', 'fresh',
    'the', 'a', 'an', 'of', 'and', '&',
  ]);
  return name
    .toLowerCase()
    .replace(/[^a-z0-9%\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP.has(w))
    .sort()
    .join(' ');
}

/** Check if two forms are "close" (containment or sorted-token equivalence) */
/** Nutritional modifiers that indicate genuinely different products */
const NUTRITIONAL_MODIFIERS = [
  'whole', 'skim', 'nonfat', 'non-fat', 'fat free', 'fat-free',
  'low fat', 'lowfat', 'low-fat', 'reduced fat', 'reduced-fat',
  'light', 'lite', 'diet', 'sugar free', 'sugar-free',
  'unsweetened', 'sweetened', 'organic', 'natural',
  'plain', 'original', 'dark', 'mild', 'lean',
  '1%', '2%', '0%',
];

/** Check if two forms differ by a nutritional modifier */
function differsByNutritionalModifier(a: string, b: string): boolean {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  for (const mod of NUTRITIONAL_MODIFIERS) {
    const aHas = al.includes(mod);
    const bHas = bl.includes(mod);
    if (aHas !== bHas) return true;
  }
  return false;
}

function isCloseMatch(a: string, b: string): boolean {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al === bl) return true;
  // Don't consider items "close" if they differ by a nutritional modifier
  if (differsByNutritionalModifier(a, b)) return false;
  if (al.includes(bl) || bl.includes(al)) return true;
  return canonicalKey(a) === canonicalKey(b);
}

type MappingRow = {
  id: string;
  normalizedForm: string;
  rawIngredient: string;
  foodId: string;
  foodName: string;
  brandName: string | null;
  source: string;
  aiConfidence: number;
  usedCount: number;
};

// ─── main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log(APPLY ? '🔧 APPLY MODE — changes will be written to the database' : '🔍 DRY-RUN MODE — pass --apply to write changes');
  console.log('='.repeat(70));

  const allMappings = await prisma.validatedMapping.findMany({
    select: {
      id: true,
      normalizedForm: true,
      rawIngredient: true,
      foodId: true,
      foodName: true,
      brandName: true,
      source: true,
      aiConfidence: true,
      usedCount: true,
    },
    orderBy: { usedCount: 'desc' },
  });

  console.log(`Total ValidatedMappings: ${allMappings.length}\n`);

  // ─── 1. Same-food duplicates ────────────────────────────────────────

  console.log('── 1. Same-Food Duplicates ──────────────────────────────────');
  console.log('   (multiple normalizedForms → same foodId)\n');

  const foodIdGroups = new Map<string, MappingRow[]>();
  for (const m of allMappings) {
    const key = `${m.foodId}::${m.source}`;
    const existing = foodIdGroups.get(key) || [];
    existing.push(m);
    foodIdGroups.set(key, existing);
  }

  let sameFoodDeleteCount = 0;
  let sameFoodUsageMerged = 0;
  const sameFoodDeletions: string[] = [];

  for (const [, entries] of foodIdGroups) {
    if (entries.length <= 1) continue;

    // Check if any pair is a "close" match
    const closePairs: Array<[MappingRow, MappingRow]> = [];
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        if (isCloseMatch(entries[i].normalizedForm, entries[j].normalizedForm)) {
          closePairs.push([entries[i], entries[j]]);
        }
      }
    }

    if (closePairs.length === 0) continue;

    // For each close pair, keep the most-used, delete the other
    // Sort descending by usedCount first
    entries.sort((a, b) => b.usedCount - a.usedCount);
    const winner = entries[0]; // highest usedCount

    for (const entry of entries.slice(1)) {
      if (!isCloseMatch(winner.normalizedForm, entry.normalizedForm)) continue;

      console.log(`  DELETE "${entry.normalizedForm}" (${entry.usedCount}x) — kept "${winner.normalizedForm}" (${winner.usedCount}x)  [${winner.foodName}]`);
      sameFoodDeleteCount++;
      sameFoodUsageMerged += entry.usedCount;
      sameFoodDeletions.push(entry.id);

      if (APPLY) {
        // Merge usage count into winner before deleting
        await prisma.validatedMapping.update({
          where: { id: winner.id },
          data: { usedCount: { increment: entry.usedCount } },
        });
        await prisma.validatedMapping.delete({ where: { id: entry.id } });
      }
    }
  }

  console.log(`\n  Summary: ${sameFoodDeleteCount} entries to delete, ${sameFoodUsageMerged} usage counts to merge\n`);

  // ─── 2. Cross-food semantic duplicates ──────────────────────────────

  console.log('── 2. Cross-Food Semantic Duplicates ────────────────────────');
  console.log('   (different normalizedForms → different foodIds, but same canonical key)\n');

  // Group by canonical key
  const canonicalGroups = new Map<string, MappingRow[]>();
  for (const m of allMappings) {
    // Skip already-deleted entries
    if (sameFoodDeletions.includes(m.id)) continue;

    const key = canonicalKey(m.normalizedForm);
    if (!key) continue;
    const existing = canonicalGroups.get(key) || [];
    existing.push(m);
    canonicalGroups.set(key, existing);
  }

  let crossFoodUpdateCount = 0;

  for (const [key, entries] of canonicalGroups) {
    // Only care about groups with multiple DIFFERENT foodIds
    const uniqueFoodIds = new Set(entries.map(e => e.foodId));
    if (uniqueFoodIds.size <= 1) continue;

    // Pick winner: highest total usage
    entries.sort((a, b) => b.usedCount - a.usedCount);
    const winner = entries[0];

    console.log(`  canonical: "${key}"`);
    console.log(`    KEEP: "${winner.normalizedForm}" → "${winner.foodName}" (${winner.usedCount}x)`);

    for (const entry of entries.slice(1)) {
      if (entry.foodId === winner.foodId) continue; // already same food

      console.log(`    UPDATE: "${entry.normalizedForm}" → was "${entry.foodName}" (${entry.usedCount}x) → now "${winner.foodName}"`);
      crossFoodUpdateCount++;

      if (APPLY) {
        await prisma.validatedMapping.update({
          where: { id: entry.id },
          data: {
            foodId: winner.foodId,
            foodName: winner.foodName,
            brandName: winner.brandName,
            aiConfidence: winner.aiConfidence,
          },
        });
      }
    }
    console.log();
  }

  console.log(`  Summary: ${crossFoodUpdateCount} entries to update\n`);

  // ─── 3. Final summary ──────────────────────────────────────────────

  console.log('='.repeat(70));
  console.log(` ${APPLY ? 'APPLIED' : 'DRY-RUN'} Summary`);
  console.log('='.repeat(70));
  console.log(`  Same-food dups deleted:       ${sameFoodDeleteCount}`);
  console.log(`  Usage counts merged:          ${sameFoodUsageMerged}`);
  console.log(`  Cross-food dups consolidated: ${crossFoodUpdateCount}`);
  console.log(`  Total rows affected:          ${sameFoodDeleteCount + crossFoodUpdateCount}`);

  if (!APPLY) {
    console.log(`\n  ➡️  Run with --apply to execute these changes`);
  } else {
    const remaining = await prisma.validatedMapping.count();
    console.log(`\n  ValidatedMappings remaining:  ${remaining}`);
  }

  console.log('='.repeat(70));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
