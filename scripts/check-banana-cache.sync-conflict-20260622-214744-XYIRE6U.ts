import { prisma } from '../src/lib/db';

async function main() {
    const bananas = await prisma.fatSecretFoodCache.findMany({
        where: {
            name: { contains: 'Banana', mode: 'insensitive' }
        },
        select: {
            name: true,
            brandName: true,
            foodType: true
        },
        take: 20
    });

    console.log('Bananas in cache:\n');
    for (const b of bananas) {
        console.log(`  "${b.name}"${b.brandName ? ` (${b.brandName})` : ''} [${b.foodType}]`);
    }
}

main().finally(() => prisma.$disconnect());
