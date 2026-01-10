/**
 * Test weight unit conversion fix - verbose output
 */
import 'dotenv/config';

// Suppress prisma query logging
process.env.DEBUG = '';

import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function main() {
    const testCases = [
        { raw: '16 oz ground beef', expected: 453.6 },
        { raw: '1 lb ground beef', expected: 453.6 },
        { raw: '250 g chicken breast', expected: 250 },
    ];

    console.log('=== Testing Weight Unit Conversion ===\n');

    for (const { raw, expected } of testCases) {
        console.log('Testing:', raw);
        const result = await mapIngredientWithFallback(raw, { debug: false });
        if (result) {
            const diff = Math.abs(result.grams - expected);
            const status = diff < 5 ? '✓ PASS' : '✗ FAIL';
            console.log(`  ${status}: ${result.foodName}`);
            console.log(`    Grams: ${result.grams.toFixed(1)}g (expected: ${expected}g)`);
            console.log(`    Kcal: ${result.kcal.toFixed(0)}`);
        } else {
            console.log('  ✗ FAILED - no result');
        }
        console.log('');
    }
}

main()
    .then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1); });
