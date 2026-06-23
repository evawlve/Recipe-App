/**
 * Quick FDC Backfill Verification
 * 
 * Tests if the insertAiServing function correctly handles FDC food IDs.
 * Uses the full pipeline to first create an FDC food entry, then tests backfill.
 */

import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { prisma } from '../src/lib/db';
import { insertAiServing } from '../src/lib/fatsecret/ai-backfill';

process.env.LOG_LEVEL = 'info';

async function main() {
    console.log('=== Quick FDC Backfill Verification ===\n');

    // Step 1: Use the pipeline to map an ingredient that might use FDC
    console.log('Step 1: Mapping an ingredient to potentially get FDC food...');

    // First check for any existing FDC food in cache
    const existingFdc = await prisma.fdcFoodCache.findFirst({
        include: { servings: true },
        orderBy: { createdAt: 'desc' }
    });

    if (existingFdc) {
        console.log(`✅ Found existing FDC food: ${existingFdc.description} (id: ${existingFdc.id})`);
        console.log(`   Current servings: ${existingFdc.servings.length}`);
        existingFdc.servings.forEach(s => {
            console.log(`      - "${s.description}" = ${s.grams}g (isAiEstimated: ${s.isAiEstimated})`);
        });

        // Test backfill on this food
        const fdcId = `fdc_${existingFdc.id}`;
        console.log(`\nStep 2: Running AI backfill on ${fdcId}...`);
        const result = await insertAiServing(fdcId, 'volume');
        console.log(`Result: ${result.success ? '✅ SUCCESS' : '❌ FAILED'} - ${result.reason || ''}`);

        // Check for new servings
        const afterFood = await prisma.fdcFoodCache.findUnique({
            where: { id: existingFdc.id },
            include: { servings: true }
        });
        if (afterFood && afterFood.servings.length > existingFdc.servings.length) {
            console.log(`\n✅ New serving added! Total servings now: ${afterFood.servings.length}`);
            const newServing = afterFood.servings.find(s => !existingFdc.servings.some(os => os.id === s.id));
            if (newServing) {
                console.log(`   New: "${newServing.description}" = ${newServing.grams}g`);
            }
        }
    } else {
        console.log('❌ No FDC foods in cache');
        console.log('\n   To populate FDC cache, run a pilot batch import first');
        console.log('   Or check if FDC_API_KEY environment variable is set');

        // Check if FDC API key is set
        const hasKey = !!process.env.FDC_API_KEY;
        console.log(`\n   FDC_API_KEY is ${hasKey ? 'SET ✅' : 'NOT SET ❌'}`);
    }

    await prisma.$disconnect();
}

main().catch(async (err) => {
    console.error('Error:', err.message);
    await prisma.$disconnect();
    process.exit(1);
});
