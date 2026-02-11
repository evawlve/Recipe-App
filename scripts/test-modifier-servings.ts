#!/usr/bin/env ts-node
/**
 * Test script for modifier-aware serving generation
 * Verifies that the system correctly handles prep modifiers like cubed, minced, sliced
 */

import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { extractPrepModifier, detectFoodCategory, CATEGORY_PREEMPTIVE_SERVINGS } from '../src/lib/fatsecret/preemptive-backfill';
import { prisma } from '../src/lib/db';

interface TestCase {
    rawLine: string;
    expectedModifier?: string;
    expectedCategory?: string;
}

const TEST_CASES: TestCase[] = [
    // Produce with various modifiers
    { rawLine: '1 cup cubed apple', expectedModifier: 'cubed', expectedCategory: 'produce' },
    { rawLine: '2 cups diced potatoes', expectedModifier: 'diced', expectedCategory: 'produce' },
    { rawLine: '1/2 cup sliced carrots', expectedModifier: 'sliced', expectedCategory: 'produce' },
    { rawLine: '1 cup chopped tomatoes', expectedModifier: 'chopped', expectedCategory: 'produce' },
    
    // Aromatics with minced
    { rawLine: '2 tbsp minced garlic', expectedModifier: 'minced', expectedCategory: 'aromatics' },
    { rawLine: '1 tbsp minced ginger', expectedModifier: 'minced', expectedCategory: 'aromatics' },
    { rawLine: '1/4 cup chopped onion', expectedModifier: 'chopped', expectedCategory: 'aromatics' },
    
    // Cheese with shredded/grated
    { rawLine: '1 cup shredded cheddar cheese', expectedModifier: 'shredded', expectedCategory: 'cheese' },
    { rawLine: '2 tbsp grated parmesan', expectedModifier: 'grated', expectedCategory: 'cheese' },
    
    // Greens
    { rawLine: '2 cups chopped spinach', expectedModifier: 'chopped', expectedCategory: 'greens' },
    { rawLine: '1 cup packed kale', expectedModifier: 'packed', expectedCategory: 'greens' },
    
    // No modifier - should still work
    { rawLine: '1 cup milk', expectedModifier: undefined, expectedCategory: 'liquids' },
    { rawLine: '2 eggs', expectedModifier: undefined, expectedCategory: undefined },
];

async function runTests() {
    console.log('\n🧪 Testing Modifier-Aware Serving System\n');
    console.log('=' .repeat(80));
    
    // Test 1: Modifier extraction
    console.log('\n📋 Test 1: Prep Modifier Extraction\n');
    let extractPassed = 0;
    for (const test of TEST_CASES) {
        const modifier = extractPrepModifier(test.rawLine);
        const passed = modifier === test.expectedModifier;
        const status = passed ? '✅' : '❌';
        console.log(`${status} "${test.rawLine}"`);
        console.log(`   Expected: ${test.expectedModifier ?? 'none'}, Got: ${modifier ?? 'none'}`);
        if (passed) extractPassed++;
    }
    console.log(`\n   Results: ${extractPassed}/${TEST_CASES.length} passed`);
    
    // Test 2: Category detection
    console.log('\n📋 Test 2: Food Category Detection\n');
    let categoryPassed = 0;
    for (const test of TEST_CASES) {
        // Extract just the food name (simplified)
        const foodName = test.rawLine.replace(/^\d+\/?\.?\d*\s*(cup|cups|tbsp|tsp|oz|lb|g)?\s*/, '').replace(/\b(cubed|diced|sliced|chopped|minced|grated|shredded|packed)\b\s*/gi, '').trim();
        const category = detectFoodCategory(foodName);
        const passed = category === test.expectedCategory;
        const status = passed ? '✅' : '❌';
        console.log(`${status} "${foodName}"`);
        console.log(`   Expected: ${test.expectedCategory ?? 'none'}, Got: ${category ?? 'none'}`);
        if (passed) categoryPassed++;
    }
    console.log(`\n   Results: ${categoryPassed}/${TEST_CASES.length} passed`);
    
    // Test 3: Full mapping pipeline with modifiers (sample 3 ingredients)
    console.log('\n📋 Test 3: Full Mapping Pipeline (sampling 3 ingredients)\n');
    const sampleTests = TEST_CASES.filter(t => t.expectedModifier).slice(0, 3);
    
    for (const test of sampleTests) {
        console.log(`\n🔍 Mapping: "${test.rawLine}"`);
        try {
            const result = await mapIngredientWithFallback(test.rawLine);
            if (result && 'foodName' in result) {
                console.log(`   ✅ Mapped to: ${result.foodName}`);
                console.log(`   📊 Grams: ${result.grams?.toFixed(1)}, Calories: ${result.kcal?.toFixed(1)}`);
                console.log(`   🎯 Confidence: ${(result.confidence * 100).toFixed(0)}%`);
                console.log(`   📌 Source: ${result.source}`);
            } else if (result && 'status' in result) {
                console.log(`   ⏳ Pending: ${result.reason}`);
            } else {
                console.log(`   ❌ No mapping found`);
            }
        } catch (error) {
            console.log(`   ❌ Error: ${(error as Error).message}`);
        }
    }
    
    // Test 4: Check FDC serving cache for new fields
    console.log('\n📋 Test 4: FDC Serving Cache Schema Verification\n');
    const fdcServings = await prisma.fdcServingCache.findMany({
        take: 5,
        where: { isAiEstimated: true },
        select: {
            id: true,
            description: true,
            grams: true,
            volumeMl: true,
            derivedViaDensity: true,
            densityGml: true,
            prepModifier: true,
            confidence: true,
        }
    });
    
    if (fdcServings.length > 0) {
        console.log(`   Found ${fdcServings.length} AI-estimated FDC servings:`);
        for (const s of fdcServings) {
            console.log(`   - "${s.description}": ${s.grams}g, volumeMl=${s.volumeMl}, density=${s.densityGml}, modifier=${s.prepModifier}`);
        }
    } else {
        console.log('   ℹ️  No AI-estimated FDC servings found yet (will be created during mapping)');
    }
    
    // Test 5: Check FatSecret serving cache for modifier servings
    console.log('\n📋 Test 5: FatSecret Serving Cache with Modifiers\n');
    const fsServings = await prisma.fatSecretServingCache.findMany({
        take: 10,
        where: {
            source: 'ai',
            measurementDescription: {
                contains: 'cup',
            }
        },
        select: {
            id: true,
            measurementDescription: true,
            servingWeightGrams: true,
            volumeMl: true,
            derivedViaDensity: true,
            confidence: true,
            food: {
                select: { name: true }
            }
        }
    });
    
    if (fsServings.length > 0) {
        console.log(`   Found ${fsServings.length} AI-estimated FatSecret cup servings:`);
        for (const s of fsServings) {
            console.log(`   - ${s.food.name}: "${s.measurementDescription}" = ${s.servingWeightGrams}g`);
        }
    } else {
        console.log('   ℹ️  No AI-estimated cup servings found yet');
    }
    
    console.log('\n' + '=' .repeat(80));
    console.log('✅ Test suite completed!\n');
    
    await prisma.$disconnect();
}

runTests().catch(console.error);

