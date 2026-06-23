#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { mapIngredientWithFatsecret } from '../src/lib/fatsecret/map-ingredient';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';

async function debugAutoMap() {
    const testCases = [
        { name: "90 lean ground beef", qty: 16, unit: "oz" },
        { name: "rice vinegar", qty: 1, unit: "tbsp" }
    ];

    console.log('\n🔍 Debugging Auto-Mapper Cases:\n');

    for (const test of testCases) {
        console.log(`\n----------------------------------------`);
        console.log(`Testing: "${test.qty} ${test.unit} ${test.name}"`);
        console.log(`----------------------------------------`);

        // Create a temporary ingredient object
        const ingredient = {
            id: 'debug-id',
            name: test.name,
            qty: test.qty,
            unit: test.unit,
            recipeId: 'debug-recipe',
            order: 0,
            originalLine: `${test.qty} ${test.unit} ${test.name}`
        };

        try {
            // mapIngredientWithFatsecret expects a string, not a parsed object
            console.log(`  🔍 Searching for: "${ingredient.originalLine}"`);
            const result = await mapIngredientWithFatsecret(ingredient.originalLine, {
                allowLiveFallback: true,
                debug: true
            });

            console.log('\nResult:');
            if (result) {
                console.log(`  Food ID: ${result.foodId}`);
                console.log(`  Food Name: "${result.foodName}"`);
                console.log(`  Confidence: ${result.confidence}`);
                console.log(`  Source: ${result.source}`);
            } else {
                console.log('  ❌ No mapping found');
            }

        } catch (error) {
            console.error('  ❌ Error during mapping:', error);
        }
    }

    await prisma.$disconnect();
}

debugAutoMap();
