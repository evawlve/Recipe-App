#!/usr/bin/env ts-node
/**
 * Test "Watch For" cases that may still need work
 */

import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { prisma } from '../src/lib/db';

interface TestCase {
    input: string;
    expectNotContains?: string[];
    expectContains?: string[];
    maxCaloriesPer100g?: number;
    maxFatPer100g?: number;
    reason: string;
}

const testCases: TestCase[] = [
    // Graham cracker → Cake issue
    {
        input: '1 cup graham cracker crumbs',
        expectContains: ['graham', 'cracker'],
        expectNotContains: ['cake', 'cheesecake'],
        reason: 'graham cracker should not map to cake'
    },
    {
        input: '2 graham crackers',
        expectContains: ['graham'],
        expectNotContains: ['cake'],
        reason: 'graham crackers should map to actual crackers'
    },

    // Better Than Sour Cream - brand-specific product
    {
        input: '2 tbsp Better Than Sour Cream',
        expectContains: ['sour cream'],
        reason: 'brand should still find sour cream product'
    },

    // Mixed seeds bread → Seeds issue
    {
        input: '1 slice mixed seeds bread',
        expectContains: ['bread'],
        expectNotContains: ['seed'],
        reason: 'mixed seeds bread should map to bread, not seeds'
    },
    {
        input: '2 slices seeded bread',
        expectContains: ['bread'],
        reason: 'seeded bread should map to bread'
    },

    // Low fat yogurt - fat modifier matching
    {
        input: '1 cup low fat yogurt',
        maxFatPer100g: 3,
        reason: 'low fat yogurt should have <3g fat/100g'
    },
    {
        input: '6 oz lowfat vanilla yogurt',
        maxFatPer100g: 4,
        reason: 'lowfat yogurt should be reduced fat'
    },

    // Nonfat Italian dressing - nonfat vs light distinction
    {
        input: '0.25 cup nonfat Italian dressing',
        maxFatPer100g: 1,
        maxCaloriesPer100g: 50,
        reason: 'nonfat dressing should have ~0g fat'
    },
    {
        input: '2 tbsp fat free ranch dressing',
        maxFatPer100g: 1,
        reason: 'fat free ranch should have ~0g fat'
    },

    // Potatoes - should not hit restaurant-prepared (high fat) versions
    {
        input: '4 medium potatoes',
        maxFatPer100g: 1,
        reason: 'raw potatoes have ~0.1g fat'
    },
    {
        input: '2 cups diced potatoes',
        maxFatPer100g: 1,
        reason: 'plain potatoes should not be restaurant-prepared'
    },

    // Lentils - already tested but confirming
    {
        input: '1 cup cooked lentils',
        maxFatPer100g: 2,
        reason: 'cooked lentils should have ~0.4g fat'
    },
];

async function main() {
    console.log('\n🧪 Testing "Watch For" Cases\n');
    console.log('='.repeat(80) + '\n');

    let passed = 0;
    let failed = 0;
    const failures: { input: string; foodName: string; issues: string[] }[] = [];

    for (const test of testCases) {
        console.log(`\n📝 Testing: "${test.input}"`);
        console.log(`   Expected: ${test.reason}`);

        try {
            const result = await mapIngredientWithFallback(test.input, {});

            if (!result) {
                console.log('   ❌ FAILED: No mapping result');
                failed++;
                failures.push({ input: test.input, foodName: 'NO RESULT', issues: ['No mapping result'] });
                continue;
            }

            const foodName = result.foodName?.toLowerCase() || '';
            let testPassed = true;
            const issues: string[] = [];


            // Check expectNotContains
            if (test.expectNotContains) {
                for (const bad of test.expectNotContains) {
                    if (foodName.includes(bad.toLowerCase())) {
                        issues.push(`Name contains forbidden: "${bad}"`);
                        testPassed = false;
                    }
                }
            }

            // Check expectContains
            if (test.expectContains) {
                const missing = test.expectContains.filter(good => !foodName.includes(good.toLowerCase()));
                if (missing.length > 0) {
                    issues.push(`Name missing expected: ${missing.join(', ')}`);
                    testPassed = false;
                }
            }

            // Compute per-100g nutrition from the result
            const grams = result.grams || 100;
            const caloriesPer100g = (result.kcal / grams) * 100;
            const fatPer100g = (result.fat / grams) * 100;

            // Check nutrition bounds
            if (test.maxCaloriesPer100g !== undefined && caloriesPer100g > test.maxCaloriesPer100g) {
                issues.push(`Calories: ${caloriesPer100g.toFixed(0)}/100g > max ${test.maxCaloriesPer100g}`);
                testPassed = false;
            }
            if (test.maxFatPer100g !== undefined && fatPer100g > test.maxFatPer100g) {
                issues.push(`Fat: ${fatPer100g.toFixed(1)}g/100g > max ${test.maxFatPer100g}g`);
                testPassed = false;
            }


            if (testPassed) {
                console.log(`   ✅ PASSED → "${result.foodName}"`);
                console.log(`      📊 ${caloriesPer100g.toFixed(0)}kcal | P:${((result.protein / grams) * 100).toFixed(1)}g C:${((result.carbs / grams) * 100).toFixed(1)}g F:${fatPer100g.toFixed(1)}g per 100g`);
                passed++;
            } else {
                console.log(`   ❌ FAILED → "${result.foodName}"`);
                console.log(`      📊 ${caloriesPer100g.toFixed(0)}kcal | P:${((result.protein / grams) * 100).toFixed(1)}g C:${((result.carbs / grams) * 100).toFixed(1)}g F:${fatPer100g.toFixed(1)}g per 100g`);
                for (const issue of issues) {
                    console.log(`      ⚠️  ${issue}`);
                }
                failed++;
                failures.push({ input: test.input, foodName: result.foodName || '', issues });
            }

        } catch (error) {
            console.log(`   ❌ ERROR: ${error}`);
            failed++;
            failures.push({ input: test.input, foodName: 'ERROR', issues: [`${error}`] });
        }
    }

    console.log('\n' + '='.repeat(80));
    console.log(`\n📊 Results: ${passed}/${testCases.length} passed, ${failed} failed\n`);

    if (failures.length > 0) {
        console.log('\n❌ Failures Summary:\n');
        for (const f of failures) {
            console.log(`   "${f.input}"`);
            console.log(`      → Mapped to: "${f.foodName}"`);
            for (const issue of f.issues) {
                console.log(`      ⚠️  ${issue}`);
            }
            console.log();
        }
    }

    process.exit(failed > 0 ? 1 : 0);
}

main()
    .catch((error) => {
        console.error('Error:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
