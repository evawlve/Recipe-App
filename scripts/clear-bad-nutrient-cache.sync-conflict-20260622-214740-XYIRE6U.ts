#!/usr/bin/env ts-node
/**
 * Clear ALL ValidatedMappings that point to foods with bad nutrition data
 * Also clears the problematic FatSecretFoodCache entries
 */

import 'dotenv/config';
import { prisma } from '../src/lib/db';

const FOODS_TO_CLEAR = [
    // Potato with 2.4g fat (should be ~0.1g)
    { id: '5718', name: 'Potato' },
    // Cooked Lentils with 6.76g fat (should be ~0.4g)  
    { id: '3253', name: 'Cooked Lentils' },
    // Mixed Seeds - should not be used for "bread" queries
    { id: '3415', name: 'Mixed Seeds' },
    // Light Italian Dressing - should not be used for "nonfat" queries
    { id: '1139', name: 'Light Italian Dressing' },
];

const QUERIES_TO_CLEAR = [
    // Clear any ValidatedMapping containing these terms
    'potato',
    'potatoes',
    'lentil',
    'lentils',
    'nonfat italian',
    'fat free italian',
    'italian dressing',
    'mixed seeds bread',
    'seeded bread',
];

async function main() {
    console.log('\n🧹 Comprehensive Cache Cleanup\n');
    console.log('='.repeat(60));

    let totalMappingsDeleted = 0;
    let totalFoodsDeleted = 0;

    // Step 1: Clear by food ID
    console.log('\n📦 Clearing by Food ID:');
    for (const food of FOODS_TO_CLEAR) {
        const mappings = await prisma.validatedMapping.deleteMany({
            where: { foodId: food.id }
        });
        console.log(`   ${food.name} (${food.id}): ${mappings.count} mappings deleted`);
        totalMappingsDeleted += mappings.count;

        // Also clear the food cache
        const servings = await prisma.fatSecretServingCache.deleteMany({
            where: { foodId: food.id }
        });
        const cache = await prisma.fatSecretFoodCache.deleteMany({
            where: { id: food.id }
        });
        if (cache.count > 0) {
            console.log(`      + cache entry deleted (${servings.count} servings)`);
            totalFoodsDeleted += cache.count;
        }
    }

    // Step 2: Clear by query terms
    console.log('\n📝 Clearing by Query Terms:');
    for (const query of QUERIES_TO_CLEAR) {
        const mappings = await prisma.validatedMapping.deleteMany({
            where: {
                OR: [
                    { rawIngredient: { contains: query, mode: 'insensitive' } },
                    { normalizedForm: { contains: query, mode: 'insensitive' } }
                ]
            }
        });
        if (mappings.count > 0) {
            console.log(`   "${query}": ${mappings.count} mappings deleted`);
            totalMappingsDeleted += mappings.count;
        }
    }

    console.log('\n' + '='.repeat(60));
    console.log(`\n✅ Cleanup complete!`);
    console.log(`   Total ValidatedMappings deleted: ${totalMappingsDeleted}`);
    console.log(`   Total FatSecretFoodCache entries deleted: ${totalFoodsDeleted}`);
    console.log('\n   Re-run tests to verify mappings now use fresh API data.\n');
}

main()
    .catch((error) => {
        console.error('Error:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
