import { prisma } from '../src/lib/db';

async function main() {
    const totalRecipes = await prisma.recipe.count();
    const totalIngs = await prisma.ingredient.count();
    const mappedIngs = await prisma.ingredientFoodMap.count();
    const validatedMaps = await prisma.validatedMapping.count();

    const recipesWithUnmapped = await prisma.recipe.count({
        where: {
            ingredients: {
                some: {
                    foodMaps: { none: {} }
                }
            }
        }
    });

    // Get sample of unmapped ingredients
    const sampleUnmapped = await prisma.ingredient.findMany({
        where: {
            foodMaps: { none: {} }
        },
        take: 10,
        select: { id: true, name: true, qty: true, unit: true }
    });

    console.log('=== Database State ===');
    console.log('Total Recipes:', totalRecipes);
    console.log('Total Ingredients:', totalIngs);
    console.log('IngredientFoodMap count:', mappedIngs);
    console.log('ValidatedMapping count:', validatedMaps);
    console.log('Recipes with unmapped ingredients:', recipesWithUnmapped);
    console.log('\nSample unmapped ingredients:');
    sampleUnmapped.forEach(ing => {
        console.log(`  - ${ing.qty || ''} ${ing.unit || ''} ${ing.name}`.trim());
    });

    await prisma.$disconnect();
}

main().catch(console.error);
