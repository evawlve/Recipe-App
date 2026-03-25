/**
 * Debug Reported Failures Script
 * 
 * Tests all the specific failing cases reported by the user to check
 * which ones are now fixed and which still need attention.
 * 
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/debug-reported-failures.ts
 *   
 *   With --no-cache to bypass cached mappings:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/debug-reported-failures.ts --no-cache
 */

import 'dotenv/config';

interface TestCase {
    input: string;
    category: string;
    description: string;
    /** What the bad mapping was (for reference) */
    badMapping?: string;
    /** What pattern we expect the result to match or NOT match */
    shouldNotContain?: string[];
    /** Keywords the result SHOULD contain */
    shouldContain?: string[];
    /** Max reasonable kcal for the result */
    maxKcal?: number;
    /** Max reasonable grams */
    maxGrams?: number;
    /** Min reasonable grams */
    minGrams?: number;
}

const TEST_CASES: TestCase[] = [
    // ========================================
    // Category 1: Category Mismatches / Bad Product Mappings
    // ========================================
    {
        input: 'Blood Orange Zest',
        category: 'Category Mismatch',
        description: 'Should map to orange zest/peel, NOT frozen chicken dinner or chocolate',
        badMapping: 'ORANGE ZEST CHICKEN (HEALTHY CHOICE)',
        shouldNotContain: ['chicken', 'healthy choice', 'cocoa', 'chocolate'],
        shouldContain: ['orange'],
    },
    {
        input: '5 g cinnamon sticks 2',
        category: 'Category Mismatch',
        description: 'Should map to cinnamon spice, NOT Pizza Hut icing',
        badMapping: 'Cinnamon Sticks White Icing Dipping Cup (Pizza Hut)',
        shouldNotContain: ['icing', 'pizza hut', 'dipping'],
        shouldContain: ['cinnamon'],
    },
    {
        input: '0.25 tsp garlic & herb seasoning blend',
        category: 'Category Mismatch',
        description: 'Should map to a spice blend, NOT a boxed quinoa/rice side dish',
        badMapping: 'garlic & herb quinoa blend rice & seasoning mix (LUNDBERG)',
        shouldNotContain: ['quinoa', 'rice mix', 'lundberg'],
        // Note: generic "Seasoning Blend" is nutritionally equivalent for 0.25 tsp
    },
    {
        input: '2 large yellow zucchini',
        category: 'Category Mismatch',
        description: 'Should map to fresh zucchini, NOT frozen mixed vegetables',
        badMapping: 'Fresh Frozen Garden Blend Vegetables',
        shouldNotContain: ['blend', 'garden blend', 'mixed vegetables'],
        shouldContain: ['zucchini'],
    },
    {
        input: '1 dash pepper',
        category: 'Category Mismatch',
        description: 'Should map to black pepper (spice), NOT banana pepper (vegetable)',
        badMapping: 'banana raw pepper',
        shouldNotContain: ['banana'],
        shouldContain: ['pepper'],
        maxKcal: 5,  // 1 dash of pepper is trivial calories
    },
    {
        input: 'Tomato and Green Chili Mix',
        category: 'Category Mismatch',
        description: 'Should map to tomato+chili mix (like Rotel), NOT unripe green tomatoes',
        badMapping: 'green raw tomatoes',
        shouldNotContain: ['raw', 'unripe'],
    },

    // ========================================
    // Category 2: Serving/Weight Issues
    // ========================================
    {
        input: '5 dash black pepper',
        category: 'Serving/Weight',
        description: 'Should NOT be 500g/1255kcal (default 100g per dash is wrong)',
        maxGrams: 10,   // 5 dashes should be < 10g
        maxKcal: 30,
    },
    {
        input: '1 dash black pepper',
        category: 'Serving/Weight',
        description: 'Should NOT be 100g/251kcal',
        maxGrams: 2,    // 1 dash is ~0.5g
        maxKcal: 5,
    },
    {
        input: '18 piece greek kalamata olives',
        category: 'Serving/Weight',
        description: 'Should NOT be 1800g/3222kcal (100g per piece), should be ~72g',
        maxGrams: 200,  // 18 olives * ~4-5g each = ~72-90g
        maxKcal: 300,
    },
    {
        input: '14 mango chunks',
        category: 'Serving/Weight',
        description: 'Should NOT be 4704g/3068kcal (14 whole mangos), should be ~168g',
        maxGrams: 500,   // 14 chunks * ~12-20g each = ~168-280g 
        maxKcal: 400,
    },
    {
        input: '25 grape tomatoes',
        category: 'Serving/Weight',
        description: 'Should NOT be 3075g (123g each), should be ~125g',
        maxGrams: 300,   // 25 * ~5g each = ~125g
        maxKcal: 100,
    },
    {
        input: '1 avocado cubed',
        category: 'Serving/Weight',
        description: 'Should NOT be 10g/16kcal - avocado is ~200g',
        minGrams: 100,   // At least 100g for a whole avocado
    },
    {
        input: '1 mini avocado',
        category: 'Serving/Weight',
        description: 'Should NOT be 10g/16kcal - mini avocado is ~100-136g',
        minGrams: 80,    // Even a mini is > 80g
    },

    // ========================================
    // Category 3: Explicit Failures
    // ========================================
    {
        input: '0.5 cup no calorie sweetener',
        category: 'Explicit Failure',
        description: 'Should map to a calorie-free sweetener, not Altern (Great Value)',
        badMapping: 'Altern No Calorie Sweetener (Great Value)',
    },
];

