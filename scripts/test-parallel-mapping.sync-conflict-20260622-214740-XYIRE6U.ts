/**
 * Test script to verify in-flight locking for parallel ingredient mapping.
 * 
 * This script runs multiple parallel mappings of the same ingredient
 * and verifies they all get the same result.
 * 
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/test-parallel-mapping.ts
 */

import { mapIngredientWithFallback } from '@/lib/fatsecret/map-ingredient-with-fallback';
import { prisma } from '@/lib/db';

async function main() {
    console.log('=== Parallel Mapping Test ===\n');

    // Clear ALL caches for a true cold start
    console.log('🗑️ Clearing caches for cold start test...');
    await prisma.validatedMapping.deleteMany({});
    await prisma.ingredientFoodMap.deleteMany({});
    console.log('✓ Caches cleared\n');

    const testIngredient = '4 1/2 cups quinoa';
    const parallelCount = 5; // Simulate 5 parallel threads mapping the same ingredient

    console.log(`📝 Test ingredient: "${testIngredient}"`);
    console.log(`🔀 Running ${parallelCount} parallel mappings...\n`);

    // Run all mappings in parallel (simulates batch processing)
    const startTime = Date.now();
    const results = await Promise.all(
        Array.from({ length: parallelCount }, (_, i) => {
            console.log(`  Starting thread ${i + 1}...`);
            return mapIngredientWithFallback(testIngredient, { skipCache: false });
        })
    );
    const elapsed = Date.now() - startTime;

    console.log(`\n⏱️ All ${parallelCount} threads completed in ${elapsed}ms\n`);

    // Analyze results
    console.log('📊 Results:');
    const foodNames = new Set<string>();
    const foodIds = new Set<string>();

    results.forEach((result, i) => {
        if (result) {
            console.log(`  Thread ${i + 1}: "${result.foodName}" (${result.kcal} kcal) [${result.source}]`);
            foodNames.add(result.foodName);
            foodIds.add(result.foodId);
        } else {
            console.log(`  Thread ${i + 1}: NULL (mapping failed)`);
        }
    });

    console.log('\n=== Analysis ===');

    if (foodNames.size === 1 && foodIds.size === 1) {
        console.log('✅ SUCCESS: All threads got the SAME result!');
        console.log(`   Food: ${[...foodNames][0]}`);
        console.log('   The in-flight lock is working correctly.');
    } else {
        console.log('❌ FAILURE: Threads got DIFFERENT results!');
        console.log(`   Unique food names: ${[...foodNames].join(', ')}`);
        console.log('   The in-flight lock is NOT working - race condition present.');
    }

    // Check cache state
    console.log('\n=== Cache State ===');
    const cachedMappings = await prisma.validatedMapping.findMany({
        where: { normalizedForm: { contains: 'quinoa' } },
        select: { normalizedForm: true, foodName: true, foodId: true },
    });
    console.log(`Found ${cachedMappings.length} quinoa cache entries:`);
    cachedMappings.forEach(m => {
        console.log(`  - "${m.normalizedForm}" → "${m.foodName}"`);
    });

    await prisma.$disconnect();
}

main().catch(console.error);
