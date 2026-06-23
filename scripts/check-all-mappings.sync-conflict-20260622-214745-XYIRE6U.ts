#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function checkAllMappings() {
    const recipeId = 'cmifbcr81001t10al6fxn735m';

    // Get ALL mappings, not just active ones
    const allMaps = await (prisma as any).ingredientFoodMap.findMany({
        where: {
            ingredient: {
                recipeId
            }
        },
        include: {
            ingredient: true
        },
        orderBy: {
            createdAt: 'desc'
        }
    });

    console.log('\n📊 ALL Ingredient Mappings (including inactive):\n');

    const grouped = new Map();
    for (const map of allMaps) {
        if (!grouped.has(map.ingredientId)) {
            grouped.set(map.ingredientId, []);
        }
        grouped.get(map.ingredientId).push(map);
    }

    for (const [ingredientId, maps] of grouped) {
        const ing = maps[0].ingredient;
        console.log(`\n=== Ingredient: "${ing.name}" (${ing.qty} ${ing.unit || ''}) ===`);
        console.log(`Total mappings: ${maps.length}\n`);

        for (let i = 0; i < maps.length; i++) {
            const map = maps[i];
            console.log(`  Mapping ${i + 1}:`);
            console.log(`    ID: ${map.id}`);
            console.log(`    isActive: ${map.isActive}`);
            console.log(`    foodId: ${map.foodId || 'null'}`);
            console.log(`    fatsecretFoodId: ${map.fatsecretFoodId || 'null'}`);
            console.log(`    fatsecretGrams: ${map.fatsecretGrams || 'null'}`);
            console.log(`    confidence: ${map.confidence}`);
            console.log(`    createdAt: ${map.createdAt}`);
            console.log();
        }
    }

    await prisma.$disconnect();
}

checkAllMappings().catch(console.error);
