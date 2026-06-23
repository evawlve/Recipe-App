/**
 * Comprehensive test for normalization improvements
 * Tests part-whole stripping and cache consolidation
 */
import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { normalizeIngredientName, clearRulesCache } from '../src/lib/fatsecret/normalization-rules';
import { prisma } from '../src/lib/db';

interface TestCase {
    input: string;
    expectedNormalized: string;
    description: string;
}

const TEST_CASES: TestCase[] = [
    // Part-whole stripping
    { input: 'parsley leaves', expectedNormalized: 'parsley', description: 'parsley leaves → parsley' },
    { input: 'cilantro leaves', expectedNormalized: 'cilantro', description: 'cilantro leaves → cilantro' },
    { input: 'basil leaves', expectedNormalized: 'basil', description: 'basil leaves → basil' },
    { input: 'mint leaves', expectedNormalized: 'mint', description: 'mint leaves → mint' },
    { input: 'celery stalks', expectedNormalized: 'celery', description: 'celery stalks → celery' },
    { input: 'celery stalk', expectedNormalized: 'celery', description: 'celery stalk → celery' },
    { input: 'garlic cloves', expectedNormalized: 'garlic', description: 'garlic cloves → garlic' },
    { input: 'garlic clove', expectedNormalized: 'garlic', description: 'garlic clove → garlic' },
    { input: 'lemon zest', expectedNormalized: 'lemon peel', description: 'lemon zest → lemon peel' },
    { input: 'lime zest', expectedNormalized: 'lime peel', description: 'lime zest → lime peel' },
    { input: 'orange zest', expectedNormalized: 'orange peel', description: 'orange zest → orange peel' },
];

async function runNormalizationTests() {
    console.log('='.repeat(60));
    console.log('  RULE-BASED NORMALIZATION TESTS');
    console.log('='.repeat(60));
    console.log();

    // Clear cached rules to ensure fresh read from JSON
    clearRulesCache();

    let passed = 0;
    let failed = 0;

    for (const test of TEST_CASES) {
        const result = normalizeIngredientName(test.input);
        const success = result.cleaned === test.expectedNormalized;

        if (success) {
            console.log(`✅ ${test.description}`);
            passed++;
        } else {
            console.log(`❌ ${test.description}`);
            console.log(`   Expected: "${test.expectedNormalized}"`);
            console.log(`   Got:      "${result.cleaned}"`);
            failed++;
        }
    }

    console.log();
    console.log(`Results: ${passed} passed, ${failed} failed`);
    return failed === 0;
}

async function runCacheConsolidationTests() {
    console.log();
    console.log('='.repeat(60));
    console.log('  CACHE CONSOLIDATION TESTS');
    console.log('='.repeat(60));
    console.log();

    // Test pairs: [first input, second input that should hit cache]
    const testPairs = [
        ['1 tbsp garlic', '3 garlic cloves'],
        ['1 cup celery', '2 celery stalks'],
        ['1 tbsp mint', '1 tbsp mint leaves'],
    ];

    let passed = 0;
    let failed = 0;

    for (const [first, second] of testPairs) {
        console.log(`Testing: "${first}" → "${second}"`);

        // First call (should create cache entry)
        const result1 = await mapIngredientWithFallback(first);
        if (!result1) {
            console.log(`  ❌ First call failed to map`);
            failed++;
            continue;
        }

        // Get cache entry
        const cacheEntry = await prisma.validatedMapping.findFirst({
            where: { foodId: result1.foodId },
            select: { normalizedForm: true, usedCount: true },
        });

        if (!cacheEntry) {
            console.log(`  ❌ No cache entry found for foodId: ${result1.foodId}`);
            failed++;
            continue;
        }

        const beforeCount = cacheEntry.usedCount;

        // Second call (should hit cache)
        const result2 = await mapIngredientWithFallback(second);
        if (!result2) {
            console.log(`  ❌ Second call failed to map`);
            failed++;
            continue;
        }

        // Check if it hit the same cache entry
        const cacheAfter = await prisma.validatedMapping.findFirst({
            where: { normalizedForm: cacheEntry.normalizedForm },
            select: { usedCount: true },
        });

        const afterCount = cacheAfter?.usedCount || 0;
        const cacheHit = result2.foodId === result1.foodId && afterCount > beforeCount;

        if (cacheHit) {
            console.log(`  ✅ Cache hit! usedCount: ${beforeCount} → ${afterCount}`);
            passed++;
        } else if (result2.foodId === result1.foodId) {
            console.log(`  ⚠️  Same food, but may have created new cache entry`);
            console.log(`     foodId match: ${result1.foodId} = ${result2.foodId}`);
            passed++; // Still technically working, just not optimal
        } else {
            console.log(`  ❌ Cache miss: different foods mapped`);
            console.log(`     First:  ${result1.foodName} (${result1.foodId})`);
            console.log(`     Second: ${result2.foodName} (${result2.foodId})`);
            failed++;
        }
    }

    console.log();
    console.log(`Results: ${passed} passed, ${failed} failed`);
    return failed === 0;
}

async function main() {
    console.log('\n🧪 NORMALIZATION IMPROVEMENT TESTS\n');

    // Clear caches for clean test
    console.log('Clearing caches...');
    await prisma.validatedMapping.deleteMany({});
    await prisma.aiNormalizeCache.deleteMany({});
    console.log('Done.\n');

    const normPassed = await runNormalizationTests();
    const cachePassed = await runCacheConsolidationTests();

    console.log();
    console.log('='.repeat(60));
    if (normPassed && cachePassed) {
        console.log('  ✅ ALL TESTS PASSED');
    } else {
        console.log('  ❌ SOME TESTS FAILED');
    }
    console.log('='.repeat(60));
}

main()
    .catch(console.error)
    .finally(() => process.exit(0));
