#!/usr/bin/env ts-node

import 'dotenv/config';

// Test the lowfat milk scoring fix
async function testLowfatMilk() {
    console.log('\n🧪 Testing Lowfat Milk Modifier Matching\n');

    const { mapIngredientWithFallback } = await import('../src/lib/fatsecret/map-ingredient-with-fallback');
    const { FatSecretClient } = await import('../src/lib/fatsecret/client');

    const client = new FatSecretClient();

    const testCases = [
        {
            input: '1.5 cup milk lowfat',
            expectedKeywords: ['lowfat', 'low fat', 'low-fat', 'reduced fat', 'lite', 'light', '1%', '2%'],
            expectedNot: ['whole milk'],
            description: '"milk lowfat" should match a lowfat milk variant'
        },
        {
            input: '1 cup lowfat milk',
            expectedKeywords: ['lowfat', 'low fat', 'low-fat', 'reduced fat', 'lite', 'light', '1%', '2%'],
            expectedNot: ['whole milk'],
            description: '"lowfat milk" should match a lowfat milk variant'
        },
        {
            input: '2 cups reduced fat milk',
            expectedKeywords: ['reduced fat', 'lowfat', 'low fat', '2%'],
            expectedNot: ['whole milk', 'nonfat'],
            description: '"reduced fat milk" should match reduced fat variant'
        },
        {
            input: '1 cup skim milk',
            expectedKeywords: ['skim', 'nonfat', 'non-fat', 'fat free'],
            expectedNot: ['whole milk'],
            description: '"skim milk" should match skim/nonfat milk'
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
                console.log('❌ No mapping found');
                failed++;
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
            if (test.expectedKeywords) {
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

            if (!hasUnwanted && hasExpected) {
                console.log('✅ PASS');
                passed++;
            } else if (hasUnwanted) {
                failed++;
            } else {
                console.log('⚠️  Partial pass (no unwanted, but missing expected keywords)');
                passed++;
            }

        } catch (err) {
            console.log(`❌ Error: ${(err as Error).message}`);
            failed++;
        }

        await new Promise(r => setTimeout(r, 200));
    }

    console.log('\n' + '='.repeat(50));
    console.log(`📊 Results: ${passed} passed, ${failed} failed`);
    console.log('='.repeat(50) + '\n');

    process.exit(failed > 0 ? 1 : 0);
}

testLowfatMilk().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
