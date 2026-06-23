import { prisma } from '../src/lib/db';

async function main() {
    // Check which recipes have unmapped ingredients
    const recipesWithUnmapped = await prisma.recipe.findMany({
        where: {
            ingredients: {
                some: {
                    foodMaps: {
                        none: {},
                    },
                },
            },
        },
        include: {
            ingredients: {
                where: {
                    foodMaps: {
                        none: {},
                    },
                },
            },
        },
        take: 10,
    });

    console.log('=== Recipes with Unmapped Ingredients (first 10) ===');
    console.log(`Total found: ${recipesWithUnmapped.length}\n`);

    for (const recipe of recipesWithUnmapped) {
        console.log(`📝 Recipe: "${recipe.title}" (ID: ${recipe.id})`);
        console.log(`   Unmapped ingredients: ${recipe.ingredients.length}`);
        for (const ing of recipe.ingredients.slice(0, 5)) {
            console.log(`     - ${ing.qty || ''} ${ing.unit || ''} ${ing.name}`.trim());
        }
        if (recipe.ingredients.length > 5) {
            console.log(`     ... and ${recipe.ingredients.length - 5} more`);
        }
        console.log();
    }

    await prisma.$disconnect();
}

main().catch(console.error);
