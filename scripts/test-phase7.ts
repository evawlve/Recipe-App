#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { autoMapIngredients } from '../src/lib/nutrition/auto-map';

async function main() {
    console.log('\n🧪 Testing Phase 7: Auto-Compute Nutrition\n');

    // 1. Get a valid user
    const user = await prisma.user.findFirst();
    if (!user) {
        console.error('No users found in DB');
        return;
    }

    // 2. Create a Test Recipe
    const recipe = await prisma.recipe.create({
        data: {
            title: 'Phase 7 Test Recipe',
            bodyMd: 'Test recipe body',
            authorId: user.id,
            ingredients: {
                create: [
                    { name: 'banana', qty: 1, unit: 'medium' }, // Should map easily
                    { name: 'oats', qty: 100, unit: 'g' }
                ]
            }
        }
    });

    console.log(`Created test recipe: ${recipe.id}`);

    try {
        // 3. Run Auto-Map
        console.log('Running auto-map...');
        await autoMapIngredients(recipe.id);

        // 4. Verify Nutrition Exists Immediately
        const nutrition = await prisma.nutrition.findUnique({
            where: { recipeId: recipe.id }
        });

        if (nutrition) {
            console.log('✅ Nutrition record found!');
            console.log(`   Calories: ${nutrition.calories}`);

            if (nutrition.calories > 0) {
                console.log('✅ Calories > 0 (Computation worked)');
            } else {
                console.error('❌ Calories are 0 (Computation might have failed or inputs are 0)');
            }
        } else {
            console.error('❌ Nutrition record NOT found (Auto-compute failed)');
        }

    } finally {
        // Cleanup
        console.log('\nCleaning up...');
        try {
            await prisma.ingredientFoodMap.deleteMany({ where: { ingredient: { recipeId: recipe.id } } });
            await prisma.ingredient.deleteMany({ where: { recipeId: recipe.id } });
            await prisma.nutrition.deleteMany({ where: { recipeId: recipe.id } });
            await prisma.recipe.delete({ where: { id: recipe.id } });
        } catch (e) {
            console.error('Cleanup failed:', e);
        }
    }
}

main()
    .catch((error) => {
        console.error('Error:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
