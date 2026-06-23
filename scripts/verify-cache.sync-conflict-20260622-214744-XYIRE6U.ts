#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    console.log('\n🔍 Checking if FatSecret foods exist in cache...\n');

    const foods = await (prisma as any).fatSecretFoodCache.findMany({
        where: {
            id: { in: ['36442', '40396'] }
        }
    });

    console.log(`Found ${foods.length} foods in cache:\n`);

    for (const food of foods) {
        console.log(`ID: ${food.id}`);
        console.log(`Name: ${food.name}`);
        console.log(`Brand: ${food.brandName || 'Generic'}`);
        console.log(`Country: ${food.country}`);
        console.log();
    }

    if (foods.length === 0) {
        console.log('❌ NO FOODS FOUND IN CACHE!');
        console.log('This means the modal showed search results but they\u0027re not persisted in FatSecretFoodCache.');
        console.log('\nThe issue: Modal search caches results temporarily but doesn\u0027t persist them!');
    }

    await prisma.$disconnect();
}

main();
