/**
 * Quick script to check garlic servings in cache
 */
import { prisma } from '../src/lib/db';

async function main() {
    const food = await prisma.fatSecretFoodCache.findFirst({
        where: { id: '36383' },
        include: { servings: true }
    });

    console.log('Food:', food?.name);
    console.log('Servings:');
    food?.servings?.forEach(s => {
        console.log(`  - ${s.servingDescription} (${s.measurementDescription}) = ${s.metricServingAmount || s.servingWeightGrams}g`);
    });

    await prisma.$disconnect();
}

main().catch(console.error);
