/**
 * Test fat-free cheese mapping after fix
 */

import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

const TEST_CASES = [
    '4 oz fat free cheddar cheese',
    '1 oz mozzarella fat free',
    '1 oz fat free feta cheese',
    '0.25 cup nonfat Italian dressing',
    '1 lb cottage cheese low fat',
];

async function main() {
    console.log('🧪 Testing Fat-Free Cheese Mapping\n');
    console.log('With ORIGINAL_SCORE = 0.6 (was 0.2)\n');
    console.log('='.repeat(60) + '\n');

    for (const testCase of TEST_CASES) {
        console.log(`Query: "${testCase}"`);

        const result = await mapIngredientWithFallback(testCase, { debug: false, skipCache: true });

        if (result) {
            console.log(`  → ${result.foodName}`);
            console.log(`     Fat: ${result.fat}g | Confidence: ${result.confidence.toFixed(2)}`);

            // Flag if fat is higher than expected for "fat free"
            if (testCase.toLowerCase().includes('fat free') && result.fat > 3) {
                console.log(`     ⚠️  WARNING: Fat content (${result.fat}g) seems high for fat-free item!`);
            } else if (testCase.toLowerCase().includes('nonfat') && result.fat > 3) {
                console.log(`     ⚠️  WARNING: Fat content (${result.fat}g) seems high for nonfat item!`);
            } else if (testCase.toLowerCase().includes('low fat') && result.fat > 10) {
                console.log(`     ⚠️  WARNING: Fat content (${result.fat}g) seems high for low-fat item!`);
            } else {
                console.log(`     ✅ Fat content looks reasonable`);
            }
        } else {
            console.log(`  → ❌ No mapping found`);
        }
        console.log();
    }
}

main()
    .catch(console.error)
    .finally(() => process.exit(0));
