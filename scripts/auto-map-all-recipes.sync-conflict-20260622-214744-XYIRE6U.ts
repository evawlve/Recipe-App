#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '@/lib/db';
import { autoMapIngredients } from '@/lib/nutrition/auto-map';

async function main() {
  const args = process.argv.slice(2);
  const recipeIds =
    args.length > 0
      ? args
      : (await prisma.recipe.findMany({ select: { id: true }, orderBy: { createdAt: 'desc' } })).map(
          (r) => r.id
        );

  if (recipeIds.length === 0) {
    console.log('No recipes found.');
    await prisma.$disconnect();
    return;
  }

  console.log(`Running automap for ${recipeIds.length} recipe(s)...`);

  let totalMapped = 0;
  for (const recipeId of recipeIds) {
    try {
      const mapped = await autoMapIngredients(recipeId);
      totalMapped += mapped;
    } catch (err) {
      console.error(`Failed to automap recipe ${recipeId}:`, (err as Error).message);
    }
  }

  console.log(`\nAutomap complete. Total ingredients mapped: ${totalMapped}`);
  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
