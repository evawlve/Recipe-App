/**
 * Clear ALL caches for clean slate testing
 * 
 * Clears:
 * - ValidatedMapping + IngredientFoodMap (mappings)
 * - FdcServingCache + FdcFoodCache
 * - FatSecretServingCache + FatSecretFoodAlias + FatSecretFoodCache
 * - AiNormalizeCache
 */

import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    console.log('\n=== Clearing ALL Caches for Clean Slate ===\n');

    // Clear mappings
    const validated = await prisma.validatedMapping.deleteMany({});
    console.log('ValidatedMapping:', validated.count);

    const foodMap = await prisma.ingredientFoodMap.deleteMany({});
    console.log('IngredientFoodMap:', foodMap.count);

    // Clear FDC servings first (foreign key)
    const fdcServ = await prisma.fdcServingCache.deleteMany({});
    console.log('FdcServingCache:', fdcServ.count);

    // Clear FDC foods
    const fdcFood = await prisma.fdcFoodCache.deleteMany({});
    console.log('FdcFoodCache:', fdcFood.count);

    // Clear FatSecret servings first (foreign key)
    const fsServ = await prisma.fatSecretServingCache.deleteMany({});
    console.log('FatSecretServingCache:', fsServ.count);

    // Clear FatSecret food aliases (foreign key)
    const fsAlias = await prisma.fatSecretFoodAlias.deleteMany({});
    console.log('FatSecretFoodAlias:', fsAlias.count);

    // Clear FatSecret foods
    const fsFood = await prisma.fatSecretFoodCache.deleteMany({});
    console.log('FatSecretFoodCache:', fsFood.count);

    // Clear AI caches
    const aiNorm = await prisma.aiNormalizeCache.deleteMany({});
    console.log('AiNormalizeCache:', aiNorm.count);

    console.log('\n✓ All caches cleared!');
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
