
import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    console.log('Verifying fixes in ValidatedMapping...');

    const targets = [
        '3 fl oz single cream',
        '1 dash pepper',
        '1 oz splenda'
    ];

    for (const target of targets) {
        console.log(`\nLooking for: "${target}"...`);
        // Use rawLine based on inference
        const mappings = await prisma.validatedMapping.findMany({
            where: {
                rawLine: { contains: target }
            },
            include: {
                ingredient: true,
                fatSecretFood: true // Join with cache to get food name
            }
        });

        if (mappings.length === 0) {
            console.log(`  ❌ Not found in DB (Mapping failed or not run?)`);
        } else {
            mappings.forEach(m => {
                console.log(`  ✅ Found Mapping (ID: ${m.id})`);
                console.log(`     - Food: ${m.fatSecretFood?.name} (ID: ${m.fatSecretFoodId})`);
                console.log(`     - Serving: ${m.measurementDescription} (${m.metricAmount}${m.metricUnit})`);
                console.log(`     - Confidence: ${m.confidence}`);
                console.log(`     - Text: "${m.rawLine}"`);
            });
        }
    }
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
