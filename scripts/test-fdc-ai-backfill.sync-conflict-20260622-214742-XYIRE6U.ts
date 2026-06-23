/**
 * Test FDC AI Serving Backfill
 * 
 * Directly tests the insertAiServing function with an FDC food ID
 * to verify AI density estimation works for USDA foods.
 * 
 * Usage:
 *   npx ts-node scripts/test-fdc-ai-backfill.ts
 */

import { prisma } from '../src/lib/db';
import { insertAiServing } from '../src/lib/fatsecret/ai-backfill';

async function main() {
    console.log('\n=== FDC AI Serving Backfill Test ===\n');

    // Find an FDC food to test with (golden flaxseed)
    const fdcFood = await prisma.fdcFoodCache.findFirst({
        where: {
            description: { contains: 'flaxseed', mode: 'insensitive' },
        },
        include: { servings: true },
    });

    if (!fdcFood) {
        console.log('No FDC flaxseed food found. Looking for any FDC food...');
        const anyFdc = await prisma.fdcFoodCache.findFirst({
            include: { servings: true },
        });
        if (!anyFdc) {
            console.log('No FDC foods in cache. Please run FDC sync first.');
            return;
        }
        console.log(`Using: ${anyFdc.description} (FDC ID: ${anyFdc.id})`);
        await testBackfill(anyFdc.id);
    } else {
        console.log(`Found: ${fdcFood.description} (FDC ID: ${fdcFood.id})`);
        console.log(`Existing servings: ${fdcFood.servings.length}`);
        await testBackfill(fdcFood.id);
    }

    console.log('\n=== Test Complete ===\n');
}

async function testBackfill(fdcId: number) {
    const foodId = `fdc_${fdcId}`;
    console.log(`\nTesting insertAiServing with foodId: ${foodId}`);

    // Test volume backfill (density estimation)
    console.log('\n--- Testing Volume Backfill ---');
    const volumeResult = await insertAiServing(foodId, 'volume', {
        promptDebug: true,
        targetServingUnit: 'cup',
    });

    console.log(`Result: ${volumeResult.success ? 'SUCCESS' : 'FAILED'}`);
    if (!volumeResult.success) {
        console.log(`Reason: ${volumeResult.reason}`);
    }

    // Check if serving was created
    const servings = await prisma.fdcServingCache.findMany({
        where: { fdcId },
        orderBy: { id: 'desc' },
        take: 5,
    });

    console.log(`\nFDC Servings after backfill:`);
    for (const s of servings) {
        console.log(`  - ${s.description}: ${s.grams}g [AI: ${s.isAiEstimated}]`);
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
