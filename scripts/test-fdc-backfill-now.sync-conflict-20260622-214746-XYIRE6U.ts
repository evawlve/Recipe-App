/**
 * Verify FDC AI Backfill is Working
 * 
 * Tests that AI-generated servings for FDC foods are correctly:
 * 1. Requested from the AI
 * 2. Persisted to the FdcServingCache table
 * 3. Available for subsequent hydration
 */

import { PrismaClient } from '@prisma/client';
import { insertAiServing } from '../src/lib/fatsecret/ai-backfill';

process.env.LOG_LEVEL = 'error';

const prisma = new PrismaClient({ log: [] });

// Use the FDC pickle relish that was causing issues
const FDC_RELISH_ID = 'fdc_1969548';

async function main() {
    console.log('=== Verify FDC AI Backfill ===\n');

    // Step 1: Find an FDC food to test (or use the relish)
    const fdcId = parseInt(FDC_RELISH_ID.replace('fdc_', ''), 10);

    const fdcFood = await prisma.fdcFoodCache.findUnique({
        where: { id: fdcId },
        include: { servings: true },
    });

    if (!fdcFood) {
        console.log(`❌ FDC food ${FDC_RELISH_ID} not found. Trying to find any FDC food...`);

        // Find any FDC food without volume servings
        const anyFdc = await prisma.fdcFoodCache.findFirst({
            where: {
                servings: {
                    none: {
                        description: { contains: 'cup', mode: 'insensitive' }
                    }
                }
            },
            include: { servings: true },
        });

        if (!anyFdc) {
            console.log('❌ No FDC foods found in cache');
            await prisma.$disconnect();
            return;
        }

        console.log(`Found FDC food: ${anyFdc.description} (${anyFdc.id})`);
        await testFdcBackfill(`fdc_${anyFdc.id}`, anyFdc);
    } else {
        console.log(`Testing FDC food: ${fdcFood.description} (${fdcId})`);
        await testFdcBackfill(FDC_RELISH_ID, fdcFood);
    }

    await prisma.$disconnect();
}

async function testFdcBackfill(foodId: string, food: any) {
    console.log('\n--- BEFORE Backfill ---');
    console.log(`Servings: ${food.servings.length}`);
    food.servings.forEach((s: any) => {
        console.log(`  - "${s.description}" = ${s.grams}g (source: ${s.source}, isAiEstimated: ${s.isAiEstimated})`);
    });

    const hasVolumeServing = food.servings.some((s: any) => {
        const desc = s.description?.toLowerCase() || '';
        return desc.includes('cup') || desc.includes('tbsp') || desc.includes('tablespoon');
    });
    console.log(`Has volume serving: ${hasVolumeServing ? '✅ YES' : '❌ NO'}`);

    // Step 2: Run AI backfill
    console.log('\n--- Running AI Backfill ---');
    console.log(`Calling insertAiServing("${foodId}", "volume")...`);

    const result = await insertAiServing(foodId, 'volume');
    console.log(`Result: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
    if (!result.success) {
        console.log(`Reason: ${result.reason}`);
    }

    // Step 3: Verify serving was persisted
    console.log('\n--- AFTER Backfill ---');
    const fdcId = parseInt(foodId.replace('fdc_', ''), 10);
    const foodAfter = await prisma.fdcFoodCache.findUnique({
        where: { id: fdcId },
        include: { servings: true },
    });

    if (foodAfter) {
        console.log(`Servings: ${foodAfter.servings.length}`);
        foodAfter.servings.forEach((s: any) => {
            const isNew = !food.servings.find((old: any) => old.id === s.id);
            const marker = isNew ? ' [NEW ✅]' : '';
            console.log(`  - "${s.description}" = ${s.grams}g (source: ${s.source}, isAiEstimated: ${s.isAiEstimated})${marker}`);
        });

        const hasVolumeNow = foodAfter.servings.some((s: any) => {
            const desc = s.description?.toLowerCase() || '';
            return desc.includes('cup') || desc.includes('tbsp') || desc.includes('tablespoon');
        });
        console.log(`\nHas volume serving now: ${hasVolumeNow ? '✅ YES' : '❌ NO'}`);

        // Check if an AI-estimated serving was added
        const aiServings = foodAfter.servings.filter((s: any) => s.isAiEstimated);
        if (aiServings.length > 0) {
            console.log(`\n✅ AI-estimated servings in cache: ${aiServings.length}`);
        } else {
            console.log(`\n⚠️ No AI-estimated servings found in cache`);
        }
    }
}

main().catch(console.error);
