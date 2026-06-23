/**
 * Tests for Dynamic Plural Matching and Canonical Base Validation
 * 
 * These tests verify:
 * 1. Dynamic singular/plural token matching works correctly
 * 2. Canonical base preserves nutritionally-significant modifiers
 * 3. No cache collisions between different nutrition profiles
 */

import { aiNormalizeIngredient } from '../src/lib/fatsecret/ai-normalize';
import { prisma } from '../src/lib/db';

// ============================================================
// Test Configuration
// ============================================================

interface TestCase {
    input: string;
    expectedNormalizedName: string;
    expectedCanonicalBase: string;
    shouldMatchCanonicalOf?: string;  // Should this share canonical base with another?
    shouldNotMatchCanonicalOf?: string;  // Should this have DIFFERENT canonical base?
    description: string;
}

// ============================================================
// Test Cases
// ============================================================

// 1. PLURAL MATCHING TESTS
// These should all share the same canonical base
const PLURAL_MATCHING_CASES: TestCase[] = [
    {
        input: '2 cup strawberry halves',
        expectedNormalizedName: 'strawberry halves',
        expectedCanonicalBase: 'strawberries',
        description: 'Singular + prep phrase → plural base',
    },
    {
        input: '1 cup strawberries',
        expectedNormalizedName: 'strawberries',
        expectedCanonicalBase: 'strawberries',
        shouldMatchCanonicalOf: '2 cup strawberry halves',
        description: 'Already plural → same base',
    },
    {
        input: '3 eggs',
        expectedNormalizedName: 'eggs',
        expectedCanonicalBase: 'eggs',
        description: 'Plural form preserved',
    },
    {
        input: '1 large egg',
        expectedNormalizedName: 'egg',
        expectedCanonicalBase: 'eggs',
        shouldMatchCanonicalOf: '3 eggs',
        description: 'Singular egg → eggs base',
    },
    {
        input: '2 tomatoes diced',
        expectedNormalizedName: 'tomatoes',
        expectedCanonicalBase: 'tomatoes',
        description: 'Prep phrase stripped',
    },
    {
        input: '1 medium tomato',
        expectedNormalizedName: 'tomato',
        expectedCanonicalBase: 'tomatoes',
        shouldMatchCanonicalOf: '2 tomatoes diced',
        description: 'Singular tomato → tomatoes base',
    },
];

// 2. NUTRITIONALLY-SIGNIFICANT MODIFIERS
// These MUST NOT share canonical base - they have different nutrition profiles
const NUTRITION_MODIFIER_CASES: TestCase[] = [
    {
        input: '2 chicken thighs',
        expectedNormalizedName: 'chicken thighs',
        expectedCanonicalBase: 'chicken thighs',
        description: 'Base chicken thigh (with skin)',
    },
    {
        input: '2 skinless chicken thighs',
        expectedNormalizedName: 'skinless chicken thighs',
        expectedCanonicalBase: 'skinless chicken thighs',
        shouldNotMatchCanonicalOf: '2 chicken thighs',
        description: 'Skinless = different fat content, MUST be separate',
    },
    {
        input: '1 cup whole milk',
        expectedNormalizedName: 'whole milk',
        expectedCanonicalBase: 'whole milk',
        description: 'Whole milk base',
    },
    {
        input: '1 cup skim milk',
        expectedNormalizedName: 'skim milk',
        expectedCanonicalBase: 'skim milk',
        shouldNotMatchCanonicalOf: '1 cup whole milk',
        description: 'Skim milk = very different fat, MUST be separate',
    },
    {
        input: '1 cup 2% milk',
        expectedNormalizedName: '2% milk',
        expectedCanonicalBase: '2% milk',
        shouldNotMatchCanonicalOf: '1 cup whole milk',
        description: '2% milk = different fat %, MUST be separate',
    },
    {
        input: '100g ground beef 85% lean',
        expectedNormalizedName: 'ground beef 85% lean',
        expectedCanonicalBase: 'ground beef 85% lean',
        description: '85% lean ground beef',
    },
    {
        input: '100g ground beef',
        expectedNormalizedName: 'ground beef',
        expectedCanonicalBase: 'ground beef',
        shouldNotMatchCanonicalOf: '100g ground beef 85% lean',
        description: 'Generic ground beef (could be 70/30), MUST be separate',
    },
    {
        input: '1 cup reduced fat cheddar cheese',
        expectedNormalizedName: 'reduced fat cheddar cheese',
        expectedCanonicalBase: 'reduced fat cheddar cheese',
        description: 'Reduced fat cheese',
    },
    {
        input: '1 cup cheddar cheese',
        expectedNormalizedName: 'cheddar cheese',
        expectedCanonicalBase: 'cheddar cheese',
        shouldNotMatchCanonicalOf: '1 cup reduced fat cheddar cheese',
        description: 'Full-fat cheddar, MUST be separate',
    },
];

