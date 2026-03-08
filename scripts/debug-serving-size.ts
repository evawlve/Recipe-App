#!/usr/bin/env ts-node

import 'dotenv/config';
import { mapIngredientWithFatsecret } from '../src/lib/fatsecret/map-ingredient';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';

async function test() {
    const rawLine = '4 chicken breasts';

    console.log(`\nParsing: "${rawLine}"\n`);

    // First, see what the parser gives us
    const parsed = parseIngredientLine(rawLine);
    console.log('Parsed:');
    console.log(JSON.stringify(parsed, null, 2));

    console.log('\n' + '='.repeat(60));
    console.log('Mapping with FatSecret...\n');

    const result = await mapIngredientWithFatsecret(rawLine, {
        debug: false,
        minConfidence: 0.5,
    });

    if (result) {
        console.log(`\n✅ RESULT:`);
        console.log(`   Food: ${result.foodName}`);
        console.log(`   Brand: ${result.brandName || 'N/A'}`);
        console.log(`   Grams: ${result.grams}g ← THIS IS THE BUG`);
        console.log(`   Confidence: ${result.confidence.toFixed(3)}`);
        console.log(`   Serving: ${result.servingDescription}`);
        console.log(`   Serving ID: ${result.servingId}`);
        console.log(`\n   Nutrition (total):`);
        console.log(`     Calories: ${result.kcal}`);
        console.log(`     Protein: ${result.protein}g`);
        console.log(`     Carbs: ${result.carbs}g`);
        console.log(`     Fat: ${result.fat}g`);
    } else {
        console.log(`\n❌ NO RESULT`);
    }
}

test().catch(console.error).finally(() => process.exit(0));
