#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { autoMapIngredients } from '../src/lib/nutrition/auto-map';
import { logger } from '../src/lib/logger';

async function main() {
    const recipeId = process.argv[2];

    if (!recipeId) {
        console.error('Usage: npx ts-node scripts/force-map-recipe.ts <recipeId>');
        process.exit(1);
    }

    console.log(`\n🔧 Force Mapping Recipe: ${recipeId}\n`);

    // 1. Verify Recipe Exists
    const recipe = await prisma.recipe.findUnique({
        where: { id: recipeId },
        include: { ingredients: true }
    });

    if (!recipe) {
        console.error('❌ Recipe not found');
        return;
    }

    console.log(`Found recipe: "${recipe.title}" with ${recipe.ingredients.length} ingredients`);

    // 2. Clear Existing Mappings
    console.log('Clearing existing mappings...');
    const deleteResult = await prisma.ingredientFoodMap.deleteMany({
        where: {
            ingredient: {
                recipeId: recipeId
            }
        }
    });
    console.log(`Deleted ${deleteResult.count} existing mappings.`);

    // 3. Run Auto-Map
    console.log('Running auto-map...');
    const start = Date.now();

    // Enable debug logging for this run
    // Note: autoMapIngredients uses the global logger, so we rely on env vars or internal logic
    // Phase 6A enabled debug logging by default in auto-map.ts for failures

    const mappedCount = await autoMapIngredients(recipeId);
    const duration = Date.now() - start;

    console.log(`\n✅ Auto-map completed in ${duration}ms`);
    console.log(`Mapped: ${mappedCount} / ${recipe.ingredients.length} ingredients`);

    // 4. Check Nutrition
    const nutrition = await prisma.nutrition.findUnique({
        where: { recipeId }
    });

    if (nutrition) {
        console.log('\n📊 Nutrition Recomputed:');
        console.log(`   Calories: ${nutrition.calories}`);
        console.log(`   Protein: ${nutrition.proteinG}g`);
        console.log(`   Carbs: ${nutrition.carbsG}g`);
        console.log(`   Fat: ${nutrition.fatG}g`);
    } else {
        console.log('\n⚠️ Nutrition record not found (recomputation might have failed)');
    }

    console.log('\nDone. Check logs/fatsecret-failures-*.jsonl for details if any mappings failed.');
}

main()
    .catch((error) => {
        console.error('Error:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
