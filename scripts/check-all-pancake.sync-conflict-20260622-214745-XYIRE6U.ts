import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function check() {
    // Find all pancake mix foods
    console.log('=== ALL PANCAKE MIX FOODS IN CACHE ===');
    const foods = await prisma.fatSecretFoodCache.findMany({
        where: { name: { contains: 'PANCAKE MIX', mode: 'insensitive' } },
        select: { id: true, name: true, nutrientsPer100g: true }
    });

    for (const food of foods) {
        console.log(`\nFood: ${food.name} (${food.id})`);
        console.log('Has nutrition:', !!food.nutrientsPer100g);

        const servings = await prisma.fatSecretServingCache.findMany({
            where: { foodId: food.id },
            select: { id: true, measurementDescription: true, servingWeightGrams: true, source: true }
        });

        if (servings.length === 0) {
            console.log('  ❌ NO SERVINGS');
        } else {
            console.log('  Servings:');
            for (const s of servings) {
                console.log(`    - ${s.measurementDescription}: ${s.servingWeightGrams}g (${s.source})`);
            }
        }
    }

    // Also check what food the fallback actually found
    console.log('\n=== CHECKING MAMMA MIA SPECIFICALLY ===');
    const mammaMia = await prisma.fatSecretFoodCache.findFirst({
        where: { name: { contains: 'MAMMA MIA', mode: 'insensitive' } },
        select: { id: true, name: true, nutrientsPer100g: true }
    });

    if (mammaMia) {
        console.log('Food:', mammaMia.name, `(${mammaMia.id})`);
        console.log('Has nutrition:', !!mammaMia.nutrientsPer100g);

        const servings = await prisma.fatSecretServingCache.findMany({
            where: { foodId: mammaMia.id },
            select: { measurementDescription: true, servingWeightGrams: true }
        });
        console.log('Servings:', servings.length > 0 ? servings : 'NONE');
    } else {
        console.log('MAMMA MIA not found in cache');
    }
}

check().finally(() => prisma.$disconnect());
