// Check specific serving IDs
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: [] });

async function main() {
    const servingIds = ['62267', '56925', '62290'];

    for (const sid of servingIds) {
        const serving = await prisma.fatSecretServingCache.findUnique({
            where: { id: sid },
            include: { food: { select: { id: true, name: true } } },
        });
        if (serving) {
            console.log(`\n=== Serving ID: ${sid} ===`);
            console.log(`Food: ${serving.food.name} (${serving.food.id})`);
            console.log(`Description: "${serving.measurementDescription}"`);
            console.log(`servingWeightGrams: ${serving.servingWeightGrams}`);
            console.log(`metricServingAmount: ${serving.metricServingAmount} ${serving.metricServingUnit}`);
            console.log(`numberOfUnits: ${serving.numberOfUnits}`);

            // Calculate what grams would be returned for common units
            const grams = serving.servingWeightGrams ?? serving.metricServingAmount ?? 0;
            const units = serving.numberOfUnits ?? 1;
            const perUnit = grams / units;
            console.log(`=> Per unit: ${perUnit}g`);
            console.log(`=> 0.25 cup would expect: 0.25 * 16 * ${perUnit}g = ${0.25 * 16 * perUnit}g`);
        } else {
            console.log(`Serving ${sid} not found`);
        }
    }

    await prisma.$disconnect();
}

main().catch(console.error);
