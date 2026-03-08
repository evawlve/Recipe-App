#!/usr/bin/env npx tsx

import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';

const testCases = [
    '2 lbs extra lean ground beef',
    '1 lb ground beef 85%',
];

async function main() {
    for (const testCase of testCases) {
        console.log('\n' + '='.repeat(60));
        console.log(`Testing: "${testCase}"`);

        // First check parsing
        const parsed = parseIngredientLine(testCase);
        console.log(`Parsed: qty=${parsed.qty}, unit=${parsed.unit}, name=${parsed.name}`);
        console.log(`Expected grams: 1 lb = 453.6g, so ${parsed.qty} ${parsed.unit} = ${(parsed.qty || 1) * 453.6}g (if lbs)`);

        const result = await mapIngredientWithFallback(testCase, { debug: true });

        if (result) {
            console.log(`\n✓ RESULT:`);
            console.log(`  Food: ${result.foodName}`);
            console.log(`  Grams: ${result.grams}g`);
            console.log(`  Serving: ${result.servingDescription}`);
            console.log(`  Calories: ${result.kcal.toFixed(1)}`);
            console.log(`  Macros: P:${result.protein.toFixed(1)} C:${result.carbs.toFixed(1)} F:${result.fat.toFixed(1)}`);

            // Calculate expected
            const expectedGrams = (parsed.qty || 1) * 453.6;
            if (parsed.unit?.toLowerCase().includes('lb')) {
                console.log(`\n  ⚠️ EXPECTED: ${expectedGrams}g for ${parsed.qty} lbs`);
                console.log(`  ⚠️ ACTUAL: ${result.grams}g`);
                if (Math.abs(result.grams - expectedGrams) > 50) {
                    console.log(`  ❌ MISMATCH: Off by ${Math.abs(result.grams - expectedGrams).toFixed(0)}g`);
                }
            }
        } else {
            console.log('✗ No mapping found');
        }
    }
}

main().catch(console.error);
