/**
 * Targeted test for capocollo "3 slice" scenario
 * Verifies: selectServing returns null for count unit when no matching serving exists
 */

import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { FatSecretClient } from '../src/lib/fatsecret/client';
import { prisma } from '../src/lib/db';

async function testCapocolloSlice() {
    console.log('=== Testing Capocollo "3 slice" Scenario ===\n');

    const client = new FatSecretClient();

    // Test the exact ingredient line that caused issues
    const testLine = '3 slice capocollo';

    console.log(`Testing: "${testLine}"\n`);

    try {
        const result = await mapIngredientWithFallback(testLine, { client });

        if (result) {
            console.log('✅ Mapping succeeded:');
            console.log(`   Food: ${result.foodName} (${result.brandName || 'generic'})`);
            console.log(`   Serving: ${result.servingDescription}`);
            console.log(`   Grams: ${result.servingGrams}g`);
            console.log(`   Total: ${result.servingGrams * 3}g for 3 slices`);
            console.log(`   Confidence: ${result.confidence}`);

            // Check if we got a proper slice serving or just a generic one
            const servingDesc = (result.servingDescription || '').toLowerCase();
            if (servingDesc.includes('slice') || servingDesc.includes('piece')) {
                console.log('\n   ✅ GOOD: Got a count-based serving!');
            } else if (servingDesc === 'serving' || /^1?\s*serving$/i.test(servingDesc)) {
                console.log('\n   ⚠️ WARNING: Got generic "serving" - this should not happen with new logic!');
            } else {
                console.log(`\n   ℹ️ Got serving type: "${servingDesc}"`);
            }
        } else {
            console.log('❌ Mapping returned null');
            console.log('   This could mean no suitable food found OR no suitable serving found');
            console.log('   (With new logic, this is expected if no count serving exists)');
        }
    } catch (error) {
        console.log('❌ Error during mapping:');
        console.log(`   ${(error as Error).message}`);
    }

    // Also test a few related scenarios
    console.log('\n' + '='.repeat(50));
    console.log('Additional test cases:\n');

    const additionalTests = [
        '2 slice wheat bread',      // Should find slice serving
        '1 egg',                     // Should find count serving
        '0.5 cup diced onion',       // Should find volume serving
        '3 piece chicken breast',    // Should find count serving
    ];

    for (const line of additionalTests) {
        try {
            const result = await mapIngredientWithFallback(line, { client });
            if (result) {
                console.log(`✅ "${line}"`);
                console.log(`   → ${result.foodName}: ${result.servingDescription} = ${result.servingGrams}g`);
            } else {
                console.log(`❌ "${line}" - mapping failed`);
            }
        } catch (error) {
            console.log(`❌ "${line}" - error: ${(error as Error).message}`);
        }
    }

    console.log('\n=== Done ===');
    await prisma.$disconnect();
}

testCapocolloSlice().catch(console.error);