// 3. PREP PHRASES THAT SHOULD BE STRIPPED
// These CAN share canonical base - prep doesn't affect nutrition significantly
const PREP_PHRASE_CASES: TestCase[] = [
    {
        input: '1 cup diced onion',
        expectedNormalizedName: 'onion',
        expectedCanonicalBase: 'onions',
        description: 'Diced is prep, should be stripped',
    },
    {
        input: '1 cup chopped onion',
        expectedNormalizedName: 'onion',
        expectedCanonicalBase: 'onions',
        shouldMatchCanonicalOf: '1 cup diced onion',
        description: 'Chopped is prep, same base as diced',
    },
    {
        input: '2 cups sliced mushrooms',
        expectedNormalizedName: 'mushrooms',
        expectedCanonicalBase: 'mushrooms',
        description: 'Sliced is prep',
    },
    {
        input: '1 cup fresh basil leaves',
        expectedNormalizedName: 'basil',
        expectedCanonicalBase: 'basil',
        description: 'Fresh + leaves stripped',
    },
];

// 4. PROCESSED VS RAW - DIFFERENT PRODUCTS
const PROCESSED_PRODUCT_CASES: TestCase[] = [
    {
        input: '1 cup strawberry smoothie',
        expectedNormalizedName: 'strawberry smoothie',
        expectedCanonicalBase: 'strawberry smoothie',
        shouldNotMatchCanonicalOf: '2 cup strawberry halves',
        description: 'Smoothie is a processed product, NOT raw strawberries',
    },
    {
        input: '1 tbsp garlic powder',
        expectedNormalizedName: 'garlic powder',
        expectedCanonicalBase: 'garlic powder',
        description: 'Garlic powder is a different product',
    },
    {
        input: '2 cloves garlic',
        expectedNormalizedName: 'garlic',
        expectedCanonicalBase: 'garlic',
        shouldNotMatchCanonicalOf: '1 tbsp garlic powder',
        description: 'Fresh garlic, NOT same as powder',
    },
];

// ============================================================
// Test Runner
// ============================================================

