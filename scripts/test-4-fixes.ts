/**
 * Test script to verify the 4 mapping pipeline fixes
 */
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function main() {
    console.log('Testing 4 mapping pipeline fixes...\n');

    const testCases = [
        {
            name: 'Issue 1: Green Chilies',
            line: '4 oz green chilies',
            expected: 'Should NOT map to "Diced Tomatoes & Green Chilies"'
        },
        {
            name: 'Issue 2: Garlic (unitless)',
            line: '5 garlic',
            expected: 'Should be ~15g (5 cloves), not 500g'
        },
        {
            name: 'Issue 3: Reduced Fat Ground Pork',
            line: '1 lb reduced fat ground pork',
            expected: 'Should find lean/90/10 variant'
        },
        {
            name: 'Issue 4: Tomato Volume',
            line: '0.25 cup tomato',
            expected: 'Should be ~60g (0.25 cup), not 4g'
        },
    ];

    for (const test of testCases) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`${test.name}`);
        console.log(`Input: "${test.line}"`);
        console.log(`Expected: ${test.expected}`);
        console.log('='.repeat(60));

        try {
            const result = await mapIngredientWithFallback(test.line, { debug: true });

            if (result) {
                console.log(`✓ Mapped to: ${result.foodName}`);
                console.log(`  - Grams: ${result.grams.toFixed(1)}g`);
                console.log(`  - Calories: ${result.kcal.toFixed(0)}kcal`);
                console.log(`  - Confidence: ${result.confidence.toFixed(2)}`);
                console.log(`  - Serving: ${result.servingDescription || 'N/A'}`);
            } else {
                console.log(`✗ FAILED - No mapping found`);
            }
        } catch (err) {
            console.log(`✗ ERROR: ${(err as Error).message}`);
        }
    }

    console.log('\n\nDone!');
    process.exit(0);
}

main();