async function main() {
    const noCache = process.argv.includes('--no-cache');
    
    const { mapIngredientWithFallback } = await import('../src/lib/fatsecret/map-ingredient-with-fallback');
    const { FatSecretClient } = await import('../src/lib/fatsecret/client');
    const { prisma } = await import('../src/lib/db');
    
    const client = new FatSecretClient();

    console.log('🔍 Debugging Reported Failures');
    console.log(`   Mode: ${noCache ? 'SKIP CACHE (fresh from API)' : 'WITH CACHE'}`);
    console.log(`   Date: ${new Date().toISOString()}`);
    console.log('');

    if (noCache) {
        // Clear validated mappings for all test cases
        console.log('🗑️  Clearing cached mappings for test ingredients...');
        for (const tc of TEST_CASES) {
            const baseName = tc.input.toLowerCase();
            await prisma.validatedMapping.deleteMany({
                where: {
                    OR: [
                        { rawIngredient: { contains: baseName, mode: 'insensitive' } },
                        { normalizedForm: { contains: baseName.split(' ').slice(-2).join(' '), mode: 'insensitive' } },
                    ]
                }
            });
        }
        console.log('   Done.\n');
    }

    let passed = 0;
    let failed = 0;
    let noResult = 0;
    const failures: { tc: TestCase; result: any; reasons: string[] }[] = [];

    for (const tc of TEST_CASES) {
        console.log(`${'─'.repeat(70)}`);
        console.log(`📝 [${tc.category}] "${tc.input}"`);
        console.log(`   Expected: ${tc.description}`);
        if (tc.badMapping) {
            console.log(`   Was bad:  ${tc.badMapping}`);
        }

        try {
            const result = await mapIngredientWithFallback(tc.input, {
                client,
                debug: true,
                skipCache: noCache,
            });

            if (!result || 'status' in result) {
                console.log(`   ❌ NO RESULT\n`);
                noResult++;
                failures.push({ tc, result: null, reasons: ['No mapping returned'] });
                continue;
            }

            const reasons: string[] = [];

            // Check shouldNotContain
            if (tc.shouldNotContain) {
                for (const term of tc.shouldNotContain) {
                    const fullName = `${result.foodName} ${result.brandName || ''}`.toLowerCase();
                    if (fullName.includes(term.toLowerCase())) {
                        reasons.push(`Contains forbidden term: "${term}" in "${result.foodName} (${result.brandName || ''})"`);
                    }
                }
            }

            // Check shouldContain
            if (tc.shouldContain) {
                for (const term of tc.shouldContain) {
                    const fullName = `${result.foodName} ${result.brandName || ''}`.toLowerCase();
                    if (!fullName.includes(term.toLowerCase())) {
                        reasons.push(`Missing required term: "${term}" in "${result.foodName}"`);
                    }
                }
            }

            // Check maxKcal
            if (tc.maxKcal !== undefined && result.kcal > tc.maxKcal) {
                reasons.push(`kcal too high: ${result.kcal.toFixed(0)} > max ${tc.maxKcal}`);
            }

            // Check maxGrams
            if (tc.maxGrams !== undefined && result.grams > tc.maxGrams) {
                reasons.push(`grams too high: ${result.grams.toFixed(0)}g > max ${tc.maxGrams}g`);
            }

            // Check minGrams
            if (tc.minGrams !== undefined && result.grams < tc.minGrams) {
                reasons.push(`grams too low: ${result.grams.toFixed(0)}g < min ${tc.minGrams}g`);
            }

            if (reasons.length === 0) {
                console.log(`   ✅ PASS: ${result.foodName} (${result.brandName || 'generic'})`);
                console.log(`      ${result.grams.toFixed(1)}g | ${result.kcal.toFixed(0)}kcal | P:${result.protein.toFixed(1)} C:${result.carbs.toFixed(1)} F:${result.fat.toFixed(1)}`);
                console.log(`      Confidence: ${result.confidence.toFixed(3)} | Source: ${result.source}`);
                passed++;
            } else {
                console.log(`   ❌ FAIL: ${result.foodName} (${result.brandName || 'generic'})`);
                console.log(`      ${result.grams.toFixed(1)}g | ${result.kcal.toFixed(0)}kcal | P:${result.protein.toFixed(1)} C:${result.carbs.toFixed(1)} F:${result.fat.toFixed(1)}`);
                console.log(`      Confidence: ${result.confidence.toFixed(3)} | Source: ${result.source}`);
                for (const r of reasons) {
                    console.log(`      ⚠️  ${r}`);
                }
                failed++;
                failures.push({ tc, result, reasons });
            }
        } catch (err) {
            console.log(`   ❌ ERROR: ${(err as Error).message}`);
            failed++;
            failures.push({ tc, result: null, reasons: [(err as Error).message] });
        }

        console.log('');
        // Small delay between API calls
        await new Promise(r => setTimeout(r, 300));
    }

    // Summary
    console.log('═'.repeat(70));
    console.log('📊 SUMMARY');
    console.log('═'.repeat(70));
    console.log(`   Total:     ${TEST_CASES.length}`);
    console.log(`   ✅ Passed:  ${passed}`);
    console.log(`   ❌ Failed:  ${failed}`);
    console.log(`   ⬚ No Result: ${noResult}`);
    console.log('');

    if (failures.length > 0) {
        console.log('🔴 FAILURES REQUIRING ATTENTION:');
        for (const f of failures) {
            console.log(`\n   [${f.tc.category}] "${f.tc.input}"`);
            if (f.result) {
                console.log(`      Mapped to: ${f.result.foodName} (${f.result.grams?.toFixed(0)}g, ${f.result.kcal?.toFixed(0)}kcal)`);
            }
            for (const r of f.reasons) {
                console.log(`      → ${r}`);
            }
        }
    }

    await prisma.$disconnect();
    process.exit(failures.length > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
