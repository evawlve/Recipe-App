#!/usr/bin/env ts-node

import { prisma } from '@/lib/db';

async function main() {
  const args = process.argv.slice(2);
  const recipeId = args[0];
  
  if (!recipeId) {
    console.error('Usage: ts-node scripts/show-recipe-mappings.ts <recipeId>');
    process.exit(1);
  }

  const rows = await prisma.ingredientFoodMap.findMany({
    where: { ingredient: { recipeId } },
    include: { ingredient: true },
  });

  if (rows.length === 0) {
    console.log('No mappings found for this recipe.');
    await prisma.$disconnect();
    return;
  }

  const data = rows.map(r => ({
    ingredientId: r.ingredientId,
    line: `${r.ingredient.qty} ${r.ingredient.unit || ''} ${r.ingredient.name}`.trim(),
    fatsecretFoodId: r.fatsecretFoodId,
    servingId: r.fatsecretServingId,
    grams: r.fatsecretGrams,
    confidence: r.fatsecretConfidence,
    source: r.fatsecretSource,
  }));

  // Try console.table first, fallback to JSON if it doesn't work
  try {
    console.table(data);
  } catch (err) {
    console.log(JSON.stringify(data, null, 2));
  }

  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Error:', err);
    process.exit(1);
  });
}




