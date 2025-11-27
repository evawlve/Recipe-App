#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function checkMappings() {
    const recipeId = 'cmifbcr81001t10al6fxn735m';

    const maps = await (prisma as any).ingredientFoodMap.findMany({
        where: {
            ingredient: {
                recipeId
            },
            isActive: true
        },
        include: {
            ingredient: true,
            food: true
        }
    });

    console.log('\n📊 Active Ingredient Mappings:\n');

    for (const map of maps) {
        console.log(`Ingredient: "${map.ingredient.name}"`);
        console.log(`  Qty: ${map.ingredient.qty} ${map.ingredient.unit || ''}`);
        console.log(`  foodId: ${map.foodId || 'null'}`);
        console.log(`  fatsecretFoodId: ${map.fatsecretFoodId || 'null'}`);
        console.log(`  fatsecretServingId: ${map.fatsecretServingId || 'null'}`);
        console.log(`  fatsecretGrams: ${map.fatsecretGrams || 'NULL ⚠️'}`);  // ADDED THIS
        console.log(`  confidence: ${map.confidence}`);

        if (map.food) {
            console.log(`  Food: "${map.food.name}"`);
            console.log(`  Macros (per 100g): ${map.food.protein100}p / ${map.food.carbs100}c / ${map.food.fat100}f`);
        } else if (map.fatsecretFoodId) {
            console.log(`  ⚠️  FatSecret ID present but no Food linked!`);
            if (!map.fatsecretGrams) {
                console.log(`  ❌ CRITICAL: fatsecretGrams is NULL - computeTotals will skip this!`);
            }
        }
        console.log();
    }

    await prisma.$disconnect();
}

checkMappings().catch(console.error);
