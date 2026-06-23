// Quick test script for parser dual measurement changes
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';

console.log('Testing dual measurement parsing...\n');

// Test cases
const testCases = [
    { input: '0.25 cup & 1 tbsp flour', expected: { qty: 0.3125, unit: 'cup', name: 'flour' } },
    { input: '1 cup and 2 tbsp sugar', expected: { qty: 1.125, unit: 'cup', name: 'sugar' } },
    { input: '0.5 cup & 1 tsp vanilla extract', expected: { qty: 0.5208, unit: 'cup', name: 'vanilla extract' } },
    { input: '2 tbsps olive oil', expected: { qty: 2, unit: 'tbsp', name: 'olive oil' } },
    { input: '3 tsps vanilla', expected: { qty: 3, unit: 'tsp', name: 'vanilla' } },
    { input: '100g + 50g chicken', expected: { qty: 150, unit: 'g', name: 'chicken' } },
    { input: '1 lb and 8 oz beef', expected: { qty: 1.5, unit: 'lb', name: 'beef' } },
    // Existing tests that should still pass
    { input: '1 cup flour', expected: { qty: 1, unit: 'cup', name: 'flour' } },
    { input: '2 eggs', expected: { qty: 2, unit: 'egg', name: 'eggs' } },
    { input: '1 and 1/2 cups oats', expected: { qty: 1.5, unit: 'cup', name: 'oats' } },
];

let passed = 0;
let failed = 0;

for (const tc of testCases) {
    const result = parseIngredientLine(tc.input);

    if (!result) {
        console.log(`❌ "${tc.input}" -> NULL (expected qty=${tc.expected.qty}, unit=${tc.expected.unit})`);
        failed++;
        continue;
    }

    const qtyMatch = Math.abs(result.qty - tc.expected.qty) < 0.01;
    const unitMatch = result.unit === tc.expected.unit;
    const nameMatch = result.name === tc.expected.name;

    if (qtyMatch && unitMatch && nameMatch) {
        console.log(`✅ "${tc.input}" -> qty=${result.qty.toFixed(4)}, unit=${result.unit}, name="${result.name}"`);
        passed++;
    } else {
        console.log(`❌ "${tc.input}"`);
        console.log(`   Expected: qty=${tc.expected.qty}, unit=${tc.expected.unit}, name="${tc.expected.name}"`);
        console.log(`   Got:      qty=${result.qty.toFixed(4)}, unit=${result.unit}, name="${result.name}"`);
        failed++;
    }
}

console.log(`\n${passed}/${passed + failed} tests passed`);
process.exit(failed > 0 ? 1 : 0);
