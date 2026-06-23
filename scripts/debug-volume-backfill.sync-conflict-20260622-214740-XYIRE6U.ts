/**
 * Test Full Volume Backfill Flow
 */

import { PrismaClient } from '@prisma/client';
import { insertAiServing } from '../src/lib/fatsecret/ai-backfill';

process.env.LOG_LEVEL = 'error';

const prisma = new PrismaClient({ log: [] });

const CORN_STARCH_FOOD_ID = '3345875';

async function main() {
    console.log('=== Test: Full Volume Backfill for Corn Starch ===\n');

    // Check initial state
    const foodBefore = await prisma.fatSecretFoodCache.findUnique({
        where: { id: CORN_STARCH_FOOD_ID },
        include: { servings: true },
    });

    if (!foodBefore) {
        console.log('❌ Food not found');
        return;
    }

    console.log('BEFORE:');
    console.log(`  Servings: ${foodBefore.servings.length}`);
    foodBefore.servings.forEach(s => {
        console.log(`  - "${s.measurementDescription}" = ${s.servingWeightGrams}g (source: ${s.source})`);
    });

    // Run backfill
    console.log('\nRunning insertAiServing()...');
    const result = await insertAiServing(CORN_STARCH_FOOD_ID, 'volume');
    console.log('\nResult:', JSON.stringify(result, null, 2));

    // Check final state
    const foodAfter = await prisma.fatSecretFoodCache.findUnique({
        where: { id: CORN_STARCH_FOOD_ID },
        include: { servings: true },
    });

    if (foodAfter) {
        console.log('\nAFTER:');
        console.log(`  Servings: ${foodAfter.servings.length}`);
        foodAfter.servings.forEach(s => {
            const isNew = !foodBefore.servings.find(old => old.id === s.id);
            const marker = isNew ? ' [NEW ✅]' : '';
            console.log(`  - "${s.measurementDescription}" = ${s.servingWeightGrams}g (source: ${s.source})${marker}`);
        });

        const hasCup = foodAfter.servings.some(s => {
            const desc = s.measurementDescription?.toLowerCase() || '';
            return desc.includes('cup') || desc.includes('tbsp') || desc.includes('tablespoon');
        });
        console.log(`\nHas volume serving now: ${hasCup ? '✅ YES' : '❌ NO'}`);
    }

    await prisma.$disconnect();
}

main().catch(console.error);
