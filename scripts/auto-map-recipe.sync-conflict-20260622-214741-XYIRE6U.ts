#!/usr/bin/env ts-node

import 'dotenv/config';
import { autoMapIngredients } from '@/lib/nutrition/auto-map';
import { computeRecipeNutrition } from '@/lib/nutrition/compute';
import { prisma } from '@/lib/db';

async function main() {
  const args = process.argv.slice(2);
  const recipeId = args[0];
  
  if (!recipeId) {
    console.error('Usage: ts-node scripts/auto-map-recipe.ts <recipeId>');
    console.error('\nTo find a recipe ID, you can query the database:');
    console.error('  SELECT id, title FROM "Recipe" LIMIT 5;');
    process.exit(1);
  }

  // Verify recipe exists
  const recipe = await prisma.recipe.findUnique({
    where: { id: recipeId },
    include: { ingredients: true }
  });

  if (!recipe) {
    console.error(`❌ Recipe not found: ${recipeId}`);
    process.exit(1);
  }

  console.log(`📝 Recipe: ${recipe.title}`);
  console.log(`🍳 Ingredients: ${recipe.ingredients.length}`);
  console.log(`\n🔄 Running auto-map...\n`);

  // Run auto-mapping
  const mappedCount = await autoMapIngredients(recipeId);
  
  console.log(`✅ Auto-mapped ${mappedCount} ingredients`);
  
  // Compute nutrition after mapping
  console.log(`\n📊 Computing nutrition...`);
  await computeRecipeNutrition(recipeId, 'general');
  console.log(`✅ Nutrition computed`);
  
  console.log(`\n🎉 Done!`);
}

if (require.main === module) {
  main().catch(console.error);
}




