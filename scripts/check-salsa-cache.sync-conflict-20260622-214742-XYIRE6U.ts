#!/usr/bin/env npx tsx

import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    // Check for tomato salsa mappings
    const mappings = await prisma.validatedMapping.findMany({
        where: {
            OR: [
                { rawIngredient: { contains: 'salsa', mode: 'insensitive' } },
                { rawIngredient: { contains: 'tomato salsa', mode: 'insensitive' } },
            ]
        },
        select: { rawIngredient: true, foodName: true, foodId: true },
        take: 10
    });

    console.log('CACHED MAPPINGS FOR SALSA:');
    console.log(JSON.stringify(mappings, null, 2));

    // Check AI normalize cache
    const aiCache = await prisma.aiNormalizeCache.findMany({
        where: { rawLine: { contains: 'salsa', mode: 'insensitive' } },
        select: { rawLine: true, normalizedName: true },
        take: 5
    });
    console.log('\nAI NORMALIZE CACHE:');
    console.log(JSON.stringify(aiCache, null, 2));

    await prisma.$disconnect();
}

main().catch(console.error);
