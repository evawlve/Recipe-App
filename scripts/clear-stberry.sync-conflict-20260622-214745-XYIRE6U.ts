#!/usr/bin/env npx tsx

import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    // Delete cache for stberry
    await prisma.aiNormalizeCache.deleteMany({
        where: { rawLine: { contains: 'stberry', mode: 'insensitive' } }
    });
    // Also delete mappings
    await prisma.validatedMapping.deleteMany({
        where: { rawIngredient: { contains: 'stberry', mode: 'insensitive' } }
    });

    console.log('Cleared stberry caches');
    await prisma.$disconnect();
}

main().catch(console.error);
