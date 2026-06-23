import { prisma } from '../src/lib/db';

async function main() {
    const recipes = await prisma.recipe.count();
    const total = await prisma.ingredient.count();
    const mapped = await prisma.ingredientFoodMap.count();
    const unmapped = total - mapped;

    console.log('=== Final Pilot Results ===');
    console.log('Recipes:', recipes);
    console.log('Total Ingredients:', total);
    console.log('Mapped:', mapped);
    console.log('Unmapped:', unmapped);
    console.log('Success Rate:', (mapped / total * 100).toFixed(1) + '%');

    await prisma.$disconnect();
}

main();
