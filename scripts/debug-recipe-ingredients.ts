#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { getRecipeIngredients } from '../src/lib/recipes/ingredients.server';

async function main() {
    const recipeId = 'cmidqbg90000dy5prfxplu0yd';
    console.log(`\n🔍 Debugging Recipe Ingredients for: ${recipeId}\n`);

    try {
        const ingredients = await getRecipeIngredients(recipeId);

        if (!ingredients) {
            console.error('❌ Recipe not found');
            return;
        }

        console.log(`✅ Successfully fetched ${ingredients.length} ingredients`);

        ingredients.forEach(ing => {
            console.log(`- ${ing.name} (${ing.qty} ${ing.unit})`);
            if (ing.currentMapping) {
                console.log(`  Mapped to: ${ing.currentMapping.foodName} (${ing.currentMapping.foodId})`);
                console.log(`  Confidence: ${ing.currentMapping.confidence}`);
            } else {
                console.log(`  Not mapped`);
            }
            if (ing.nutrition) {
                console.log(`  Nutrition: ${ing.nutrition.calories}kcal, P:${ing.nutrition.proteinG}g`);
            }
        });

    } catch (error) {
        console.error('❌ Error fetching ingredients:', error);
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
