/**
 * Debug Priority 3 Serving Size Issues
 */

import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

const TEST_CASES = [
    { input: '0.5 cup brown sugar', expectedGrams: 110, description: 'currently 1.5g' },
    { input: '5 piece sun-dried tomatoes', expectedGrams: 15, description: 'currently 500g' },
    { input: '2 slice avocado', expectedGrams: 30, description: 'currently 292g' },
    { input: '4 fl oz wine', expectedGrams: 118, description: 'currently 592g' },
    { input: '2 lbs shrimp', expectedGrams: 908, description: 'currently 10g' },
];

async function main() {
    console.log('🔍 Debugging Serving Size Issues\n');
    console.log('='.repeat(70) + '\n');

    for (const testCase of TEST_CASES) {
        console.log(`Query: "${testCase.input}"`);
        console.log(`Expected: ~${testCase.expectedGrams}g (${testCase.description})`);

        const result = await mapIngredientWithFallback(testCase.input, {
            debug: false,
            skipCache: true
        });

        if (result) {
            console.log(`  → Food: ${result.foodName}`);
            console.log(`  → Grams: ${result.grams}g`);
            console.log(`  → Serving: ${result.servingDescription || 'N/A'}`);

            const ratio = result.grams / testCase.expectedGrams;
            if (ratio > 2 || ratio < 0.5) {
                console.log(`  ⚠️  OFF by ${(ratio * 100).toFixed(0)}%`);
            } else {
                console.log(`  ✅ Within acceptable range`);
            }
        } else {
            console.log('  ❌ No mapping');
        }
        console.log();
    }
}

main()
    .catch(console.error)
    .finally(() => process.exit(0));
