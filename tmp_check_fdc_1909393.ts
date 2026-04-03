import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();
async function main() {
    const food = await p.fdcFoodCache.findUnique({where: {id: 1909393}});
    console.log('Nutrients:', JSON.stringify(food?.nutrients, null, 2));
    const servings = await p.fdcServingCache.findMany({where: {fdcId: 1909393}});
    console.log('Servings:', JSON.stringify(servings, null, 2));
}
main();
