import { PrismaClient } from '@prisma/client';

const p = new PrismaClient();

async function main() {
  // === 1. PEANUT BUTTER INVESTIGATION ===
  console.log('='.repeat(60));
  console.log('1. PEANUT BUTTER CACHE INVESTIGATION');
  console.log('='.repeat(60));

  const pbMappings = await p.validatedMapping.findMany({
    where: { normalizedForm: { contains: 'peanut butter' } },
  });
  console.log(`\nValidatedMapping entries (${pbMappings.length} found):`);
  for (const m of pbMappings) {
    console.log(`  normalizedForm: "${m.normalizedForm}"`);
    console.log(`  rawIngredient: "${m.rawIngredient}"`);
    console.log(`  foodId: ${m.foodId}`);
    console.log(`  foodName: "${m.foodName}"`);
    console.log(`  brandName: "${m.brandName}"`);
    console.log(`  aiConfidence: ${m.aiConfidence}`);
    console.log(`  source: ${m.source}`);
    console.log(`  usedCount: ${m.usedCount}`);
    console.log('  ---');
  }

  // Check AiNormalizeCache for peanut butter
  const pbNormCache = await p.aiNormalizeCache.findMany({
    where: { normalizedName: { contains: 'peanut butter' } },
  });
  console.log(`\nAiNormalizeCache entries (${pbNormCache.length} found):`);
  for (const c of pbNormCache) {
    console.log(`  normalizedKey: "${c.normalizedKey}"`);
    console.log(`  normalizedName: "${c.normalizedName}"`);
    console.log(`  canonicalBase: "${c.canonicalBase}"`);
    console.log(`  synonyms: ${JSON.stringify(c.synonyms)}`);
    console.log('  ---');
  }

  // === 2. BEEF BOUILLON INVESTIGATION ===
  console.log('\n' + '='.repeat(60));
  console.log('2. BEEF BOUILLON INVESTIGATION');
  console.log('='.repeat(60));

  const bouillonMappings = await p.validatedMapping.findMany({
    where: { normalizedForm: { contains: 'bouillon' } },
  });
  console.log(`\nValidatedMapping entries (${bouillonMappings.length} found):`);
  for (const m of bouillonMappings) {
    console.log(`  normalizedForm: "${m.normalizedForm}"`);
    console.log(`  rawIngredient: "${m.rawIngredient}"`);
    console.log(`  foodId: ${m.foodId}`);
    console.log(`  foodName: "${m.foodName}"`);
    console.log(`  brandName: "${m.brandName}"`);
    console.log(`  aiConfidence: ${m.aiConfidence}`);
    console.log('  ---');
  }

  const bouillonFoods = await p.fatSecretFoodCache.findMany({
    where: { name: { contains: 'bouillon' } },
  });
  console.log(`\nFatSecretFoodCache entries (${bouillonFoods.length} found):`);
  for (const f of bouillonFoods) {
    console.log(`  id: "${f.id}"`);
    console.log(`  name: "${f.name}"`);
    console.log(`  brandName: "${f.brandName}"`);
    console.log(`  foodType: "${f.foodType}"`);
    console.log('  ---');
  }

  if (bouillonFoods.length > 0) {
    const bouillonServings = await p.fatSecretServingCache.findMany({
      where: { foodId: { in: bouillonFoods.map(f => f.id) } },
    });
    console.log(`\nFatSecretServingCache entries (${bouillonServings.length} found):`);
    for (const s of bouillonServings) {
      console.log(`  foodId: "${s.foodId}"`);
      console.log(`  measurementDescription: "${s.measurementDescription}"`);
      console.log(`  metricServingAmount: ${s.metricServingAmount}g`);
      console.log(`  servingWeightGrams: ${s.servingWeightGrams}g`);
      console.log(`  numberOfUnits: ${s.numberOfUnits}`);
      console.log(`  isDefault: ${s.isDefault}`);
      console.log('  ---');
    }
  }

  // === 3. MATCHA INVESTIGATION ===
  console.log('\n' + '='.repeat(60));
  console.log('3. MATCHA INVESTIGATION');
  console.log('='.repeat(60));

  const matchaMappings = await p.validatedMapping.findMany({
    where: { normalizedForm: { contains: 'matcha' } },
  });
  console.log(`\nValidatedMapping entries (${matchaMappings.length} found):`);
  for (const m of matchaMappings) {
    console.log(`  normalizedForm: "${m.normalizedForm}"`);
    console.log(`  rawIngredient: "${m.rawIngredient}"`);
    console.log(`  foodId: ${m.foodId}`);
    console.log(`  foodName: "${m.foodName}"`);
    console.log(`  brandName: "${m.brandName}"`);
    console.log(`  aiConfidence: ${m.aiConfidence}`);
    console.log('  ---');
  }

  const matchaFoods = await p.fatSecretFoodCache.findMany({
    where: { name: { contains: 'matcha' } },
  });
  console.log(`\nFatSecretFoodCache entries (${matchaFoods.length} found):`);
  for (const f of matchaFoods) {
    console.log(`  id: "${f.id}"`);
    console.log(`  name: "${f.name}"`);
    console.log(`  brandName: "${f.brandName}"`);
    console.log(`  foodType: "${f.foodType}"`);
    console.log('  ---');
  }

  if (matchaFoods.length > 0) {
    const matchaServings = await p.fatSecretServingCache.findMany({
      where: { foodId: { in: matchaFoods.map(f => f.id) } },
    });
    console.log(`\nFatSecretServingCache entries (${matchaServings.length} found):`);
    for (const s of matchaServings) {
      console.log(`  foodId: "${s.foodId}"`);
      console.log(`  measurementDescription: "${s.measurementDescription}"`);
      console.log(`  metricServingAmount: ${s.metricServingAmount}g`);
      console.log(`  servingWeightGrams: ${s.servingWeightGrams}g`);
      console.log(`  numberOfUnits: ${s.numberOfUnits}`);
      console.log(`  isDefault: ${s.isDefault}`);
      console.log('  ---');
    }
  }

  // === 4. CHEDDAR CHEESE (P1, supplementary) ===
  console.log('\n' + '='.repeat(60));
  console.log('4. CHEDDAR CHEESE MAPPING');
  console.log('='.repeat(60));

  const cheddarMappings = await p.validatedMapping.findMany({
    where: { normalizedForm: { contains: 'cheddar' } },
  });
  console.log(`\nValidatedMapping entries (${cheddarMappings.length} found):`);
  for (const m of cheddarMappings) {
    console.log(`  normalizedForm: "${m.normalizedForm}"`);
    console.log(`  rawIngredient: "${m.rawIngredient}"`);
    console.log(`  foodId: ${m.foodId}`);
    console.log(`  foodName: "${m.foodName}"`);
    console.log(`  aiConfidence: ${m.aiConfidence}`);
    console.log('  ---');
  }

  // === 5. Also check normalizer for "peanut butter" ===
  console.log('\n' + '='.repeat(60));
  console.log('5. GLOBAL INGREDIENT MAPPING for peanut butter');
  console.log('='.repeat(60));

  const globalPb = await p.globalIngredientMapping.findMany({
    where: { normalizedName: { contains: 'peanut butter' } },
  });
  console.log(`\nGlobalIngredientMapping entries (${globalPb.length} found):`);
  for (const m of globalPb) {
    console.log(`  normalizedName: "${m.normalizedName}"`);
    console.log(`  fatsecretFoodId: ${m.fatsecretFoodId}`);
    console.log(`  source: ${m.source}`);
    console.log(`  confidence: ${m.confidence}`);
    console.log(`  usageCount: ${m.usageCount}`);
    console.log('  ---');
  }

  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
