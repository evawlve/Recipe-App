/**
 * Test Priority 1 false positive fixes
 */

import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

const TEST_CASES = [
    { input: '4 1/2 oz', expectNull: true, reason: 'no food name' },
    { input: '6 ice cubes', expectNotContains: ['ice breakers', 'mints', 'gum'], reason: 'brand confusion' },
    { input: '0.5 cup vinegar', expectNotContains: ['dressing'], reason: 'simple→complex' },
    { input: '1 cup acai puree', expectNotContains: ['tomato'], reason: 'category mismatch' },
    { input: '2 plum tomatoes', expectContains: ['tomato'], expectNotContains: ['plum fruit', 'dried plum'], reason: 'compound term' },
    { input: '1 tbsp cilantro', expectNotContains: ['coriander seed', 'ground coriander'], reason: 'plant form' },
    { input: 'mixed seeds bread', expectNotContains: ['pickle'], reason: 'token overlap' },
];

async function main() {
    console.log('🧪 Testing Priority 1 False Positive Fixes\n');
    console.log('='.repeat(70) + '\n');

    let passed = 0;
    let failed = 0;

    for (const testCase of TEST_CASES) {
        console.log(`Query: "${testCase.input}" (${testCase.reason})`);

        const result = await mapIngredientWithFallback(testCase.input, {
            debug: false,
            skipCache: true  // Skip cache to test fresh mapping
        });

        let testPassed = true;

        if (testCase.expectNull) {
            if (result === null) {
                console.log('  ✅ Correctly returned null (no mapping)');
            } else {
                console.log(`  ❌ FAILED: Expected null, got "${result.foodName}"`);
                testPassed = false;
            }
        } else if (result) {
            const foodNameLower = result.foodName.toLowerCase();

            if (testCase.expectContains) {
                for (const expected of testCase.expectContains) {
                    if (!foodNameLower.includes(expected.toLowerCase())) {
                        console.log(`  ❌ FAILED: Expected name to contain "${expected}", got "${result.foodName}"`);
                        testPassed = false;
                    }
                }
            }

            if (testCase.expectNotContains) {
                for (const excluded of testCase.expectNotContains) {
                    if (foodNameLower.includes(excluded.toLowerCase())) {
                        console.log(`  ❌ FAILED: Name should NOT contain "${excluded}", got "${result.foodName}"`);
                        testPassed = false;
                    }
                }
            }

            if (testPassed) {
                console.log(`  ✅ Mapped to: "${result.foodName}"`);
            }
        } else {
            console.log('  ❌ FAILED: No mapping (expected one)');
            testPassed = false;
        }

        if (testPassed) passed++;
        else failed++;
        console.log();
    }

    console.log('='.repeat(70));
    console.log(`\n📊 Results: ${passed}/${TEST_CASES.length} passed, ${failed} failed`);
}

main()
    .catch(console.error)
    .finally(() => process.exit(0));
