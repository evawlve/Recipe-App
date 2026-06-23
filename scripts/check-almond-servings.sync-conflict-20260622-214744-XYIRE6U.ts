import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function check() {
    const foodId = '69769'; // Unsweetened Chocolate Almond Milk

    console.log('=== SERVINGS FOR FOOD ID', foodId, '===');

    const servings = await prisma.fatSecretServingCache.findMany({
        where: { foodId },
    });

    for (const s of servings) {
        console.log(`\nID: ${s.id}`);
        console.log(`  Description: ${s.measurementDescription}`);
        console.log(`  Weight: ${s.servingWeightGrams}g`);
        console.log(`  metricAmount: ${s.metricServingAmount}`);
        console.log(`  metricUnit: ${s.metricServingUnit}`);
        console.log(`  Source: ${s.source}`);
    }
}

check().finally(() => prisma.$disconnect());
