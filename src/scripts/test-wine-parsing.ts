// Test parsing of "1 5 fl oz serving red wine"
import { parseIngredientLine } from '../lib/parse/ingredient-line';

console.log('=== Testing Wine Fl Oz Parsing ===\n');

const testCases = [
    '1 5 fl oz serving red wine',
    '1  5 fl oz serving red wine',  // Extra space
    '5 fl oz red wine',
    '1 serving (5 fl oz) red wine',
];

for (const line of testCases) {
    const result = parseIngredientLine(line);
    console.log(`Input: "${line}"`);
    if (result) {
        console.log(`  qty: ${result.qty}`);
        console.log(`  unit: ${result.unit}`);
        console.log(`  rawUnit: ${result.rawUnit}`);
        console.log(`  multiplier: ${result.multiplier}`);
        console.log(`  name: "${result.name}"`);
    } else {
        console.log('  (null result)');
    }
    console.log('');
}
