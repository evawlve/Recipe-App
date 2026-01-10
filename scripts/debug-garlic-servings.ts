/**
 * Debug script to check what servings exist for garlic foods
 */
import { prisma } from '../src/lib/db';

async function main() {
    console.log('\n=== Checking Garlic Servings in Cache ===\n');

    // Find garlic foods in cache
    const garlicFoods = await prisma.fatSecretFoodCache.findMany({
        where: {
            name: {
                contains: 'garlic',
                mode: 'insensitive'
            }
        },
        include: {
            servings: true
        },
        take: 5
    });

    if (garlicFoods.length === 0) {
        console.log('No garlic foods found in cache');
        process.exit(0);
    }

    for (const food of garlicFoods) {
        console.log(`\n--- ${food.name} (${food.brandName || 'generic'}) ---`);
        console.log(`ID: ${food.id}`);
        console.log(`Servings (${food.servings.length}):`);
        for (const s of food.servings) {
            console.log(`  - "${s.measurementDescription || s.description}" | ${s.servingWeightGrams}g | unit: ${s.metricServingUnit}`);
        }
    }

    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
