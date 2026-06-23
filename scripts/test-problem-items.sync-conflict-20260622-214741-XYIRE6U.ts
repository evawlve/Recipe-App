/**
 * Full pipeline test for 4 failing items from pilot import
 */

import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function test() {
    const items = [
        '0.25 tsp cayenne',
        '14 oz plum tomatoes',
        '1 cup roasted vegetable pasta sauce',
        '2 cup cubed butternut squash'
    ];

    for (const item of items) {
        console.log('\n========================================');
        console.log('Testing:', item);
        console.log('========================================');
        try {
            const result = await mapIngredientWithFallback(item);
            if (result && 'grams' in result) {
                console.log('✅ SUCCESS');
                console.log('   Food:', result.foodName);
                console.log('   Grams:', result.grams);
                console.log('   Kcal:', result.kcal);
                console.log('   Serving:', result.servingDescription);
                console.log('   Confidence:', result.confidence);
            } else {
                console.log('❌ FAILED - No result or pending');
                console.log('   Result:', result);
            }
        } catch (e: any) {
            console.log('❌ ERROR:', e.message);
        }
    }
}

test().then(() => process.exit(0));
