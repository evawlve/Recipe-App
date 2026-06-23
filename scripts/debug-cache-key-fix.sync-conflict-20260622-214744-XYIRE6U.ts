/**
 * Debug script to verify the cache key fix for when LLM normalization is skipped.
 * 
 * This tests the actual cache saving by:
 * 1. Clearing any existing mapping for the test ingredient
 * 2. Running mapIngredientWithFallback 
 * 3. Checking the ValidatedMapping table to see what normalizedForm was saved
 * 
 * The fix ensures that when AI is skipped (high confidence match), the cache key
 * uses normalizedName (e.g., "golden flaxseed meal") instead of the raw line
 * (e.g., "0 311625 cup ground golden flaxseed meal").
 */

import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

const TEST_INGREDIENTS = [
    "2 tbsp ground golden flaxseed meal",  // Simple case
    "0 311625 cup ground golden flaxseed meal",  // Problematic case with leading numbers
];

async function main() {
    console.log('\n========================================');
    console.log('  CACHE KEY FIX VERIFICATION');
    console.log('========================================\n');

    for (const rawLine of TEST_INGREDIENTS) {
        console.log(`\n--- Testing: "${rawLine}" ---\n`);

        // Step 1: Clear any existing mapping
        const normalizedForDelete = rawLine.toLowerCase().trim();
        const deletedCount = await prisma.validatedMapping.deleteMany({
            where: {
                OR: [
                    { rawIngredient: rawLine },
                    { normalizedForm: { contains: 'flax' } },
                ]
            }
        });
        console.log(`Cleared ${deletedCount.count} existing mappings`);

        // Step 2: Run the mapping
        console.log('Running mapIngredientWithFallback...');
        const result = await mapIngredientWithFallback(rawLine, { debug: true });

        if (!result) {
            console.log('❌ Mapping failed - no result returned');
            continue;
        }

        console.log(`✅ Mapped to: ${result.foodName}`);
        console.log(`   Grams: ${result.grams}, Kcal: ${result.kcal}`);

        // Step 3: Check what was saved to the cache
        const savedMapping = await prisma.validatedMapping.findFirst({
            where: {
                foodId: result.foodId,
            },
            orderBy: {
                createdAt: 'desc',
            },
        });

        if (!savedMapping) {
            console.log('⚠️ No ValidatedMapping saved (confidence might be < 0.85)');
            continue;
        }

        console.log(`\n📦 SAVED CACHE ENTRY:`);
        console.log(`   rawIngredient: "${savedMapping.rawIngredient}"`);
        console.log(`   normalizedForm: "${savedMapping.normalizedForm}" ← THIS IS THE CACHE KEY`);
        console.log(`   aiConfidence: ${savedMapping.aiConfidence}`);

        // Verify the fix
        const looksLikeBadKey = savedMapping.normalizedForm?.match(/^\d+\s+\d+/) ||
            savedMapping.normalizedForm?.includes('cup ground');

        if (looksLikeBadKey) {
            console.log(`\n❌ FIX NOT WORKING - normalizedForm looks like raw input!`);
            console.log(`   Expected something like: "golden flaxseed meal"`);
            console.log(`   Got: "${savedMapping.normalizedForm}"`);
        } else {
            console.log(`\n✅ FIX WORKING - normalizedForm is properly normalized!`);
        }
    }

    console.log('\n\n========================================');
    console.log('  VERIFICATION COMPLETE');
    console.log('========================================\n');

    await prisma.$disconnect();
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
