#!/usr/bin/env npx tsx

import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { FatSecretClient } from '../src/lib/fatsecret/client';

async function main() {
    const testCase = '1 lb ground beef 85%';
    const client = new FatSecretClient();

    console.log('='.repeat(60));
    console.log(`Testing: "${testCase}"`);
    console.log('='.repeat(60));

    // 1. Check parsing
    const parsed = parseIngredientLine(testCase);
    console.log('\n1. PARSING:');
    console.log('   qty:', parsed?.qty);
    console.log('   unit:', parsed?.unit);
    console.log('   name:', parsed?.name);

    // 2. Check what FatSecret returns for different queries
    console.log('\n2. FATSECRET API RESULTS:');
    const queries = [
        'ground beef 85%',
        '85% lean ground beef',
        '85/15 ground beef',
        'ground beef lean',
    ];

    for (const query of queries) {
        console.log(`\n   Query: "${query}"`);
        try {
            const results = await client.searchFoodsV4(query, { maxResults: 5 });
            results.forEach((r, i) => {
                console.log(`     ${i + 1}. ${r.name}${r.brandName ? ` (${r.brandName})` : ''}`);
            });
        } catch (e) {
            console.log('     Error:', e);
        }
    }

    // 3. Run actual mapping with debug
    console.log('\n3. ACTUAL MAPPING:');
    const result = await mapIngredientWithFallback(testCase, { debug: true });

    if (result) {
        console.log('\n   ✓ RESULT:');
        console.log('     Food:', result.foodName);
        console.log('     Grams:', result.grams);
        console.log('     Calories:', result.kcal.toFixed(1));
        console.log('     Fat:', result.fat.toFixed(1), 'g');
        console.log('     kcal/100g:', ((result.kcal / result.grams) * 100).toFixed(1));

        // Check if this is 85% lean (should have ~15g fat per 100g)
        const fatPer100g = (result.fat / result.grams) * 100;
        console.log('     fat/100g:', fatPer100g.toFixed(1), 'g');
        if (fatPer100g > 18) {
            console.log('     ❌ TOO MUCH FAT - this is NOT 85% lean beef!');
            console.log('        85% lean should have ~15g fat/100g, got', fatPer100g.toFixed(1));
        } else if (fatPer100g < 12) {
            console.log('     ⚠️ Very lean - might be 93%+ lean');
        } else {
            console.log('     ✓ Fat content looks correct for 85% lean');
        }
    } else {
        console.log('   ✗ No mapping found');
    }
}

main().catch(console.error);
