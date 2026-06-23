#!/usr/bin/env ts-node
/**
 * Debug script to investigate two mapping issues:
 * 1. "crushed ice" → Ice Breakers mints (should be water/ice)
 * 2. "reduced fat colby and monterey jack cheese" → full-fat cheese
 */

import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { FatSecretClient } from '../src/lib/fatsecret/client';

const TEST_CASES = [
    // Ice issues - the existing rule should catch "ice cubes" but not "crushed ice"
    { raw: '1 cup crushed ice', expectedToFail: 'Ice Breakers' },
    { raw: '6 ice cubes', expectedToFail: 'Ice Breakers' },
    { raw: '1 cup ice', expectedToFail: 'Ice Breakers' },

    // Cheese fat modifier issues
    { raw: '1 cup reduced fat colby and monterey jack cheese', expectedToFail: 'full-fat' },
    { raw: '1 cup reduced fat cheddar cheese', expectedToFail: 'full-fat' },
    { raw: '1 cup fat free cheddar cheese', expectedToFail: 'full-fat' },
];

async function main() {
    const client = new FatSecretClient();

    console.log('🔍 Debugging Mapping Issues\n');
    console.log('='.repeat(80));

    for (const testCase of TEST_CASES) {
        console.log(`\n📝 Testing: "${testCase.raw}"`);
        console.log('-'.repeat(60));

        try {
            const result = await mapIngredientWithFallback(testCase.raw, {
                client,
                minConfidence: 0.5,
                skipAiValidation: true,
                debug: true,  // Enable debug logging
            });

            if (result) {
                console.log(`\n✅ MAPPED:`);
                console.log(`   Food: ${result.foodName}`);
                console.log(`   Brand: ${result.brandName || 'N/A'}`);
                console.log(`   Confidence: ${result.confidence.toFixed(3)}`);
                console.log(`   Grams: ${result.grams}g`);
                console.log(`   Kcal: ${result.kcal}`);
                console.log(`   Macros: P:${result.protein} C:${result.carbs} F:${result.fat}`);

                // Check if this is the problematic mapping
                const foodNameLower = result.foodName.toLowerCase();
                if (testCase.expectedToFail && (
                    foodNameLower.includes('ice breakers') ||
                    (testCase.expectedToFail === 'full-fat' && result.fat > 20)
                )) {
                    console.log(`\n   ⚠️  ISSUE CONFIRMED: This is the problematic mapping!`);
                }
            } else {
                console.log(`\n❌ NO MATCH - mapping returned null`);
            }
        } catch (error) {
            console.log(`\n💥 ERROR: ${error instanceof Error ? error.message : error}`);
        }

        console.log('\n' + '='.repeat(80));
    }
}

main().catch(console.error);
