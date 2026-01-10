#!/usr/bin/env npx tsx

import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';

async function test(input: string, expectedFood: string, expectedMinGrams: number) {
    const parsed = parseIngredientLine(input);
    const result = await mapIngredientWithFallback(input, { debug: false });

    if (result) {
        const foodMatches = result.foodName.toLowerCase().includes(expectedFood.toLowerCase());
        const gramsOk = result.grams >= expectedMinGrams;
        const status = (foodMatches && gramsOk) ? '✓' : '❌';

        console.log(`${status} "${input}"`);
        console.log(`   Parsed: qty=${parsed?.qty}, unit=${parsed?.unit || 'null'}, name="${parsed?.name}"`);
        console.log(`   → ${result.foodName} (${result.grams}g, ${result.kcal.toFixed(0)}kcal)`);
        if (!foodMatches) console.log(`   ⚠ Expected food containing: "${expectedFood}"`);
        if (!gramsOk) console.log(`   ⚠ Expected >= ${expectedMinGrams}g, got ${result.grams}g`);
    } else {
        console.log(`✗ "${input}" → NO MAPPING`);
    }
    console.log();
}

async function main() {
    console.log('Testing remaining issues:\n');

    await test('2 cup strawberry halves', 'Strawberr', 300);
    await test('2 cup stberry halves', 'Strawberr', 300);  // typo version
    await test('1  5" long sweet potato', 'Sweet Potato', 120);
    await test('1.5 cup rolled oats', 'Oat', 100);
    await test('2 tbsp tomato salsa', 'Salsa', 20);
}

main().catch(console.error);
