#!/usr/bin/env ts-node

import 'dotenv/config';
import { mapIngredientWithFatsecret } from '../src/lib/fatsecret/map-ingredient';
import { getValidatedMapping } from '../src/lib/fatsecret/validated-mapping-helpers';

async function test() {
    const testCases = [
        { input: '2 tbsps almond flour', expected: 'REJECT (maps to rice flour)' },
        { input: '4 chicken breasts', expected: 'APPROVE (correct)' },
        { input: '1 oz taco seasoning', expected: 'REJECT if maps to milk' },
    ];

    console.log('\n🧪 Testing AI Validation Integration\n');
    console.log('='.repeat(60));

    for (const { input, expected } of testCases) {
        console.log(`\n\nTest: "${input}"`);
        console.log(`Expected: ${expected}\n`);

        try {
            const result = await mapIngredientWithFatsecret(input, {
                minConfidence: 0.5,
                debug: false,
            });

            if (result) {
                console.log(`✅ Mapped to: ${result.foodName}`);
                console.log(`   Our Confidence: ${result.confidence.toFixed(3)}`);

                // Check if it was saved to validated cache
                const cached = await getValidatedMapping(input);
                if (cached) {
                    console.log(`   💾 SAVED TO VALIDATED CACHE`);
                } else {
                    console.log(`   ⚠️  NOT in validated cache (AI likely rejected or low confidence)`);
                }
            } else {
                console.log(`❌ No mapping found`);
            }
        } catch (error) {
            console.log(`❌ Error: ${(error as Error).message}`);
        }

        console.log('─'.repeat(60));
    }

    console.log('\n✅ Test Complete\n');
}

test().catch(console.error).finally(() => process.exit(0));
