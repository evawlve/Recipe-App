/**
 * Diagnose mapping coverage and ValidatedMapping duplicates.
 *
 * 1. Count unmapped ingredients (no active IngredientFoodMap with fatsecretFoodId or aiGeneratedFoodId).
 * 2. Find ValidatedMapping "duplicates" — normalizedForms that resolve to the same
 *    underlying food but are stored as separate rows due to minor wording differences.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ─── helpers ───────────────────────────────────────────────────────────────

/** Cheap canonical key: lowercase, sort words, strip common filler */
function canonicalKey(name: string): string {
  const STOP = new Set([
    'raw', 'fresh', 'whole', 'pure', 'organic', 'natural',
    'plain', 'regular', 'original', 'classic',
    'the', 'a', 'an', 'of', 'and', '&',
  ]);
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 1 && !STOP.has(w))
    .sort()
    .join(' ');
}

/** Check if two normalizedForms are "close" via containment or prefix */
function isCloseMatch(a: string, b: string): boolean {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  if (al === bl) return true;
  if (al.includes(bl) || bl.includes(al)) return true;
  // Check sorted-token equivalence
  return canonicalKey(a) === canonicalKey(b);
}

// ─── main ──────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(70));
  console.log(' Mapping Diagnostic Report');
  console.log('='.repeat(70));

  // ─── 1. Unmapped ingredients ──────────────────────────────────────────

  const totalIngredients = await prisma.ingredient.count();

  // Ingredients that have at least one active mapping with a real food link
  const mappedIngredientIds = await prisma.ingredientFoodMap.findMany({
    where: {
      isActive: true,
      OR: [
        { fatsecretFoodId: { not: null } },
        { aiGeneratedFoodId: { not: null } },
        { foodId: { not: null } },
      ],
    },
    select: { ingredientId: true },
    distinct: ['ingredientId'],
  });

  const mappedCount = mappedIngredientIds.length;
  const unmappedCount = totalIngredients - mappedCount;

  console.log('\n── 1. Ingredient Coverage ──────────────────────────────────');
  console.log(`  Total ingredients:     ${totalIngredients.toLocaleString()}`);
  console.log(`  Mapped (any source):   ${mappedCount.toLocaleString()}`);
  console.log(`  UNMAPPED:              ${unmappedCount.toLocaleString()}`);
  console.log(`  Coverage:              ${((mappedCount / totalIngredients) * 100).toFixed(1)}%`);

  // Also count by mapping source
  const fatsecretMapped = await prisma.ingredientFoodMap.findMany({
    where: { isActive: true, fatsecretFoodId: { not: null } },
    select: { ingredientId: true },
    distinct: ['ingredientId'],
  });
  const aiGenMapped = await prisma.ingredientFoodMap.findMany({
    where: { isActive: true, aiGeneratedFoodId: { not: null } },
    select: { ingredientId: true },
    distinct: ['ingredientId'],
  });
  const foodTableMapped = await prisma.ingredientFoodMap.findMany({
    where: { isActive: true, foodId: { not: null } },
    select: { ingredientId: true },
    distinct: ['ingredientId'],
  });
  console.log(`\n  By source:`);
  console.log(`    FatSecret:           ${fatsecretMapped.length.toLocaleString()}`);
  console.log(`    AI-Generated:        ${aiGenMapped.length.toLocaleString()}`);
  console.log(`    Food table:          ${foodTableMapped.length.toLocaleString()}`);

  // ─── 2. Unmapped ingredient names (sample) ────────────────────────────

  const mappedIdSet = new Set(mappedIngredientIds.map(m => m.ingredientId));
  
  // Get a sample of unmapped ingredients
  const allIngredients = await prisma.ingredient.findMany({
    select: { id: true, name: true },
  });
  const unmappedNames: string[] = [];
  for (const ing of allIngredients) {
    if (!mappedIdSet.has(ing.id)) {
      unmappedNames.push(ing.name);
    }
  }

  // Count unique unmapped names
  const uniqueUnmappedNames = [...new Set(unmappedNames.map(n => n.toLowerCase().trim()))];
  console.log(`\n  Unique unmapped names: ${uniqueUnmappedNames.length.toLocaleString()}`);

  // Show top 30 by frequency
  const nameFreq = new Map<string, number>();
  for (const n of unmappedNames) {
    const key = n.toLowerCase().trim();
    nameFreq.set(key, (nameFreq.get(key) || 0) + 1);
  }
  const sorted = [...nameFreq.entries()].sort((a, b) => b[1] - a[1]);

  console.log(`\n  Top 30 unmapped ingredients (by frequency):`);
  for (const [name, count] of sorted.slice(0, 30)) {
    console.log(`    ${count.toString().padStart(4)}x  "${name}"`);
  }

  // ─── 3. ValidatedMapping stats ────────────────────────────────────────

  const totalMappings = await prisma.validatedMapping.count();
  const aliasMappings = await prisma.validatedMapping.count({ where: { isAlias: true } });
  const fdcMappings = await prisma.validatedMapping.count({
    where: { foodId: { startsWith: 'fdc_' } },
  });
  const fsMappings = totalMappings - fdcMappings;

  console.log('\n── 2. ValidatedMapping Stats ───────────────────────────────');
  console.log(`  Total mappings:        ${totalMappings.toLocaleString()}`);
  console.log(`  Aliases:               ${aliasMappings.toLocaleString()}`);
  console.log(`  FDC-backed:            ${fdcMappings.toLocaleString()}`);
  console.log(`  FatSecret-backed:      ${fsMappings.toLocaleString()}`);

  // ─── 4. Duplicate / overlapping normalizedForms ───────────────────────

  console.log('\n── 3. ValidatedMapping Duplicate Analysis ──────────────────');

  const allMappings = await prisma.validatedMapping.findMany({
    select: {
      id: true,
      normalizedForm: true,
      foodId: true,
      foodName: true,
      brandName: true,
      aiConfidence: true,
      source: true,
      usedCount: true,
    },
    orderBy: { normalizedForm: 'asc' },
  });

  // Group by foodId → find different normalizedForms pointing to same food
  const foodIdGroups = new Map<string, typeof allMappings>();
  for (const m of allMappings) {
    const existing = foodIdGroups.get(m.foodId) || [];
    existing.push(m);
    foodIdGroups.set(m.foodId, existing);
  }

  // Find foods with >1 normalizedForm
  const multiFormFoods: Array<{
    foodId: string;
    foodName: string;
    brandName: string | null;
    forms: string[];
    usedCounts: number[];
  }> = [];

  for (const [foodId, entries] of foodIdGroups) {
    if (entries.length > 1) {
      multiFormFoods.push({
        foodId,
        foodName: entries[0].foodName,
        brandName: entries[0].brandName,
        forms: entries.map(e => e.normalizedForm),
        usedCounts: entries.map(e => e.usedCount),
      });
    }
  }

  console.log(`  Foods with >1 normalizedForm: ${multiFormFoods.length}`);

  // Now find the truly "duplicate" ones — close forms that probably shouldn't be separate
  const suspiciousDups: typeof multiFormFoods = [];

  for (const group of multiFormFoods) {
    // Check if any pair of forms within this group are "close"
    let hasCloseMatch = false;
    for (let i = 0; i < group.forms.length && !hasCloseMatch; i++) {
      for (let j = i + 1; j < group.forms.length && !hasCloseMatch; j++) {
        if (isCloseMatch(group.forms[i], group.forms[j])) {
          hasCloseMatch = true;
        }
      }
    }
    if (hasCloseMatch) {
      suspiciousDups.push(group);
    }
  }

  console.log(`  Suspicious duplicates (close normalizedForms → same food): ${suspiciousDups.length}`);

  if (suspiciousDups.length > 0) {
    console.log(`\n  Duplicate groups (showing up to 50):`);
    for (const dup of suspiciousDups.slice(0, 50)) {
      const brand = dup.brandName ? ` (${dup.brandName})` : '';
      console.log(`\n    → "${dup.foodName}"${brand}  [${dup.foodId}]`);
      for (let i = 0; i < dup.forms.length; i++) {
        console.log(`      - "${dup.forms[i]}"  (used ${dup.usedCounts[i]}x)`);
      }
    }
  }

  // ─── 5. Cross-food duplicates ─────────────────────────────────────────
  // Different normalizedForms that point to DIFFERENT foods but 
  // look like they should be the same ingredient
  console.log('\n── 4. Cross-Food Semantic Duplicates ───────────────────────');
  console.log('  (Different normalizedForms → different foods, but forms look similar)');

  // Build canonical-key → entries map
  const canonicalGroups = new Map<string, typeof allMappings>();
  for (const m of allMappings) {
    const key = canonicalKey(m.normalizedForm);
    if (!key) continue;
    const existing = canonicalGroups.get(key) || [];
    existing.push(m);
    canonicalGroups.set(key, existing);
  }

  // Find canonical keys that map to multiple DIFFERENT foodIds
  type CrossDup = {
    canonicalKey: string;
    entries: Array<{ normalizedForm: string; foodId: string; foodName: string; brandName: string | null; usedCount: number }>;
  };
  const crossFoodDups: CrossDup[] = [];

  for (const [key, entries] of canonicalGroups) {
    const uniqueFoodIds = new Set(entries.map(e => e.foodId));
    if (uniqueFoodIds.size > 1) {
      crossFoodDups.push({
        canonicalKey: key,
        entries: entries.map(e => ({
          normalizedForm: e.normalizedForm,
          foodId: e.foodId,
          foodName: e.foodName,
          brandName: e.brandName,
          usedCount: e.usedCount,
        })),
      });
    }
  }

  console.log(`  Cross-food duplicate groups: ${crossFoodDups.length}`);

  if (crossFoodDups.length > 0) {
    // Sort by total usage (more used = more impactful)
    crossFoodDups.sort((a, b) => {
      const aTotal = a.entries.reduce((s, e) => s + e.usedCount, 0);
      const bTotal = b.entries.reduce((s, e) => s + e.usedCount, 0);
      return bTotal - aTotal;
    });

    console.log(`\n  Top 50 cross-food duplicates (by usage):`);
    for (const dup of crossFoodDups.slice(0, 50)) {
      console.log(`\n    canonical: "${dup.canonicalKey}"`);
      for (const e of dup.entries) {
        const brand = e.brandName ? ` (${e.brandName})` : '';
        console.log(`      - "${e.normalizedForm}" → "${e.foodName}"${brand}  [used ${e.usedCount}x]`);
      }
    }
  }

  // ─── 6. Summary ───────────────────────────────────────────────────────

  console.log('\n' + '='.repeat(70));
  console.log(' Summary');
  console.log('='.repeat(70));
  console.log(`  Unmapped ingredients:          ${unmappedCount.toLocaleString()} / ${totalIngredients.toLocaleString()}`);
  console.log(`  Unique unmapped names:         ${uniqueUnmappedNames.length.toLocaleString()}`);
  console.log(`  ValidatedMappings:             ${totalMappings.toLocaleString()}`);
  console.log(`  Same-food dup groups:          ${suspiciousDups.length}`);
  console.log(`  Cross-food semantic dup groups: ${crossFoodDups.length}`);
  console.log('='.repeat(70));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
