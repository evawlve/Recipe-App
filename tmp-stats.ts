import { PrismaClient } from '@prisma/client';
const p = new PrismaClient({datasources:{db:{url:process.env.DIRECT_URL}}});
async function main() {
    console.log('ValidatedMapping:', await p.validatedMapping.count());
    console.log('FatSecretFoodCache:', await p.fatSecretFoodCache.count());
    console.log('FdcFoodCache:', await p.fdcFoodCache.count());
    console.log('IngredientFoodMap:', await p.ingredientFoodMap.count());
}
main().catch(console.error).finally(() => p.$disconnect());
