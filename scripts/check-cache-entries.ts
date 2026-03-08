import { prisma } from '../src/lib/db';

async function main() {
    // First find Vegetable Oil food, then get its servings
    console.log('=== OIL ENTRIES ===');
    const oilFood = await prisma.fatSecretFoodCache.findFirst({
        where: { name: 'Vegetable Oil' }
    });
    if (oilFood) {
        console.log('Food:', oilFood.name, '(ID:', oilFood.id, ')');
        console.log('Nutrients per 100g:', oilFood.nutrientsPer100g);

        const oilServings = await prisma.fatSecretServingCache.findMany({
            where: { foodId: oilFood.id },
            orderBy: { servingWeightGrams: 'desc' }
        });
        console.log('Servings:');
        for (const s of oilServings) {
            console.log(`  ${s.servingWeightGrams}g - ${s.measurementDescription} (source: ${s.source})`);
        }
    } else {
        console.log('Vegetable Oil not found in cache');
    }

    console.log('\n=== BEEF STOCK ENTRIES ===');
    const beefStock = await prisma.fatSecretFoodCache.findFirst({
        where: { name: 'Beef Stock' }
    });
    if (beefStock) {
        console.log('Food:', beefStock.name, '(ID:', beefStock.id, ')');
        console.log('Nutrients per 100g:', beefStock.nutrientsPer100g);

        const beefServings = await prisma.fatSecretServingCache.findMany({
            where: { foodId: beefStock.id }
        });
        console.log('Servings:');
        for (const s of beefServings) {
            console.log(`  ${s.measurementDescription}: ${s.servingWeightGrams}g (source: ${s.source})`);
        }
    } else {
        console.log('Beef Stock not found in cache');
    }

    console.log('\n=== MAYONNAISE ENTRIES ===');
    const mayo = await prisma.fatSecretFoodCache.findFirst({
        where: { name: 'Mayonnaise' }
    });
    if (mayo) {
        console.log('Food:', mayo.name, '(ID:', mayo.id, ')');
        console.log('Nutrients per 100g:', mayo.nutrientsPer100g);

        const mayoServings = await prisma.fatSecretServingCache.findMany({
            where: { foodId: mayo.id }
        });
        console.log('Servings:');
        for (const s of mayoServings) {
            console.log(`  ${s.measurementDescription}: ${s.servingWeightGrams}g (source: ${s.source})`);
        }
    } else {
        console.log('Mayonnaise not found in cache');
    }

    await prisma.$disconnect();
}
main();
