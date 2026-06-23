/**
 * Test the new unified pipeline with problem cases
 */
import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { prisma } from '../src/lib/db';

async function test() {
    console.log('='.repeat(60));
    console.log('TESTING UNIFIED PIPELINE');
    console.log('='.repeat(60));

    const testCases = [
        '0.5 cup coconut flour',           // Was failing: removed_by_must_have_tokens
        '1 cup unsweetened coconut milk',  // Was failing: removed_by_must_have_tokens
        '1 cup oats dry',                  // Was failing: no_suitable_serving_found
        '0.5 cup almond milk vanilla',     // Was failing: no_suitable_serving_found
        '2 tbsps cream cheese',            // Should work (plural unit)
        '1 tsp vanilla extract',           // Should work (basic case)
    ];

    for (const testCase of testCases) {
        console.log(`\n${'─'.repeat(60)}`);
        console.log(`Testing: "${testCase}"`);
        console.log('─'.repeat(60));

        try {
            const result = await mapIngredientWithFallback(testCase, { debug: true });

            if (result) {
                console.log(`✅ SUCCESS`);
                console.log(`   Food: ${result.foodName} ${result.brandName ? `(${result.brandName})` : ''}`);
                console.log(`   Confidence: ${(result.confidence ?? 0).toFixed(2)}`);
                console.log(`   Serving: ${result.servingDescription || 'N/A'} (${result.grams ?? 0}g)`);
                console.log(`   Macros: ${(result.kcal ?? 0).toFixed(0)} kcal, ${(result.protein ?? 0).toFixed(1)}p, ${(result.carbs ?? 0).toFixed(1)}c, ${(result.fat ?? 0).toFixed(1)}f`);
            } else {
                console.log(`❌ FAILED - returned null`);
            }
        } catch (err) {
            console.log(`❌ ERROR: ${(err as Error).message}`);
            console.log(`   Stack: ${(err as Error).stack?.split('\n').slice(0, 3).join('\n')}`);
        }
    }

    await prisma.$disconnect();
    console.log('\n' + '='.repeat(60));
    console.log('TESTS COMPLETE');
    console.log('='.repeat(60));
}

test().catch(console.error);
