#!/usr/bin/env tsx
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';

const testCases = [
    "1 5 fl oz serving red wine",
    "1  5 fl oz serving red wine",  // With double space
    "2 5fl oz serving wine",
    "1 serving (5 fl oz) red wine",
];

console.log('=== Testing Embedded Serving Patterns ===\n');
for (const test of testCases) {
    const result = parseIngredientLine(test);
    console.log(`Input: "${test}"`);
    if (result) {
        console.log(`  Parsed: qty=${result.qty}, unit=${result.unit}, name="${result.name}"`);
    } else {
        console.log(`  Parsed: null`);
    }
    console.log('');
}
