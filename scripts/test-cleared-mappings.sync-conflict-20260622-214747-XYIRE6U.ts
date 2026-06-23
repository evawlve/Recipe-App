#!/usr/bin/env ts-node
/**
 * Test script to verify all cleared bad cache entries are now mapping correctly
 * Tests: ice cubes, wine fl oz, coconut flakes, egg replacer, light cream cheese, 
 *        cherry tomatoes, black olives, sun-dried tomatoes, lentils, kalamata olives
 */

import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { prisma } from '../src/lib/db';

interface TestCase {
    input: string;
    expectNotContains?: string[];
    expectContains?: string[];
    maxCaloriesPer100g?: number;
    minCaloriesPer100g?: number;
    maxFatPer100g?: number;
    reason: string;
}

const testCases: TestCase[] = [
    // Ice cubes - should NOT map to Ice Breakers candy
    { input: '6 ice cubes', expectNotContains: ['ice breakers', 'mints', 'gum'], maxCaloriesPer100g: 10, reason: 'ice should have ~0 calories' },
    { input: '1 cup ice', expectNotContains: ['ice breakers', 'mints', 'gum'], maxCaloriesPer100g: 10, reason: 'ice should have ~0 calories' },

    // Wine - fl oz unit extraction fix
    { input: '5 fl oz wine', minCaloriesPer100g: 50, maxCaloriesPer100g: 150, reason: 'wine ~80-100 kcal per 100ml' },
    { input: '5 fl oz red wine', minCaloriesPer100g: 50, maxCaloriesPer100g: 150, reason: 'red wine ~85 kcal per 100ml' },

    // Coconut flakes - should NOT have microscopic tbsp values
    { input: '3 tbsp coconut flakes', minCaloriesPer100g: 400, reason: 'coconut flakes ~600 kcal/100g' },
    { input: '1 cup shredded coconut', minCaloriesPer100g: 400, reason: 'shredded coconut ~650 kcal/100g' },

    // Egg replacer - should NOT map to real eggs
    { input: '1 tbsp vegetarian egg replacer', expectNotContains: ['egg, whole', 'whole egg, raw'], reason: 'egg replacer should map to substitute' },
    { input: '2 tbsp egg substitute', expectNotContains: ['egg, whole'], reason: 'egg substitute should map to liquid substitute' },

    // Light cream cheese - should map to light/reduced fat version
    { input: '2 tbsp light cream cheese', maxFatPer100g: 20, reason: 'light cream cheese ~15-18g fat vs regular ~35g' },
    { input: '1 oz reduced fat cream cheese', maxFatPer100g: 20, reason: 'reduced fat cream cheese should be lower fat' },

    // Cherry tomatoes
    { input: '1 cup cherry tomatoes', expectContains: ['tomato', 'cherry'], minCaloriesPer100g: 15, maxCaloriesPer100g: 30, reason: 'cherry tomatoes ~18 kcal/100g' },

    // Black olives
    { input: '10 black olives', expectContains: ['olive'], minCaloriesPer100g: 100, maxCaloriesPer100g: 200, reason: 'black olives ~115-145 kcal/100g' },

    // Kalamata olives
    { input: '5 kalamata olives', expectContains: ['olive', 'kalamata'], minCaloriesPer100g: 100, maxCaloriesPer100g: 250, reason: 'kalamata olives ~145 kcal/100g' },

    // Lentils - should NOT have high fat
    { input: '2 cups lentils', expectContains: ['lentil'], maxFatPer100g: 3, reason: 'lentils ~1g fat/100g, not restaurant-prepared' },

    // Sun-dried tomatoes
    { input: '0.25 cup sun-dried tomatoes', expectContains: ['tomato', 'sun'], minCaloriesPer100g: 200, maxCaloriesPer100g: 300, reason: 'sun-dried tomatoes ~258 kcal/100g' },

    // Rice wine vinegar
    { input: '2 tbsp rice wine vinegar', expectContains: ['vinegar'], minCaloriesPer100g: 10, maxCaloriesPer100g: 50, reason: 'rice wine vinegar ~18 kcal/100g' },

    // Mozzarella part-skim
    { input: '1 cup part-skim mozzarella', expectContains: ['mozzarella'], maxFatPer100g: 20, reason: 'part-skim mozzarella ~15g fat vs whole ~22g' },
];

async function main() {
    console.log('\n🧪 Testing Cleared Bad Mappings\n');
    console.log('='.repeat(80) + '\n');

    let passed = 0;
    let failed = 0;
    const failures: string[] = [];

    for (const test of testCases) {
        console.log(`\n📝 Testing: "${test.input}"`);
        console.log(`   Reason: ${test.reason}`);

        try {
            const result = await mapIngredientWithFallback(test.input, {});

            if (!result) {
                console.log('   ❌ FAILED: No mapping result');
                failed++;
                failures.push(`${test.input}: No mapping result`);
                continue;
            }

            const foodName = result.foodName?.toLowerCase() || '';
            const nutrition = result.nutritionPer100g;
            let testPassed = true;
            const issues: string[] = [];

            // Check expectNotContains
            if (test.expectNotContains) {
                for (const bad of test.expectNotContains) {
                    if (foodName.includes(bad.toLowerCase())) {
                        issues.push(`Food name contains forbidden "${bad}"`);
                        testPassed = false;
                    }
                }
            }

            // Check expectContains
            if (test.expectContains) {
                const missing = test.expectContains.filter(good => !foodName.includes(good.toLowerCase()));
                if (missing.length > 0) {
                    issues.push(`Food name missing expected: ${missing.join(', ')}`);
                    testPassed = false;
                }
            }

            // Check calorie bounds
            if (nutrition) {
                if (test.maxCaloriesPer100g !== undefined && nutrition.calories > test.maxCaloriesPer100g) {
                    issues.push(`Calories too high: ${nutrition.calories} > ${test.maxCaloriesPer100g}`);
                    testPassed = false;
                }
                if (test.minCaloriesPer100g !== undefined && nutrition.calories < test.minCaloriesPer100g) {
                    issues.push(`Calories too low: ${nutrition.calories} < ${test.minCaloriesPer100g}`);
                    testPassed = false;
                }
                if (test.maxFatPer100g !== undefined && nutrition.fat > test.maxFatPer100g) {
                    issues.push(`Fat too high: ${nutrition.fat}g > ${test.maxFatPer100g}g`);
                    testPassed = false;
                }
            }

            if (testPassed) {
                console.log(`   ✅ PASSED → "${result.foodName}"`);
                if (nutrition) {
                    console.log(`      📊 Nutrition/100g: ${nutrition.calories}kcal | F:${nutrition.fat}g`);
                }
                passed++;
            } else {
                console.log(`   ❌ FAILED → "${result.foodName}"`);
                if (nutrition) {
                    console.log(`      📊 Nutrition/100g: ${nutrition.calories}kcal | F:${nutrition.fat}g`);
                }
                for (const issue of issues) {
                    console.log(`      ⚠️  ${issue}`);
                }
                failed++;
                failures.push(`${test.input}: ${issues.join('; ')}`);
            }
        } catch (error) {
            console.log(`   ❌ ERROR: ${error}`);
            failed++;
            failures.push(`${test.input}: Exception - ${error}`);
        }
    }

    console.log('\n' + '='.repeat(80));
    console.log(`\n📊 Results: ${passed}/${testCases.length} passed, ${failed} failed\n`);

    if (failures.length > 0) {
        console.log('❌ Failures:');
        for (const f of failures) {
            console.log(`   - ${f}`);
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
