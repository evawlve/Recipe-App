/**
 * inspect-no-calorie.ts
 * 
 * Identifies the ~93 VMs still missing calorie data after the kcal→calories migration.
 * Cross-checks the cache row to understand why they are null.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Load all VMs
  const vms = await prisma.validatedMapping.findMany({
    select: { foodId: true, source: true, rawIngredient: true, foodName: true, brandName: true },
  });

  console.log(`Total VMs: ${vms.length}`);

  // Hydrate nutrition (same logic as verify-vm-nutrition.ts)
  const offIds  = vms.filter(v => v.source === 'openfoodfacts').map(v => v.foodId);
  const fsIds   = vms.filter(v => v.source === 'fatsecret').map(v => v.foodId);
  const fdcVMs  = vms.filter(v => v.source === 'fdc')
    .map(v => ({ vmFoodId: v.foodId, numericId: Number(v.foodId.replace(/^fdc_/, '')) }))
    .filter(({ numericId }) => !isNaN(numericId));

  // Fetch cache rows
  const [offRows, fsRows, fdcRows] = await Promise.all([
    prisma.openFoodFactsCache.findMany({
      where: { id: { in: offIds } },
      select: { id: true, name: true, nutrientsPer100g: true },
    }),
    prisma.fatSecretFoodCache.findMany({
      where: { id: { in: fsIds } },
      select: { id: true, name: true, nutrientsPer100g: true },
    }),
    prisma.fdcFoodCache.findMany({
      where: { id: { in: fdcVMs.map(v => v.numericId) } },
      select: { id: true, description: true, nutrients: true },
    }),
  ]);

  // Build calorie map
  type Entry = { calories: number | null; keys: string[] | null; isNullRow: boolean };
  const cal = new Map<string, Entry>();

  for (const r of offRows) {
    const n = r.nutrientsPer100g as Record<string, unknown> | null;
    cal.set(r.id, {
      calories: n ? (n.calories ?? n.kcal) as number | null : null,
      keys: n ? Object.keys(n) : null,
      isNullRow: !n,
    });
  }
  for (const r of fsRows) {
    const n = r.nutrientsPer100g as Record<string, unknown> | null;
    cal.set(r.id, {
      calories: n ? (n.calories ?? n.kcal) as number | null : null,
      keys: n ? Object.keys(n) : null,
      isNullRow: !n,
    });
  }
  for (const r of fdcRows) {
    const n = r.nutrients as Record<string, unknown>;
    const numericId = r.id;
    const vmFoodId  = fdcVMs.find(v => v.numericId === numericId)?.vmFoodId ?? `fdc_${r.id}`;
    cal.set(vmFoodId, {
      calories: (n.calories ?? n.energy) as number | null,
      keys: Object.keys(n),
      isNullRow: false,
    });
  }

  // Find missing
  const missing = vms.filter(v => {
    const entry = cal.get(v.foodId);
    return !entry || entry.calories == null;
  });

  console.log(`\nVMs with no calorie data: ${missing.length}`);

  // Categorize
  const noCache       = missing.filter(v => !cal.has(v.foodId));
  const nullRow       = missing.filter(v => cal.get(v.foodId)?.isNullRow);
  const nullCalInJson = missing.filter(v => {
    const e = cal.get(v.foodId);
    return e && !e.isNullRow && e.calories == null;
  });

  console.log(`\n  Not in cache at all (orphan VMs)         : ${noCache.length}`);
  console.log(`  Cache row exists but nutrientsPer100g=null: ${nullRow.length}`);
  console.log(`  Cache row has JSON but no calories key    : ${nullCalInJson.length}`);

  if (noCache.length > 0) {
    console.log('\n  Sample orphan VMs (VM exists, cache row gone):');
    noCache.slice(0, 10).forEach(v =>
      console.log(`    [${v.source}] ${v.foodId} | "${v.rawIngredient}" -> ${v.foodName}`)
    );
  }

  if (nullRow.length > 0) {
    console.log('\n  Sample null-nutrient cache rows:');
    nullRow.slice(0, 10).forEach(v =>
      console.log(`    [${v.source}] ${v.foodId} | "${v.rawIngredient}" -> ${v.foodName}`)
    );
  }

  if (nullCalInJson.length > 0) {
    console.log('\n  Sample entries with JSON but no calories key:');
    nullCalInJson.slice(0, 10).forEach(v => {
      const e = cal.get(v.foodId)!;
      console.log(`    [${v.source}] ${v.foodId} | "${v.rawIngredient}" -> ${v.foodName} | keys: ${JSON.stringify(e.keys)}`);
    });
  }

  // Source breakdown
  console.log('\n  Source breakdown of missing:');
  const bySource = new Map<string, number>();
  for (const v of missing) bySource.set(v.source, (bySource.get(v.source) ?? 0) + 1);
  for (const [src, count] of [...bySource.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${src.padEnd(16)} ${count}`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
