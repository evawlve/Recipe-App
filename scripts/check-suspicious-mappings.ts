#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function checkBadMappings() {
    console.log('\n🔍 Checking Suspicious Mappings from Database\n');

    // Find mappings with suspiciously low gram amounts for whole foods
    const suspicious = await prisma.ingredientFoodMap.findMany({
        where: {
            isActive: true,
            fatsecretGrams: {
                lt: 10, // Less than 10g for a whole food is suspicious
            },
            ingredient: {
                name: {
                    contains: 'chicken',
                },
            },
        },
        include: {
            ingredient: true,
        },
        take: 20,
    });

    console.log(`Found ${suspicious.length} suspicious chicken mappings:\n`);

    for (const map of suspicious) {
        const ing = map.ingredient;
        const rawLine = `${ing.qty} ${ing.unit || ''} ${ing.name}`.trim();
        console.log(`🔴 ${rawLine}`);
        console.log(`   → Grams: ${map.fatsecretGrams}g`);
        console.log(`   → Food ID: ${map.fatsecretFoodId}`);
        console.log(`   → Serving ID: ${map.fatsecretServingId}`);
        console.log(`   → Confidence: ${map.fatsecretConfidence}`);
        console.log();
    }

    // Also check "almond flour → white flour" mapping
    const flourMappings = await prisma.ingredientFoodMap.findMany({
        where: {
            isActive: true,
            ingredient: {
                name: {
                    contains: 'almond flour',
                },
            },
        },
        include: {
            ingredient: true,
        },
    });

    console.log(`\nAlmond Flour Mappings (${flourMappings.length}):\n`);
    for (const map of flourMappings) {
        const ing = map.ingredient;
        console.log(`${ing.qty} ${ing.unit || ''} ${ing.name}`);
        console.log(`   → Food ID: ${map.fatsecretFoodId}`);
        console.log(`   → Confidence: ${map.fatsecretConfidence}\n`);
    }

    await prisma.$disconnect();
}

checkBadMappings().catch(console.error);
