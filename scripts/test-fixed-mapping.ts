/**
 * Test the actual buildSearchExpressions function with our fixes
 */

import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { buildSearchExpressions } from '../src/lib/fatsecret/map-ingredient';

const TEST_CASES = [
    '16oz 90 lean ground beef',
    'rice vinegar',
    '1 lb 93% lean ground beef',
    '2 tbsp apple cider vinegar',
    '1/4 cup balsamic vinegar',
    '2 cups vegetable oil',
];

function testIngredient(rawLine: string) {
    console.log('\n' + '='.repeat(80));
    console.log(`RAW LINE: "${rawLine}"`);
    console.log('='.repeat(80));

    const parsed = parseIngredientLine(rawLine);
    console.log('\nParsed name:', parsed?.name);

    const searchExpressions = buildSearchExpressions(parsed, rawLine);
    console.log('\nSearch expressions (in priority order):');
    searchExpressions.forEach((expr, idx) => {
        console.log(`  [${idx + 1}] "${expr}"`);
    });

    // Check if problematic fallbacks are present
    if (rawLine.includes('rice vinegar') && searchExpressions.includes('vinegar')) {
        console.log('\n❌ WARNING: Generic "vinegar" fallback found for "rice vinegar"');
    }
    if (rawLine.includes('90 lean') && !searchExpressions.some(e => e.includes('90'))) {
        console.log('\n❌ WARNING: "90" leanness indicator was stripped');
    }
    if (rawLine.includes('93%') && !searchExpressions.some(e => e.includes('93'))) {
        console.log('\n❌ WARNING: "93%" leanness indicator was stripped');
    }
}

console.log('TESTING FIXED SEARCH EXPRESSION BUILDER\n');
TEST_CASES.forEach(testIngredient);

console.log('\n' + '='.repeat(80));
console.log('Testing complete');
console.log('='.repeat(80));