async function runTests() {
    console.log('\n' + '='.repeat(70));
    console.log('  CACHE NORMALIZATION TESTS');
    console.log('='.repeat(70) + '\n');

    const allCases = [
        { name: '1. PLURAL MATCHING', cases: PLURAL_MATCHING_CASES },
        { name: '2. NUTRITIONAL MODIFIERS', cases: NUTRITION_MODIFIER_CASES },
        { name: '3. PREP PHRASE STRIPPING', cases: PREP_PHRASE_CASES },
        { name: '4. PROCESSED VS RAW', cases: PROCESSED_PRODUCT_CASES },
    ];

    let totalPassed = 0;
    let totalFailed = 0;
    const failures: Array<{ test: string; expected: string; actual: string; reason: string }> = [];

    // Collect all results first
    const results: Map<string, { normalizedName: string; canonicalBase: string }> = new Map();

    for (const group of allCases) {
        console.log(`\n--- ${group.name} ---\n`);

        for (const testCase of group.cases) {
            process.stdout.write(`  Testing: "${testCase.input.substring(0, 40)}..." `);

            try {
                // Clear cache for this input to force fresh AI call
                await prisma.aiNormalizeCache.deleteMany({
                    where: { rawLine: testCase.input },
                });

                const result = await aiNormalizeIngredient(testCase.input);

                if (result.status !== 'success') {
                    console.log('❌ FAILED (AI error)');
                    failures.push({
                        test: testCase.input,
                        expected: 'success',
                        actual: result.reason,
                        reason: 'AI normalization failed',
                    });
                    totalFailed++;
                    continue;
                }

                results.set(testCase.input, {
                    normalizedName: result.normalizedName,
                    canonicalBase: result.canonicalBase,
                });

                // Log the result
                console.log(`✓`);
                console.log(`    normalized: "${result.normalizedName}"`);
                console.log(`    canonical:  "${result.canonicalBase}"`);

                // Basic validation
                if (result.canonicalBase.length === 0) {
                    console.log('    ⚠️  Empty canonical base!');
                    failures.push({
                        test: testCase.input,
                        expected: 'non-empty canonical base',
                        actual: 'empty',
                        reason: 'Canonical base should not be empty',
                    });
                    totalFailed++;
                } else {
                    totalPassed++;
                }

            } catch (error) {
                console.log('❌ ERROR');
                failures.push({
                    test: testCase.input,
                    expected: 'success',
                    actual: (error as Error).message,
                    reason: 'Exception thrown',
                });
                totalFailed++;
            }
        }
    }

    // Cross-check: verify shouldMatchCanonicalOf and shouldNotMatchCanonicalOf
    console.log('\n--- CROSS-VALIDATION ---\n');

    for (const group of allCases) {
        for (const testCase of group.cases) {
            const thisResult = results.get(testCase.input);
            if (!thisResult) continue;

            // Should MATCH
            if (testCase.shouldMatchCanonicalOf) {
                const otherResult = results.get(testCase.shouldMatchCanonicalOf);
                if (otherResult) {
                    if (thisResult.canonicalBase.toLowerCase() === otherResult.canonicalBase.toLowerCase()) {
                        console.log(`  ✓ "${testCase.input.substring(0, 30)}..." matches "${testCase.shouldMatchCanonicalOf.substring(0, 30)}..."`);
                        console.log(`    Both use: "${thisResult.canonicalBase}"`);
                    } else {
                        console.log(`  ❌ MISMATCH: "${testCase.input.substring(0, 30)}..."`);
                        console.log(`    Expected to match: "${testCase.shouldMatchCanonicalOf.substring(0, 30)}..."`);
                        console.log(`    This canonical: "${thisResult.canonicalBase}"`);
                        console.log(`    Other canonical: "${otherResult.canonicalBase}"`);
                        failures.push({
                            test: testCase.input,
                            expected: `canonical "${otherResult.canonicalBase}"`,
                            actual: `canonical "${thisResult.canonicalBase}"`,
                            reason: `Should match ${testCase.shouldMatchCanonicalOf}`,
                        });
                        totalFailed++;
                        totalPassed--;  // Revert the earlier pass
                    }
                }
            }

            // Should NOT MATCH
            if (testCase.shouldNotMatchCanonicalOf) {
                const otherResult = results.get(testCase.shouldNotMatchCanonicalOf);
                if (otherResult) {
                    if (thisResult.canonicalBase.toLowerCase() !== otherResult.canonicalBase.toLowerCase()) {
                        console.log(`  ✓ "${testCase.input.substring(0, 30)}..." correctly DIFFERS from "${testCase.shouldNotMatchCanonicalOf.substring(0, 30)}..."`);
                        console.log(`    This: "${thisResult.canonicalBase}" ≠ Other: "${otherResult.canonicalBase}"`);
                    } else {
                        console.log(`  ❌ COLLISION: "${testCase.input.substring(0, 30)}..."`);
                        console.log(`    Should NOT match: "${testCase.shouldNotMatchCanonicalOf.substring(0, 30)}..."`);
                        console.log(`    BOTH use: "${thisResult.canonicalBase}" - THIS IS WRONG!`);
                        failures.push({
                            test: testCase.input,
                            expected: `different canonical from "${otherResult.canonicalBase}"`,
                            actual: `SAME canonical "${thisResult.canonicalBase}"`,
                            reason: `Nutritional collision with ${testCase.shouldNotMatchCanonicalOf}`,
                        });
                        totalFailed++;
                        totalPassed--;  // Revert the earlier pass
                    }
                }
            }
        }
    }

    // Summary
    console.log('\n' + '='.repeat(70));
    console.log('  SUMMARY');
    console.log('='.repeat(70));
    console.log(`  Passed: ${totalPassed}`);
    console.log(`  Failed: ${totalFailed}`);

    if (failures.length > 0) {
        console.log('\n  FAILURES:');
        for (const f of failures) {
            console.log(`    - ${f.test}`);
            console.log(`      Reason: ${f.reason}`);
            console.log(`      Expected: ${f.expected}`);
            console.log(`      Actual: ${f.actual}`);
        }
    }

    console.log('='.repeat(70) + '\n');

    await prisma.$disconnect();
    process.exit(totalFailed > 0 ? 1 : 0);
}

runTests().catch(console.error);
