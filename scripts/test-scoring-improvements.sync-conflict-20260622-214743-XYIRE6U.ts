#!/usr/bin/env ts-node

import 'dotenv/config';

// Test the scoring improvements
async function testScoringImprovements() {
    console.log('\n🧪 Testing Scoring Improvements\n');

    // Import after dotenv
    const { mapIngredientWithFallback } = await import('../src/lib/fatsecret/map-ingredient-with-fallback');
    const { FatSecretClient } = await import('../src/lib/fatsecret/client');

    const client = new FatSecretClient();

    const testCases = [
        {
            input: '1 cup milk',
            expectedNot: ['nonfat', 'lowfat', 'skim', 'fat free'],
            expectedKeywords: ['milk', 'whole'],
            description: 'Regular milk should NOT map to nonfat/lowfat milk'
        },
        {
            input: '1 cup nonfat milk',
            expectedKeywords: ['nonfat', 'skim', 'fat free'],
            description: 'Nonfat milk should map to nonfat/skim milk'
        },
        {
            input: '1 tsp lemon zest',
            expectedNot: ['cake', 'bar', 'cookie', 'spread', 'cream cheese', 'ravioli'],
            expectedKeywords: ['lemon', 'zest', 'peel'],
            description: 'Lemon zest should NOT map to lemon-flavored products'
        },
        {
            input: '1 tbsp vegetable oil spread',
            expectedNot: ['lowfat', 'light', 'lite', 'reduced fat'],
            expectedKeywords: ['vegetable', 'spread'],
            description: 'Regular oil spread should NOT prefer lowfat versions'
        },
        {
            input: '1 cup unsweetened almond milk',
            expectedKeywords: ['unsweetened', 'almond', 'milk'],
            description: 'Unsweetened almond milk should match unsweetened version'
        },
        {
            input: '1 tsp vanilla extract',
            expectedNot: ['cookie', 'cake', 'bar', 'ice cream'],
            expectedKeywords: ['vanilla', 'extract'],
            description: 'Vanilla extract should NOT map to vanilla-flavored products'
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
                minConfidence: 0.5,
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
                console.log('⚠️  Partial pass');
                passed++;
            }

        } catch (err) {
            console.log(`❌ Error: ${(err as Error).message}`);
            failed++;
        }

        // Rate limiting
        await new Promise(r => setTimeout(r, 200));
    }

    console.log('\n' + '='.repeat(50));
    console.log(`📊 Results: ${passed} passed, ${failed} failed`);
    console.log('='.repeat(50) + '\n');

    process.exit(failed > 0 ? 1 : 0);
}

testScoringImprovements().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
