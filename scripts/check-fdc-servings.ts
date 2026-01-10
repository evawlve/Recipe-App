import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function checkServings() {
    // Get servings for the FDC onion
    const servings = await prisma.fatSecretServingCache.findMany({
        where: { foodId: 'fdc_2438059' },
        select: {
            id: true,
            measurementDescription: true,
            servingWeightGrams: true,
            source: true,
            // Check what fields exist
        }
    });

    console.log('=== SERVINGS FOR fdc_2438059 (ONION) ===');
    for (const s of servings) {
        console.log(`\n  ID: ${s.id}`);
        console.log(`  Description: ${s.measurementDescription}`);
        console.log(`  Weight: ${s.servingWeightGrams}g`);
        console.log(`  Source: ${s.source}`);
    }

    // Check the FatSecretFoodCache entry
    const food = await prisma.fatSecretFoodCache.findUnique({
        where: { id: 'fdc_2438059' },
        select: { id: true, name: true, nutrientsPer100g: true }
    });

    console.log('\n=== FOOD CACHE ENTRY ===');
    if (food) {
        console.log('ID:', food.id);
        console.log('Name:', food.name);
        console.log('Nutrients per 100g:', JSON.stringify(food.nutrientsPer100g, null, 2));
    } else {
        console.log('❌ NOT FOUND in FatSecretFoodCache');
    }
}

checkServings().finally(() => prisma.$disconnect());
