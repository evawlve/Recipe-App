import { prisma } from '../src/lib/db';

async function main() {
    // Find recipes with unmapped ingredients
    const recipes = await prisma.recipe.findMany({
        where: {
            ingredients: {
                some: {
                    foodMaps: { none: {} }
                }
            }
        },
        include: {
            ingredients: {
                where: { foodMaps: { none: {} } }
            }
        },
        take: 5
    });

    console.log('Recipes with unmapped ingredients:\n');
    for (const r of recipes) {
        console.log('Recipe:', r.title, '(' + r.id + ')');
        console.log('  Unmapped ingredients:', r.ingredients.length);
        r.ingredients.slice(0, 15).forEach(i => {
            console.log('   -', i.qty, i.unit || '[NO UNIT]', i.name);
        });
        if (r.ingredients.length > 15) console.log('   ... and', r.ingredients.length - 15, 'more');
        console.log('');
    }

    await prisma.$disconnect();
}

main();
