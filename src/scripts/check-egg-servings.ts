// Investigate egg foods in cache - what servings do we have?
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: [] });

async function main() {
    console.log('=== ALL EGG FOODS IN FATSECRET CACHE ===\n');

    const eggFoods = await prisma.fatSecretFoodCache.findMany({
        where: {
            name: { in: ['Egg', 'Eggs', 'EGGS', 'egg', 'eggs'] }
        },
        include: { servings: true },
    });

    for (const food of eggFoods) {
        console.log(`Food: "${food.name}" (id: ${food.id})`);
        console.log(`  Brand: ${food.brandName || '(generic)'}`);
        console.log(`  Servings:`);
        for (const s of food.servings) {
            console.log(`    - "${s.measurementDescription}" = ${s.servingWeightGrams}g`);
        }
        console.log('');
    }

    // Also check if there are size-specific servings
    console.log('\n=== LOOKING FOR SIZE SERVINGS (small/medium/large) ===\n');
    const sizeServings = await prisma.fatSecretServingCache.findMany({
        where: {
            OR: [
                { measurementDescription: { contains: 'small', mode: 'insensitive' } },
                { measurementDescription: { contains: 'medium', mode: 'insensitive' } },
                { measurementDescription: { contains: 'large', mode: 'insensitive' } },
            ],
            food: {
                name: { contains: 'egg', mode: 'insensitive' }
            }
        },
        include: { food: true },
    });

    for (const s of sizeServings) {
        console.log(`"${s.measurementDescription}" = ${s.servingWeightGrams}g (${s.food.name})`);
    }

    await prisma.$disconnect();
}

main().catch(console.error);
