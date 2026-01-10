import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { normalizeIngredientName } from '../src/lib/fatsecret/normalize';
import { getFatSecretClient } from '../src/lib/fatsecret/client';

async function debugAlmondMilkCandidates() {
    const input = "1 cup almond milk";
    const normalized = normalizeIngredientName("almond milk");

    console.log('=== DEBUGGING ALMOND MILK CANDIDATE SELECTION ===\n');
    console.log(`Input: "${input}"`);
    console.log(`Normalized: "${normalized.cleaned}"`);

    // Search for almond milk in cache
    console.log('\n1. Cache search for "almond milk":');
    const cacheResults = await prisma.fatSecretFoodCache.findMany({
        where: {
            name: { contains: 'almond', mode: 'insensitive' }
        },
        select: { id: true, name: true, source: true },
        take: 15,
    });

    for (const r of cacheResults) {
        const hasAlmond = r.name.toLowerCase().includes('almond');
        const hasMilk = r.name.toLowerCase().includes('milk');
        const isAlmondMilk = hasAlmond && hasMilk && !r.name.toLowerCase().includes('chocolate');
        console.log(`  [${r.source}] ${r.name.substring(0, 60)} ${isAlmondMilk ? '✓' : hasMilk ? '?' : ''}`);
    }

    // Check which FDC results exist
    console.log('\n2. FDC results containing "almond" AND "milk":');
    const fdcResults = await prisma.fatSecretFoodCache.findMany({
        where: {
            AND: [
                { name: { contains: 'almond', mode: 'insensitive' } },
                { name: { contains: 'milk', mode: 'insensitive' } },
            ],
            source: 'fdc',
        },
        select: { id: true, name: true },
        take: 10,
    });

    for (const r of fdcResults) {
        const isChocolate = r.name.toLowerCase().includes('chocolate');
        console.log(`  [${r.id}] ${r.name} ${isChocolate ? '❌ CHOCOLATE' : '✓'}`);
    }

    // Check FatSecret results
    console.log('\n3. FatSecret API results containing "almond":');
    const fsResults = await prisma.fatSecretFoodCache.findMany({
        where: {
            AND: [
                { name: { contains: 'almond', mode: 'insensitive' } },
                { name: { contains: 'milk', mode: 'insensitive' } },
            ],
            source: 'fatsecret',
        },
        select: { id: true, name: true },
        take: 10,
    });

    for (const r of fsResults) {
        console.log(`  [${r.id}] ${r.name}`);
    }
}

debugAlmondMilkCandidates().finally(() => prisma.$disconnect());
