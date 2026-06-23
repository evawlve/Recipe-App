import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function check() {
    const food = await prisma.fatSecretFoodCache.findUnique({
        where: { id: '10756759' },
        include: { servings: true }
    });

    console.log('Food:', food?.name);
    console.log('NutrientsPer100g:', food?.nutrientsPer100g);
    console.log('Servings:');
    for (const s of (food?.servings || [])) {
        console.log('  -', s.measurementDescription);
        console.log('    grams:', s.servingWeightGrams);
        console.log('    metricAmount:', s.metricServingAmount, s.metricServingUnit);
        console.log('    volumeMl:', s.volumeMl);
    }

    await prisma.$disconnect();
}

check().catch(console.error);
