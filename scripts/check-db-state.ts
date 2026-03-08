import { prisma } from '../src/lib/db';

async function main() {
    const recipes = await prisma.recipe.count();
    const ingredients = await prisma.ingredient.count();
    const unmapped = await prisma.ingredient.count({ where: { foodMaps: { none: {} } } });
    const mapped = await prisma.ingredient.count({ where: { foodMaps: { some: {} } } });

    console.log('=== Database State ===');
    console.log('Recipes:', recipes);
    console.log('Total Ingredients:', ingredients);
    console.log('  - Mapped:', mapped);
    console.log('  - Unmapped:', unmapped);

    // Show some unmapped ingredients
    if (unmapped > 0) {
        const samples = await prisma.ingredient.findMany({
            where: { foodMaps: { none: {} } },
            take: 10,
            select: { name: true, qty: true, unit: true }
        });
        console.log('\nSample unmapped ingredients:');
        samples.forEach(s => console.log(`  - ${s.qty || ''} ${s.unit || ''} ${s.name}`));
    }

    await prisma.$disconnect();
}

main().catch(console.error);
