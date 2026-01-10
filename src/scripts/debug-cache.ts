// Debug cornmeal search issue
process.env.LOG_LEVEL = 'debug';

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient({ log: [] });

async function main() {
    console.log('=== Cornmeal Cache Search ===\n');

    // Check what's in the cache for cornmeal
    const cornmealFoods = await prisma.fatSecretFoodCache.findMany({
        where: {
            name: { contains: 'cornmeal', mode: 'insensitive' },
        },
        take: 10,
    });

    console.log(`Found ${cornmealFoods.length} cornmeal foods in cache:`);
    for (const food of cornmealFoods) {
        console.log(`  - ${food.name} (${food.brandName || 'Generic'}) [ID: ${food.id}]`);
    }

    console.log('\n=== Milk Lowfat Cache Search ===\n');

    // Check what's in the cache for milk
    const milkFoods = await prisma.fatSecretFoodCache.findMany({
        where: {
            OR: [
                { name: { contains: 'lowfat milk', mode: 'insensitive' } },
                { name: { contains: 'low fat milk', mode: 'insensitive' } },
                { name: { contains: 'milk lowfat', mode: 'insensitive' } },
                { name: { contains: '1% milk', mode: 'insensitive' } },
                { name: { contains: '2% milk', mode: 'insensitive' } },
            ],
        },
        take: 10,
    });

    console.log(`Found ${milkFoods.length} lowfat milk foods in cache:`);
    for (const food of milkFoods) {
        console.log(`  - ${food.name} (${food.brandName || 'Generic'}) [ID: ${food.id}]`);
    }

    // Also check nonfat milk
    const nonfatMilk = await prisma.fatSecretFoodCache.findMany({
        where: {
            name: { contains: 'nonfat milk', mode: 'insensitive' },
        },
        take: 5,
    });

    console.log(`\nFound ${nonfatMilk.length} nonfat milk foods:`);
    for (const food of nonfatMilk) {
        console.log(`  - ${food.name} (${food.brandName || 'Generic'})`);
    }

    await prisma.$disconnect();
}

main().catch(console.error);
