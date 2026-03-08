/**
 * Clear ALL mapping caches
 * 
 * Clears:
 * - ValidatedMapping (global ingredient → food cache)
 * - IngredientFoodMap (per-recipe nutrition mappings)
 * 
 * Run this before pilot import to test with fresh mappings.
 */

import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    console.log('\n=== Clearing All Mapping Caches ===\n');

    // Get counts before
    const validatedBefore = await prisma.validatedMapping.count();
    const foodMapBefore = await prisma.ingredientFoodMap.count();
    const normCacheBefore = await prisma.aiNormalizeCache.count();

    console.log('Before:');
    console.log(`  ValidatedMapping: ${validatedBefore}`);
    console.log(`  IngredientFoodMap: ${foodMapBefore}`);
    console.log(`  AiNormalizeCache: ${normCacheBefore}`);

    // Clear ValidatedMapping
    const validatedResult = await prisma.validatedMapping.deleteMany({});
    console.log(`\n✓ ValidatedMapping: ${validatedResult.count} deleted`);

    // Clear IngredientFoodMap
    const foodMapResult = await prisma.ingredientFoodMap.deleteMany({});
    console.log(`✓ IngredientFoodMap: ${foodMapResult.count} deleted`);

    // Clear AiNormalizeCache
    const normCacheResult = await prisma.aiNormalizeCache.deleteMany({});
    console.log(`✓ AiNormalizeCache: ${normCacheResult.count} deleted`);

    console.log('\n✅ All mapping caches cleared!');
    console.log('   Now run pilot import to test with fresh mappings.\n');
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
