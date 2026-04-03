import { prisma } from '../src/lib/db';

async function countUnmapped() {
    try {
        const totalRecipes = await prisma.recipe.count();
        const unmappedRecipes = await prisma.recipe.count({
            where: {
                ingredients: {
                    some: {
                        foodMaps: {
                            none: {}
                        }
                    }
                }
            }
        });

        const totalIngredients = await prisma.ingredient.count();
        const unmappedIngredients = await prisma.ingredient.count({
            where: {
                foodMaps: {
                    none: {}
                }
            }
        });

        console.log(`\n=== Mapping Status ===`);
        console.log(`Recipes Fully Mapped: ${totalRecipes - unmappedRecipes} / ${totalRecipes}`);
        console.log(`Recipes with Unmapped Items: ${unmappedRecipes}`);
        console.log(`-----------------------------------`);
        console.log(`Total Ingredients: ${totalIngredients}`);
        console.log(`Unmapped Ingredients: ${unmappedIngredients}`);
        console.log(`===================================\n`);
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

countUnmapped();
