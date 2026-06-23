import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    const recipes = await prisma.recipe.count();
    const ingredients = await prisma.ingredient.count();
    const mapped = await prisma.ingredientFoodMap.count();
    const unmapped = await prisma.ingredient.count({ where: { foodMaps: { none: {} } } });
    const recentMappings = await prisma.ingredientFoodMap.count({
        where: { createdAt: { gte: new Date(Date.now() - 3600000) } } // last hour
    });

    console.log('=== Database Stats ===');
    console.log('Recipes:', recipes);
    console.log('Ingredients:', ingredients);
    console.log('Mapped:', mapped);
    console.log('Unmapped:', unmapped);
    console.log('Success Rate:', ((mapped / ingredients) * 100).toFixed(1) + '%');
    console.log('Mappings in last hour:', recentMappings);

    await prisma.$disconnect();
}

main().catch(console.error);
