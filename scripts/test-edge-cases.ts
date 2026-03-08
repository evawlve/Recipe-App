// Test script for edge case improvements
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';

console.log('Testing Edge Case Improvements...\n');

// Test cases
const testCases = [
    // Embedded serving pattern
    { input: '1 5 fl oz serving red wine', expectedQty: 5, expectedUnit: 'floz', expectedName: 'red wine' },
    { input: '1 serving (5 oz) chicken', expectedQty: 5, expectedUnit: 'oz', expectedName: 'chicken' },

    // Countable vegetables with default "medium" unit
    { input: '2 carrots', expectedQty: 2, expectedUnit: 'medium', expectedName: 'carrots' },
    { input: '1 onion', expectedQty: 1, expectedUnit: 'medium', expectedName: 'onion' },
    { input: '3 bananas', expectedQty: 3, expectedUnit: 'medium', expectedName: 'bananas' },
    { input: '2 potatoes', expectedQty: 2, expectedUnit: 'medium', expectedName: 'potatoes' },

    // These should NOT get default medium (they already have units or unit hints)
    { input: '1 cup carrots', expectedQty: 1, expectedUnit: 'cup', expectedName: 'carrots' },
    { input: '2 medium onions', expectedQty: 2, expectedUnit: 'medium', expectedName: 'onions' },

    // Basic parsing should still work
    { input: '0.25 cup coconut flour', expectedQty: 0.25, expectedUnit: 'cup', expectedName: 'coconut flour' },
    { input: '2 tbsps almond milk', expectedQty: 2, expectedUnit: 'tbsp', expectedName: 'almond milk' },
];

let passed = 0;
let failed = 0;

for (const tc of testCases) {
    const result = parseIngredientLine(tc.input);

    if (!result) {
        console.log(`❌ "${tc.input}" -> NULL`);
        failed++;
        continue;
    }

    const qtyMatch = tc.expectedQty !== undefined ? Math.abs(result.qty - tc.expectedQty) < 0.01 : true;
    const unitMatch = tc.expectedUnit !== undefined ? result.unit === tc.expectedUnit : true;
    const nameMatch = tc.expectedName !== undefined ? result.name === tc.expectedName : true;

    if (qtyMatch && unitMatch && nameMatch) {
        console.log(`✅ "${tc.input}" -> qty=${result.qty.toFixed(2)}, unit=${result.unit}, name="${result.name}"`);
        passed++;
    } else {
        console.log(`❌ "${tc.input}"`);
        if (!qtyMatch) console.log(`   Qty: expected ${tc.expectedQty}, got ${result.qty}`);
        if (!unitMatch) console.log(`   Unit: expected "${tc.expectedUnit}", got "${result.unit}"`);
        if (!nameMatch) console.log(`   Name: expected "${tc.expectedName}", got "${result.name}"`);
        failed++;
    }
}

console.log(`\n${passed}/${passed + failed} tests passed`);
process.exit(failed > 0 ? 1 : 0);
