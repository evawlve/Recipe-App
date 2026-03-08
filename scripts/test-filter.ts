/**
 * Test the hasNullOrInvalidMacros filter directly
 */

import { hasNullOrInvalidMacros } from '../src/lib/fatsecret/filter-candidates';

// This is what Freshii Green Onion has
const freshiiNutrients = {
    fat: 0,
    carbs: 0,
    fiber: 0,
    sugar: 0,
    protein: 0,
    calories: 0
};

console.log('Testing hasNullOrInvalidMacros with Freshii data:');
console.log('Input:', JSON.stringify(freshiiNutrients));

const result = hasNullOrInvalidMacros(freshiiNutrients);
console.log('Result (true = invalid/should reject):', result);
console.log('');

// Test with null values
const nullNutrients = {
    fat: null,
    carbs: null,
    protein: null,
    calories: null
};

console.log('Testing with null values:');
console.log('Input:', JSON.stringify(nullNutrients));
const result2 = hasNullOrInvalidMacros(nullNutrients);
console.log('Result:', result2);
