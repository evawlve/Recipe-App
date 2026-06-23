#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function checkFoods() {
    const foodIds = ['3419', '39733'];

    console.log('\n🔍 Checking Food Details\n');

    for (const id of foodIds) {
        const food = await prisma.fatSecretFoodCache.findUnique({
            where: { id },
            include: {
                servings: {
                    take: 5,
                },
            },
        });

        if (food) {
            console.log(`\n${'='.repeat(60)}`);
            console.log(`Food ID: ${id}`);
            console.log(`Name: ${food.name}`);
            console.log(`Brand: ${food.brandName || 'Generic'}`);
            console.log(`Type: ${food.foodType}`);
            console.log(`\nServings (${food.servings.length}):`);
            food.servings.forEach((s, idx) => {
                console.log(`  ${idx + 1}. ${s.measurementDescription} = ${s.servingWeightGrams}g`);
            });
        } else {
            console.log(`\n❌ Food ${id} not found in cache`);
        }
    }

    await prisma.$disconnect();
}

checkFoods().catch(console.error);
