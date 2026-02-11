/**
 * Debug: Check what nutrition data the Freshii Green Onion has
 */

import { prisma } from '../src/lib/db';

async function main() {
    // Find the Freshii Green Onion
    const freshiiFood = await prisma.fatSecretFoodCache.findFirst({
        where: { id: '114525510' },  // From debug output
        include: { servings: true }
    });

    if (!freshiiFood) {
        console.log('Food not found by ID, trying by name...');
        const byName = await prisma.fatSecretFoodCache.findFirst({
            where: {
                name: { contains: 'Green Onion', mode: 'insensitive' },
                brandName: { contains: 'Freshii', mode: 'insensitive' }
            },
            include: { servings: true }
        });
        if (byName) {
            console.log(`Found: ${byName.name} (${byName.brandName})`);
            console.log(`ID: ${byName.id}`);
            console.log(`Servings: ${byName.servings.length}`);
            for (const s of byName.servings) {
                console.log(`  ${s.measurementDescription}: cal=${s.calories}, P=${s.protein}, C=${s.carbohydrate}, F=${s.fat}`);
            }
        }
        return;
    }

    console.log('=== Freshii Green Onion Food Details ===\n');
    console.log(`Name: ${freshiiFood.name}`);
    console.log(`Brand: ${freshiiFood.brandName}`);
    console.log(`ID: ${freshiiFood.id}`);
    console.log(`Food Type: ${freshiiFood.foodType}`);
    console.log(`Description: ${freshiiFood.description}`);

    console.log(`\nServings (${freshiiFood.servings.length}):`);
    for (const s of freshiiFood.servings) {
        console.log(`  ${s.id}: "${s.measurementDescription}"`);
        console.log(`    Calories: ${s.calories}`);
        console.log(`    Protein: ${s.protein}`);
        console.log(`    Carbs: ${s.carbohydrate}`);
        console.log(`    Fat: ${s.fat}`);
        console.log(`    metricServingAmount: ${s.metricServingAmount}`);
        console.log(`    metricServingUnit: ${s.metricServingUnit}`);
        console.log(`    servingWeightGrams: ${s.servingWeightGrams}`);
    }

    await prisma.$disconnect();
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
