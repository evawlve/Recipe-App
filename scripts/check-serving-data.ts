/**
 * Check serving data for unsweetened coconut milk
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function check() {
    const foods = await prisma.fatSecretFoodCache.findMany({
        where: { name: { contains: 'Unsweetened Coconut Milk', mode: 'insensitive' } },
        include: { servings: true },
        take: 3
    });

    for (const food of foods) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`Food: ${food.name} (${food.brandName || 'Generic'})`);
        console.log(`ID: ${food.id}`);
        console.log(`Nutrients per 100g: ${JSON.stringify(food.nutrientsPer100g)}`);
        console.log(`Servings (${food.servings.length}):`);
        for (const s of food.servings) {
            console.log(`  - ${s.measurementDescription || 'N/A'}`);
            console.log(`    servingWeightGrams: ${s.servingWeightGrams}`);
            console.log(`    metricServingAmount: ${s.metricServingAmount} ${s.metricServingUnit}`);
            console.log(`    volumeMl: ${s.volumeMl}`);
        }
    }

    await prisma.$disconnect();
}

check().catch(console.error);
