/**
 * Test how many search expressions we're generating
 */

import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { buildSearchExpressions } from '../src/lib/fatsecret/map-ingredient';

const TEST_CASES = [
    '3 large eggs',
    '16oz 90 lean ground beef',
    'rice vinegar',
    '1 lb 93% lean ground beef',
    '1/2 cup diced onion',
    '2 tbsp vegetable oil',
    '1 cup whole milk',
    '2 chicken breasts',
];

console.log('CHECKING SEARCH EXPRESSION COUNTS\n');

TEST_CASES.forEach(rawLine => {
    const parsed = parseIngredientLine(rawLine);
    const expressions = buildSearchExpressions(parsed, rawLine);
    console.log(`"${rawLine}"`);
    console.log(`  Count: ${expressions.length}`);
    console.log(`  Expressions: ${JSON.stringify(expressions.slice(0, 10))}`);
    if (expressions.length > 10) {
        console.log(`  ⚠️ WARNING: ${expressions.length} expressions (showing first 10)`);
    }
    console.log('');
});
