/**
 * Test Step 8 - Produce Size Optimization
 * Verifies FDC + defaults are tried before LLM
 */

import { getDefaultCountServing } from '../src/lib/servings/default-count-grams';
import { isAmbiguousUnit } from '../src/lib/ai/ambiguous-serving-estimator';

console.log('Testing Step 8 - Produce Size Optimization\n');

// Test that count defaults work for common produce
const tests = [
    { name: 'banana', unit: 'medium', expected: 118 },
    { name: 'apple', unit: 'large', expected: 223 },
    { name: 'egg', unit: 'each', expected: 50 },
    { name: 'avocado', unit: 'medium', expected: 201 },
];

console.log('Testing getDefaultCountServing:');
let allPassed = true;
for (const test of tests) {
    const result = getDefaultCountServing(
        test.name,
        test.unit,
        test.unit as 'small' | 'medium' | 'large' | undefined
    );

    const passed = result && result.grams === test.expected;
    console.log(`  ${test.name} (${test.unit}): ${result?.grams ?? 'NOT FOUND'}g` +
        ` (expected: ${test.expected}g) ${passed ? 'PASS' : 'FAIL'}`);
    if (!passed) allPassed = false;
}

// Test that ambiguous units are recognized
console.log('\nTesting isAmbiguousUnit:');
const ambiguousTests = [
    { unit: 'container', expected: true },
    { unit: 'medium', expected: true },
    { unit: 'cup', expected: false },
    { unit: 'package', expected: true },
];

for (const test of ambiguousTests) {
    const result = isAmbiguousUnit(test.unit);
    const passed = result === test.expected;
    console.log(`  "${test.unit}": ${result} (expected: ${test.expected}) ${passed ? 'PASS' : 'FAIL'}`);
    if (!passed) allPassed = false;
}

console.log(`\n${allPassed ? 'ALL TESTS PASSED' : 'SOME TESTS FAILED'}`);
process.exit(allPassed ? 0 : 1);
