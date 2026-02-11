import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function clearTomatoCache() {
    console.log('Clearing all tomato-related cache entries...\n');

    // Clear ValidatedMapping
    const vm = await prisma.validatedMapping.deleteMany({
        where: {
            OR: [
                { normalizedForm: { contains: 'tomato', mode: 'insensitive' } },
                { rawIngredient: { contains: 'tomato', mode: 'insensitive' } },
                { foodName: { contains: 'tomato', mode: 'insensitive' } }
            ]
        }
    });
    console.log(`Deleted ${vm.count} ValidatedMapping entries`);

    // Clear IngredientFoodMap
    const ifm = await prisma.ingredientFoodMap.deleteMany({
        where: {
            OR: [
                { ingredientName: { contains: 'tomato', mode: 'insensitive' } },
                { foodName: { contains: 'tomato', mode: 'insensitive' } }
            ]
        }
    });
    console.log(`Deleted ${ifm.count} IngredientFoodMap entries`);

    // Clear AiNormalizeCache
    const ai = await prisma.aiNormalizeCache.deleteMany({
        where: {
            OR: [
                { rawLine: { contains: 'tomato', mode: 'insensitive' } },
                { normalizedName: { contains: 'tomato', mode: 'insensitive' } }
            ]
        }
    });
    console.log(`Deleted ${ai.count} AiNormalizeCache entries`);

    console.log('\nCache cleared.');
    await prisma.$disconnect();
}

clearTomatoCache().catch(console.error);
