import { prisma } from '../src/lib/db';

async function main() {
    const eggs = await prisma.ingredient.findMany({
        where: { name: { contains: 'egg' } },
        take: 10
    });

    console.log('Egg ingredients in database:\n');
    eggs.forEach(e => {
        console.log(`  qty: ${e.qty}, unit: "${e.unit || ''}", name: "${e.name}"`);
    });

    await prisma.$disconnect();
}

main();
