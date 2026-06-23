/**
 * Test script to verify cross-reference serving lookup
 * Tests finding "slice" serving weight for capocollo from similar foods
 */

import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { findSimilarServings, tryServingFromSimilarFoods } from '../src/lib/ai/similar-serving-lookup';

async function main() {
    console.log('=== Testing Cross-Reference Serving Lookup ===\n');

    // Test 1: Find similar servings for capocollo "slice"
    console.log('📋 Test 1: Find similar "slice" servings for Capocollo');
    console.log('   Looking for foods with "capocollo" that have slice servings...\n');

    const result = await findSimilarServings('Uncured Capocollo', 'slice', '33949947');

    if (result.found) {
        console.log(`   ✅ Found ${result.matches.length} matches:\n`);
        for (const match of result.matches) {
            console.log(`      - ${match.foodName} (${match.brandName || 'generic'})`);
            console.log(`        "${match.servingDescription}" = ${match.grams}g [${match.source}]`);
        }
        console.log(`\n   📊 Average: ${result.averageGrams?.toFixed(1)}g per slice`);
        console.log(`   🎯 Confidence: ${(result.confidence * 100).toFixed(0)}%`);
    } else {
        console.log('   ❌ No matches found');
    }

    // Test 2: Try the full lookup flow
    console.log('\n---\n');
    console.log('📋 Test 2: Full tryServingFromSimilarFoods flow');

    const fullResult = await tryServingFromSimilarFoods(
        '33949947',
        'Uncured Capocollo',
        'slice',
        0.7
    );

    if (fullResult.success) {
        console.log(`   ✅ SUCCESS! Can use ${fullResult.grams?.toFixed(1)}g per slice`);
        console.log(`   🎯 Confidence: ${(fullResult.confidence! * 100).toFixed(0)}%`);
        console.log(`   📦 Based on ${fullResult.matches?.length} similar foods`);
    } else {
        console.log('   ⚠️ Not enough confidence for direct use');
        if (fullResult.confidence) {
            console.log(`   🎯 Confidence was: ${(fullResult.confidence * 100).toFixed(0)}% (need 70%)`);
        }
        console.log('   → Would fall back to AI');
    }

    // Test 3: Test with a different food
    console.log('\n---\n');
    console.log('📋 Test 3: Find similar "cup" servings for chicken broth');

    const brothResult = await findSimilarServings('chicken broth', 'cup');

    if (brothResult.found) {
        console.log(`   ✅ Found ${brothResult.matches.length} matches:`);
        console.log(`   📊 Average: ${brothResult.averageGrams?.toFixed(1)}g per cup`);
        console.log(`   🎯 Confidence: ${(brothResult.confidence * 100).toFixed(0)}%`);
    } else {
        console.log('   ❌ No matches found');
    }

    console.log('\n=== Done ===');
    await prisma.$disconnect();
}

main().catch(console.error);
