/**
 * Verify Core Token Mismatch Fixes
 * 
 * Tests that the hasCoreTokenMismatch function now correctly identifies
 * semantic drift cases that were previously passing through.
 */

import { hasCoreTokenMismatch } from '../src/lib/fatsecret/filter-candidates';

const TEST_CASES = [
    // Case 1: corn starch → Baby Corn (should be MISMATCH)
    {
        query: 'corn starch',
        foodName: 'Baby Corn',
        brandName: null,
        expectedMismatch: true,
        reason: 'starch is a core token, not present in Baby Corn',
    },
    // Case 2: burger relish → Black Bean Burger (should be MISMATCH)
    {
        query: 'burger relish',
        foodName: 'Black Bean Burger',
        brandName: null,
        expectedMismatch: true,
        reason: 'relish is a core token, not present in Black Bean Burger',
    },
    // Case 3: vegetable bouillon → Vegetable Shortening (should be MISMATCH)
    {
        query: 'vegetable bouillon',
        foodName: 'Vegetable Shortening',
        brandName: null,
        expectedMismatch: true,
        reason: 'bouillon is a core token, shortening is different food category',
    },
    // Case 4: dry brown rice → dry brown beans (should be MISMATCH)
    {
        query: 'dry brown rice',
        foodName: 'Dry Brown Beans',
        brandName: null,
        expectedMismatch: true,
        reason: 'rice is a core token, not present in beans',
    },
    // Case 5: corn starch → Corn Starch (should be OK)
    {
        query: 'corn starch',
        foodName: 'Corn Starch',
        brandName: 'Argo',
        expectedMismatch: false,
        reason: 'starch IS present in Corn Starch',
    },
    // Case 6: golden flaxseed → Golden Delicious Apples (should be MISMATCH)
    {
        query: 'golden flaxseed',
        foodName: 'Golden Delicious Apples',
        brandName: null,
        expectedMismatch: true,
        reason: 'flaxseed is a core token, not present in apples',
    },
    // Case 7: vegetable bouillon → Vegetable Broth (should be OK - bouillon synonym)
    {
        query: 'vegetable bouillon',
        foodName: 'Vegetable Broth',
        brandName: null,
        expectedMismatch: false,
        reason: 'broth is a synonym for bouillon',
    },
];

console.log('=== Core Token Mismatch Verification ===\n');

let passed = 0;
let failed = 0;

for (const test of TEST_CASES) {
    const result = hasCoreTokenMismatch(test.query, test.foodName, test.brandName);
    const isCorrect = result === test.expectedMismatch;

    if (isCorrect) {
        passed++;
        console.log(`✅ PASS: "${test.query}" → "${test.foodName}"`);
        console.log(`   Expected: ${test.expectedMismatch ? 'MISMATCH' : 'OK'}, Got: ${result ? 'MISMATCH' : 'OK'}`);
    } else {
        failed++;
        console.log(`❌ FAIL: "${test.query}" → "${test.foodName}"`);
        console.log(`   Expected: ${test.expectedMismatch ? 'MISMATCH' : 'OK'}, Got: ${result ? 'MISMATCH' : 'OK'}`);
        console.log(`   Reason: ${test.reason}`);
    }
    console.log();
}

console.log('='.repeat(50));
console.log(`Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
    process.exit(1);
}
