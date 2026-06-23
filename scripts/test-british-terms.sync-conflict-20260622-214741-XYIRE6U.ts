#!/usr/bin/env ts-node

import 'dotenv/config';

// Test British terms and rejection logic
async function testBritishTerms() {
    console.log('\n🇬🇧 Testing British Term Translations\n');

    const { mapIngredientWithFallback } = await import('../src/lib/fatsecret/map-ingredient-with-fallback');
    const { FatSecretClient } = await import('../src/lib/fatsecret/client');

    const client = new FatSecretClient();

    const testCases = [
        {
            input: '1 courgette',
            expectedKeywords: ['zucchini'],
            expectedNot: ['risotto', 'with'],
            description: '"courgette" should map to zucchini, NOT risotto'
        },
        {
            input: '4 oz mange tout',
            expectedKeywords: ['snow peas', 'sugar snap', 'snap peas'],
            expectedNot: [],
            description: '"mange tout" should map to snow peas'
        },
        {
            input: '3 fl oz single cream',
            expectedKeywords: ['cream', 'light cream', 'half and half'],
            expectedNot: ['ice cream'],
            description: '"single cream" should map to light cream, NOT ice cream'
        },
        {
            input: '2 aubergines',
            expectedKeywords: ['eggplant'],
            expectedNot: [],
            description: '"aubergines" should map to eggplant'
        },
        {
            input: '1 bunch coriander',
            expectedKeywords: ['cilantro'],
            expectedNot: [],
            description: '"coriander" should map to cilantro'
        },
        {
            input: '2 tbsp icing sugar',
            expectedKeywords: ['powdered sugar', 'confectioner'],
            expectedNot: [],
            description: '"icing sugar" should map to powdered sugar'
        },
        {
            input: '200g mince',
            expectedKeywords: ['ground beef', 'ground meat', 'beef'],
            expectedNot: [],
            description: '"mince" should map to ground beef'
        },
    ];

    let passed = 0;
    let failed = 0;

    for (const test of testCases) {
        console.log(`\n--- ${test.description} ---`);
        console.log(`Input: "${test.input}"`);

        try {
            const result = await mapIngredientWithFallback(test.input, {
                client,
                minConfidence: 0.3,
                debug: false,
            });

            if (!result) {
                console.log('❌ No mapping found (may be correct if nothing suitable)');
                // Check if this was expected
                if (test.expectedNot.length > 0) {
                    console.log('✅ PASS (correctly rejected bad match)');
                    passed++;
                } else {
                    failed++;
                }
                continue;
            }

            const foodLower = result.foodName.toLowerCase();
            console.log(`Mapped to: ${result.foodName} (confidence: ${result.confidence.toFixed(2)})`);

            // Check for unwanted keywords
            let hasUnwanted = false;
            if (test.expectedNot) {
                for (const bad of test.expectedNot) {
                    if (foodLower.includes(bad.toLowerCase())) {
                        console.log(`❌ FAIL: Contains unwanted keyword "${bad}"`);
                        hasUnwanted = true;
                    }
                }
            }

            // Check for expected keywords (at least one should be present)
            let hasExpected = false;
            if (test.expectedKeywords && test.expectedKeywords.length > 0) {
                for (const good of test.expectedKeywords) {
                    if (foodLower.includes(good.toLowerCase())) {
                        hasExpected = true;
                        console.log(`   ✓ Found expected keyword: "${good}"`);
                        break;
                    }
                }
                if (!hasExpected) {
                    console.log(`⚠️  WARN: Missing expected keywords: ${test.expectedKeywords.join(', ')}`);
                }
            }

            if (!hasUnwanted) {
                console.log('✅ PASS');
                passed++;
            } else {
                failed++;
            }

        } catch (err) {
            console.log(`❌ Error: ${(err as Error).message}`);
            failed++;
        }

        await new Promise(r => setTimeout(r, 300));
    }

    console.log('\n' + '='.repeat(50));
    console.log(`📊 Results: ${passed} passed, ${failed} failed`);
    console.log('='.repeat(50) + '\n');

    process.exit(failed > 0 ? 1 : 0);
}

testBritishTerms().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
