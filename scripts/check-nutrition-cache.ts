#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function checkNutrition() {
    const recipeId = 'cmifbcr81001t10al6fxn735m';

    const nutrition = await (prisma as any).recipeNutrition.findUnique({
        where: { recipeId }
    });

    if (nutrition) {
        console.log('\n📊 Cached Nutrition Data:\n');
        console.log(`Calories: ${nutrition.calories}`);
        console.log(`Protein: ${nutrition.proteinG}g`);
        console.log(`Carbs: ${nutrition.carbsG}g`);
        console.log(`Fat: ${nutrition.fatG}g`);
        console.log(`\nLast updated: ${nutrition.updatedAt}`);
        console.log('\n⚠️  This is CACHED data - needs recomputation!');
    } else {
        console.log('\n❌ No nutrition data found in cache');
    }

    await prisma.$disconnect();
}

checkNutrition();
