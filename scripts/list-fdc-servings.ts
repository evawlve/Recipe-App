import { prisma } from '../src/lib/db';

async function main() {
    const servings = await prisma.fdcServingCache.findMany({
        where: { fdcId: 2397407 },
        orderBy: { id: 'desc' },
        take: 5
    });
    console.log('FDC 2397407 servings:');
    for (const x of servings) {
        console.log(x.id, x.description, x.grams + 'g', x.isAiEstimated ? '[AI]' : '[original]');
    }
}

main().finally(() => prisma.$disconnect());
