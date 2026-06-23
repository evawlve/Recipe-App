import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    // Check mango ValidatedMapping
    console.log('\n=== Mango ValidatedMappings ===\n');

    const mappings = await prisma.validatedMapping.findMany({
        where: {
            rawIngredient: { contains: 'mango', mode: 'insensitive' },
        },
        select: { id: true, rawIngredient: true, foodId: true, foodName: true },
    });

    if (mappings.length === 0) {
        console.log('No mango mappings found');
    } else {
        for (const m of mappings) {
            console.log(`"${m.rawIngredient}" → "${m.foodName}" (ID: ${m.foodId})`);
        }
    }

    // Check what servings exist for this food
    if (mappings.length > 0) {
        const foodId = mappings[0].foodId;
        console.log(`\n=== Servings for food ${foodId} ===\n`);

        const servings = await prisma.fatSecretServingCache.findMany({
            where: { foodId },
            select: { measurementDescription: true, servingWeightGrams: true },
        });

        for (const s of servings) {
            console.log(`  "${s.measurementDescription}" = ${s.servingWeightGrams}g`);
        }
    }
}

main().finally(() => prisma.$disconnect());
