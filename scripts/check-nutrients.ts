import { prisma } from '../src/lib/db';

async function main() {
    const freshii = await prisma.fatSecretFoodCache.findFirst({
        where: { id: '114525510' }
    });

    if (freshii) {
        console.log('Freshii Green Onion nutrientsPer100g:');
        console.log(JSON.stringify(freshii.nutrientsPer100g, null, 2));
    } else {
        console.log('Not found');
    }

    await prisma.$disconnect();
}

main();
