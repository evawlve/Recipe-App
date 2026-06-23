/**
 * Test Alias Validation Functions
 * 
 * Verifies that the new validation functions correctly identify bad mappings.
 */

import {
    hasNullOrInvalidMacros,
    isSimpleIngredientToProcessedMismatch,
    validateAliasMapping,
    isCategoryMismatch,
    isFoodTypeMismatch,
} from '@/lib/fatsecret/filter-candidates';

interface TestCase {
    name: string;
    fn: () => boolean;
    expected: boolean;
}

const testCases: TestCase[] = [
    // === hasNullOrInvalidMacros tests ===
    {
        name: 'hasNullOrInvalidMacros: null input',
        fn: () => hasNullOrInvalidMacros(null),
        expected: true,
    },
    {
        name: 'hasNullOrInvalidMacros: undefined input',
        fn: () => hasNullOrInvalidMacros(undefined),
        expected: true,
    },
    {
        name: 'hasNullOrInvalidMacros: missing kcal',
        fn: () => hasNullOrInvalidMacros({ protein: 5, carbs: 10, fat: 2 }),
        expected: true,
    },
    {
        name: 'hasNullOrInvalidMacros: all macros null',
        fn: () => hasNullOrInvalidMacros({ kcal: 100, protein: null, carbs: null, fat: null }),
        expected: true,
    },
    {
        name: 'hasNullOrInvalidMacros: valid complete nutrients',
        fn: () => hasNullOrInvalidMacros({ kcal: 100, protein: 5, carbs: 10, fat: 2 }),
        expected: false,
    },
    {
        name: 'hasNullOrInvalidMacros: red lentils case (null protein/carbs)',
        fn: () => hasNullOrInvalidMacros({ kcal: 314, protein: null, carbs: null, fat: 2.86 }),
        expected: true,
    },
    {
        name: 'hasNullOrInvalidMacros: valid with one macro',
        fn: () => hasNullOrInvalidMacros({ kcal: 100, protein: 5, carbs: null, fat: null }),
        expected: false,  // At least one macro present
    },

    // === isSimpleIngredientToProcessedMismatch tests ===
    {
        name: 'isSimpleIngredientToProcessedMismatch: chili peppers → cream cheese',
        fn: () => isSimpleIngredientToProcessedMismatch('chili peppers', 'Chilli Peppers Cream Cheese', { kcal: 233 }),
        expected: true,
    },
    {
        name: 'isSimpleIngredientToProcessedMismatch: chili peppers → Hot Chili Peppers',
        fn: () => isSimpleIngredientToProcessedMismatch('chili peppers', 'Hot Chili Peppers', { kcal: 40 }),
        expected: false,
    },
    {
        name: 'isSimpleIngredientToProcessedMismatch: strawberries → jam',
        fn: () => isSimpleIngredientToProcessedMismatch('strawberries', 'Strawberry Jam', { kcal: 250 }),
        expected: true,
    },
    {
        name: 'isSimpleIngredientToProcessedMismatch: strawberries → fresh',
        fn: () => isSimpleIngredientToProcessedMismatch('strawberries', 'Strawberries', { kcal: 32 }),
        expected: false,
    },
    {
        name: 'isSimpleIngredientToProcessedMismatch: basil → pesto',
        fn: () => isSimpleIngredientToProcessedMismatch('basil', 'Basil Pesto Sauce', { kcal: 350 }),
        expected: true,
    },
    {
        name: 'isSimpleIngredientToProcessedMismatch: chicken breast → nuggets',
        fn: () => isSimpleIngredientToProcessedMismatch('chicken breast', 'Chicken Breast Nuggets', { kcal: 280 }),
        expected: true,
    },
    {
        name: 'isSimpleIngredientToProcessedMismatch: chicken breast → raw',
        fn: () => isSimpleIngredientToProcessedMismatch('chicken breast', 'Chicken Breast', { kcal: 165 }),
        expected: false,
    },
    {
        name: 'isSimpleIngredientToProcessedMismatch: milk → chocolate shake',
        fn: () => isSimpleIngredientToProcessedMismatch('milk', 'Chocolate Milk Shake', { kcal: 150 }),
        expected: true,
    },

    // === validateAliasMapping tests ===
    {
        name: 'validateAliasMapping: chili → cream cheese (should fail)',
        fn: () => !validateAliasMapping('chili', 'Chilli Peppers Cream Cheese', { kcal: 233 }).valid,
        expected: true,
    },
    {
        name: 'validateAliasMapping: peppers → Hot Chili Peppers (should pass)',
        fn: () => validateAliasMapping('peppers', 'Hot Chili Peppers', { kcal: 40, protein: 2, carbs: 8, fat: 0.5 }).valid,
        expected: true,
    },
    {
        name: 'validateAliasMapping: cream → ice cream (category mismatch)',
        fn: () => !validateAliasMapping('cream', 'Ice Cream', { kcal: 200, protein: 3, carbs: 25, fat: 10 }).valid,
        expected: true,
    },
    {
        name: 'validateAliasMapping: null macros should fail',
        fn: () => !validateAliasMapping('tomato', 'Tomato', null).valid,
        expected: true,
    },
];

async function runTests() {
    console.log('=== Alias Validation Tests ===\n');

    let passed = 0;
    let failed = 0;

    for (const test of testCases) {
        try {
            const result = test.fn();
            const success = result === test.expected;

            if (success) {
                console.log(`✓ ${test.name}`);
                passed++;
            } else {
                console.log(`✗ ${test.name}`);
                console.log(`  Expected: ${test.expected}, Got: ${result}`);
                failed++;
            }
        } catch (error) {
            console.log(`✗ ${test.name}`);
            console.log(`  Error: ${(error as Error).message}`);
            failed++;
        }
    }

    console.log(`\n=== Results ===`);
    console.log(`Passed: ${passed}/${testCases.length}`);
    console.log(`Failed: ${failed}/${testCases.length}`);

    if (failed > 0) {
        process.exit(1);
    }
}

runTests();
