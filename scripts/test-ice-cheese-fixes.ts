#!/usr/bin/env ts-node
/**
 * Simple test for ice and cheese mapping fixes
 */

import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { FatSecretClient } from '../src/lib/fatsecret/client';

const TEST_CASES = [
    '1 cup crushed ice',
    '1 cup reduced fat colby and monterey jack cheese',
];

async function main() {
    const client = new FatSecretClient();

    console.log('🧪 Testing Mapping Fixes\n');

    for (const rawLine of TEST_CASES) {
        console.log(`Testing: "${rawLine}"`);

        const result = await mapIngredientWithFallback(rawLine, {
            client,
            minConfidence: 0.5,
            skipAiValidation: true,
            debug: false,
        });

        if (result) {
            const isIce = rawLine.includes('ice');
            const isReducedFat = rawLine.includes('reduced fat');

            const food = result.foodName.toLowerCase();

            // Check for issues
            let status = '✅ OK';
            if (isIce && food.includes('ice breakers')) {
                status = '❌ FAIL - Ice Breakers mints!';
            }
            if (isReducedFat && !food.includes('reduced') && !food.includes('low') && !food.includes('2%')) {
                status = '❌ FAIL - Missing reduced fat modifier!';
            }

            console.log(`  → "${result.foodName}" (${result.fat}g fat per ${result.grams}g)`);
            console.log(`  ${status}\n`);
        } else {
            console.log(`  → NO MATCH (null result)\n`);
        }
    }

    console.log('Done!');
}

main().catch(console.error);
