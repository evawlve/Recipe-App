#!/usr/bin/env npx tsx

import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { FatSecretClient } from '../src/lib/fatsecret/client';

async function main() {
    const client = new FatSecretClient();

    // Check what the cache has for ground beef
    console.log('1. VALIDATED MAPPING CACHE FOR GROUND BEEF:');
    const cached = await prisma.validatedMapping.findMany({
        where: {
            OR: [
                { rawIngredient: { contains: 'ground beef', mode: 'insensitive' } },
                { rawIngredient: { contains: 'beef 85', mode: 'insensitive' } },
            ]
        },
        select: { rawIngredient: true, foodName: true, foodId: true, aiConfidence: true },
        take: 10
    });
    console.log(JSON.stringify(cached, null, 2));

    // Check AI normalize cache
    console.log('\n2. AI NORMALIZE CACHE:');
    const aiCache = await prisma.aiNormalizeCache.findMany({
        where: { rawLine: { contains: 'ground beef 85', mode: 'insensitive' } },
        select: { rawLine: true, normalizedName: true },
        take: 5
    });
    console.log(JSON.stringify(aiCache, null, 2));

    // Search FatSecret for 85% lean ground beef
    console.log('\n3. FATSECRET SEARCH RESULTS:');
    const queries = ['ground beef 85%', '85% lean ground beef', '85/15 ground beef'];
    for (const query of queries) {
        const results = await client.searchFoodsV4(query, { maxResults: 5 });
        console.log(`\n   "${query}":`);
        results.forEach((r, i) => {
            console.log(`     ${i + 1}. [${r.id}] ${r.name}${r.brandName ? ` (${r.brandName})` : ''}`);
        });
    }

    await prisma.$disconnect();
}

main().catch(console.error);
