import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
    const [recipes, mappings, maps] = await Promise.all([
        p.recipe.count(),
        p.validatedMapping.count(),
        p.ingredientFoodMap.count(),
    ]);
    console.log('Recipes            :', recipes);
    console.log('ValidatedMappings  :', mappings);
    console.log('IngredientFoodMaps :', maps);
    await p.$disconnect();
}
main().catch(console.error);
