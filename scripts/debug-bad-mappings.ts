#!/usr/bin/env ts-node

import 'dotenv/config';
import { mapIngredientWithFatsecret } from '../src/lib/fatsecret/map-ingredient';

async function test() {
    const testCases = [
        '4 chicken breasts',
        '2 tbsps almond flour',
        '1 oz taco seasoning',
        '6 potatoes',
        '0.25 purple onion',
    ];

    console.log('🔍 Debugging Bad Mappings\n');

    for (const rawLine of testCases) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`Testing: "${rawLine}"`);
        console.log('='.repeat(60));

        const result = await mapIngredientWithFatsecret(rawLine, {
            debug: true,
            minConfidence: 0.5,
        });

        if (result) {
            console.log(`\n✅ RESULT:`);
            console.log(`   Food: ${result.foodName}`);
            console.log(`   Grams: ${result.grams}g`);
            console.log(`   Confidence: ${result.confidence.toFixed(3)}`);
            console.log(`   Serving: ${result.servingDescription}`);
        } else {
            console.log(`\n❌ NO RESULT`);
        }
    }
}

test().catch(console.error).finally(() => process.exit(0));
