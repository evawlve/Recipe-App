import { prisma } from '../src/lib/db';

async function main() {
    const maps = await prisma.validatedMapping.findMany({
        where: {
            normalizedForm: { contains: 'broth' }
        },
        orderBy: { createdAt: 'desc' },
        take: 10
    });
    console.log(JSON.stringify(maps, null, 2));

    const fdcFood = await prisma.fdcFoodCache.findMany({
        where: { description: { contains: 'BROTH' } },
        include: { servings: true },
        take: 5
    });
    console.log(JSON.stringify(fdcFood, null, 2));
}

main().catch(console.error).finally(() => prisma.$disconnect());
