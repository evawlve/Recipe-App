#!/usr/bin/env npx tsx

import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    // Check AI normalize cache for tomato-related entries
    const aiCache = await prisma.aiNormalizeCache.findMany({
        where: { rawLine: { contains: 'tomato', mode: 'insensitive' } },
        select: { rawLine: true, normalizedName: true },
        take: 10
    });

    console.log('AI NORMALIZE CACHE FOR TOMATO:');
    aiCache.forEach(entry => {
        console.log(`  "${entry.rawLine}" -> "${entry.normalizedName}"`);
    });

    await prisma.$disconnect();
}

main().catch(console.error);
