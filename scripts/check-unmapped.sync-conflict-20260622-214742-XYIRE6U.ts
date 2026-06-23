import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function checkUnmapped() {
    const recipes = await prisma.recipe.findMany({
        where: {
            ingredients: {
                some: {
                    foodMaps: {
                        none: {}
                    }
                }
            }
        },
        include: {
            ingredients: {
                where: {
                    foodMaps: {
                        none: {}
                    }
                }
            }
        },
        take: 5
    });

    console.log(`\nFound ${recipes.length} recipes with unmapped ingredients\n`);

    if (recipes.length > 0) {
        recipes.forEach(r => {
            console.log(`- ${r.title} (${r.ingredients.length} unmapped)`);
        });
    } else {
        console.log('✅ All existing recipes have mapped ingredients!');
        console.log('🔄 Need to import new recipes to continue testing.\n');
    }
}

checkUnmapped()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
