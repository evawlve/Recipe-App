/**
 * fix-orphan-vms.ts
 *
 * Resolves 12 orphan ValidatedMappings whose cache rows are missing.
 * Two categories:
 *   A. source=fatsecret but foodId=fdc_xxx  → source tag is wrong, fix to source='fdc'
 *      if the FDC cache row exists, otherwise delete the VM.
 *   B. source=fatsecret with a real FS foodId → cache row was evicted.
 *      Re-fetch from FatSecret API and reinsert into FatSecretFoodCache.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const FS_API_KEY = process.env.FATSECRET_API_KEY;
const FS_CLIENT_ID = process.env.FATSECRET_CLIENT_ID;
const FS_CLIENT_SECRET = process.env.FATSECRET_CLIENT_SECRET;

async function getFsToken(): Promise<string> {
  const creds = Buffer.from(`${FS_CLIENT_ID}:${FS_CLIENT_SECRET}`).toString('base64');
  const res = await fetch('https://oauth.fatsecret.com/connect/token', {
    method: 'POST',
    headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials&scope=basic',
  });
  const data = await res.json() as { access_token: string };
  return data.access_token;
}

async function fetchFsFood(foodId: string, token: string): Promise<{ nutrientsPer100g: Record<string, number>; servings: unknown } | null> {
  const url = `https://platform.fatsecret.com/rest/food/v4?food_id=${foodId}&format=json`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const data = await res.json() as { food?: { servings?: { serving?: unknown[] | unknown } } };
  const food = data.food;
  if (!food?.servings?.serving) return null;

  // Find the 100g serving
  const servingsArr = Array.isArray(food.servings.serving) ? food.servings.serving : [food.servings.serving];
  const per100 = (servingsArr as Array<Record<string, string>>).find(s =>
    s.serving_description?.includes('100g') || s.metric_serving_amount === '100'
  ) ?? (servingsArr as Array<Record<string, string>>)[0];

  if (!per100) return null;

  return {
    nutrientsPer100g: {
      calories: parseFloat(per100.calories ?? '0'),
      protein:  parseFloat(per100.protein  ?? '0'),
      carbs:    parseFloat(per100.carbohydrate ?? '0'),
      fat:      parseFloat(per100.fat      ?? '0'),
      fiber:    parseFloat(per100.fiber    ?? '0'),
      sodium:   parseFloat(per100.sodium   ?? '0'),
    },
    servings: servingsArr,
  };
}

async function main() {
  console.log('=== Fixing Orphan ValidatedMappings ===\n');

  // Load all FatSecret VMs
  const allFsVms = await prisma.validatedMapping.findMany({
    where: { source: 'fatsecret' },
    select: { id: true, rawIngredient: true, foodId: true, foodName: true },
  });

  // Find ones not in FatSecretFoodCache
  const fsCached = await prisma.fatSecretFoodCache.findMany({
    where: { id: { in: allFsVms.map(v => v.foodId) } },
    select: { id: true },
  });
  const fsCachedSet = new Set(fsCached.map(r => r.id));
  const orphans = allFsVms.filter(v => !fsCachedSet.has(v.foodId));

  console.log(`Found ${orphans.length} orphan VMs\n`);

  // Category A: source=fatsecret but foodId=fdc_xxx
  const fdcMistagged = orphans.filter(v => v.foodId.startsWith('fdc_'));
  // Category B: genuine FatSecret IDs with evicted cache rows
  const evicted = orphans.filter(v => !v.foodId.startsWith('fdc_'));

  console.log(`  Category A (FDC ID with wrong source tag) : ${fdcMistagged.length}`);
  console.log(`  Category B (FatSecret cache row evicted)  : ${evicted.length}\n`);

  // ── Category A: Fix source tag ────────────────────────────────────────────
  let fixedA = 0, deletedA = 0;
  for (const vm of fdcMistagged) {
    const numericId = parseInt(vm.foodId.replace('fdc_', ''));
    if (isNaN(numericId)) { console.log(`  [A] SKIP ${vm.id} — unparseable fdc id`); continue; }

    const fdcRow = await prisma.fdcFoodCache.findUnique({ where: { id: numericId }, select: { id: true } });
    if (fdcRow) {
      try {
        await prisma.validatedMapping.update({ where: { id: vm.id }, data: { source: 'fdc' } });
        console.log(`  [A] Fixed source tag → fdc  | "${vm.rawIngredient}" -> ${vm.foodName}`);
        fixedA++;
      } catch (err: unknown) {
        // P2002: unique constraint (normalizedForm, source) — a valid fdc VM already exists; delete the orphan
        if (typeof err === 'object' && err !== null && 'code' in err && (err as { code: string }).code === 'P2002') {
          await prisma.validatedMapping.delete({ where: { id: vm.id } });
          console.log(`  [A] Deleted (duplicate fdc VM exists) | "${vm.rawIngredient}"`);
          deletedA++;
        } else { throw err; }
      }
    } else {
      await prisma.validatedMapping.delete({ where: { id: vm.id } });
      console.log(`  [A] Deleted (FDC row gone)  | "${vm.rawIngredient}" -> ${vm.foodName}`);
      deletedA++;
    }
  }

  // ── Category B: Re-fetch from FatSecret ───────────────────────────────────
  if (evicted.length === 0) {
    console.log('\n[B] No genuine FatSecret orphans to re-fetch.');
  } else {
    if (!FS_CLIENT_ID || !FS_CLIENT_SECRET) {
      console.log('\n[B] FATSECRET_CLIENT_ID/SECRET not set — skipping API re-fetch.');
      console.log('    These VMs will remain orphaned until credentials are available:');
      for (const vm of evicted) console.log(`      ${vm.foodId} | "${vm.rawIngredient}"`);
    } else {
      console.log('\n[B] Re-fetching evicted FatSecret cache rows...');
      const token = await getFsToken();
      let refetched = 0, failedB = 0;
      for (const vm of evicted) {
        const result = await fetchFsFood(vm.foodId, token);
        if (!result) {
          console.log(`  [B] FAILED to fetch ${vm.foodId} | "${vm.rawIngredient}"`);
          failedB++;
          continue;
        }
        await prisma.fatSecretFoodCache.upsert({
          where:  { id: vm.foodId },
          create: { id: vm.foodId, name: vm.foodName, nutrientsPer100g: result.nutrientsPer100g },
          update: { nutrientsPer100g: result.nutrientsPer100g },
        });
        console.log(`  [B] Re-fetched ✓ ${vm.foodId} | "${vm.rawIngredient}" → Cal:${(result.nutrientsPer100g as Record<string,number>).calories}`);
        refetched++;
      }
      console.log(`\n  Re-fetched: ${refetched} | Failed: ${failedB}`);
    }
  }

  console.log('\n=== Summary ===');
  console.log(`  Category A fixed (source → fdc) : ${fixedA}`);
  console.log(`  Category A deleted (FDC gone)   : ${deletedA}`);
  console.log(`  Category B evicted              : ${evicted.length}`);
  console.log('\nDone. Re-run inspect-no-calorie.ts to verify.');
}

main().catch(console.error).finally(() => prisma.$disconnect());
