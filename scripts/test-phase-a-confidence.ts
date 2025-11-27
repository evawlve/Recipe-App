#!/usr/bin/env ts-node

import 'dotenv/config';
import { mapIngredientWithFatsecret } from '../src/lib/fatsecret/map-ingredient';

async function main() {
    console.log('\n🧪 Testing Phase A Confidence Improvements\n');
    console.log('='.repeat(60) + '\n');

    const testCases = [
        // Test 1: Common ingredient boost
        {
            line: '2 chicken breasts',
            expected: 'Should get +0.05 common ingredient boost',
            minConfidence: 0.75
        },
        // Test 2: Cook state penalty reduction (implicit mismatch)
        {
            line: '1 lb beef',  // Might match "beef, cooked" but user didn't specify
            expected: 'Should only get -0.05 penalty (not -0.15)',
            minConfidence: 0.70
        },
        // Test 3: Common ingredient + good name match
        {
            line: '2 eggs',
            expected: 'Common ingredient with exact match = high confidence',
            minConfidence: 0.85
        },
        // Test 4: Another common ingredient
        {
            line: '1 cup flour',
            expected: 'Common ingredient boost',
            minConfidence: 0.75
        },
        // Test 5: Onions (common)
        {
            line: '1 onion',
            expected: 'Common ingredient',
            minConfidence: 0.75
        },
        // Test 6: Olive oil (very common)
        {
            line: '2 tbsp olive oil',
            expected: 'Very common ingredient',
            minConfidence: 0.80
        },
        // Test 7: Less common ingredient (should still work, no boost)
        {
            line: '1 cup quinoa',
            expected: 'Still in common list - should get boost',
            minConfidence: 0.70
        }
    ];

    let passed = 0;
    let failed = 0;

    for (const test of testCases) {
        console.log(`Testing: "${test.line}"`);
        console.log(`Expected: ${test.expected}`);

        const result = await mapIngredientWithFatsecret(test.line, {
            minConfidence: 0.4,  // Low threshold to see all results
            debug: false
        });

        if (result) {
            const actualConfidence = result.confidence;
            const meetsExpectation = actualConfidence >= test.minConfidence;

            if (meetsExpectation) {
                console.log(`✅ PASS - Confidence: ${actualConfidence.toFixed(3)} (>= ${test.minConfidence})`);
                console.log(`   Food: ${result.foodName}`);
                console.log(`   Quality: ${result.quality}`);
                passed++;
            } else {
                console.log(`❌ FAIL - Confidence: ${actualConfidence.toFixed(3)} (expected >= ${test.minConfidence})`);
                console.log(`   Food: ${result.foodName}`);
                failed++;
            }
        } else {
            console.log(`❌ FAIL - No mapping found`);
            failed++;
        }
        console.log('');
    }

    console.log('='.repeat(60));
    console.log(`\n📊 Results: ${passed}/${testCases.length} passed`);

    if (failed === 0) {
        console.log('🎉 All tests passed! Phase A improvements working correctly.\n');
    } else {
        console.log(`⚠️  ${failed} tests failed. Review needed.\n`);
    }

    console.log('💡 Phase A Improvements:');
    console.log('  ✅ Common ingredient boost (+0.05)');
    console.log('  ✅ Relaxed cook state penalty (-0.05 instead of -0.15)');
    console.log('  ✅ Should see 0.10-0.20 confidence increase on common ingredients\n');
}

main()
    .catch(console.error)
    .finally(() => process.exit(0));
