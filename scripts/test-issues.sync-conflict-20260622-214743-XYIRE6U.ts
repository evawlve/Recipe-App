#!/usr/bin/env npx tsx

import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

const testCases = [
    '2 lbs extra lean ground beef',
    '1 lb ground beef 85%',
    '16 oz beef',
    '1.5 cup rolled oats',
    '2 tbsp tomato salsa',
    '2 cup strawberry halves',
    '1 5" long sweet potato',
];

async function main() {
    for (const testCase of testCases) {
        console.log('='.repeat(60));
        console.log(`Testing: "${testCase}"`);

        const result = await mapIngredientWithFallback(testCase, { debug: false });

        if (result) {
            console.log(`✓ Mapped to: ${result.foodName}`);
            console.log(`  Grams: ${result.grams}g`);
            console.log(`  Calories: ${result.kcal.toFixed(1)}`);
            console.log(`  Macros: P:${result.protein.toFixed(1)} C:${result.carbs.toFixed(1)} F:${result.fat.toFixed(1)}`);
            console.log(`  kcal/100g: ${((result.kcal / result.grams) * 100).toFixed(1)}`);
        } else {
            console.log('✗ No mapping found');
        }
    }
}

main().catch(console.error);
