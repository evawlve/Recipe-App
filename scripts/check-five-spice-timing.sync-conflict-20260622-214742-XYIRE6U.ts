import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    // Check the AI serving creation time for Five Spice
    const serving = await prisma.fatSecretServingCache.findFirst({
        where: {
            foodId: '471316',
            OR: [
                { id: { startsWith: 'ai_' } },
                { source: 'ai' }
            ]
        },
        select: { id: true, measurementDescription: true, servingWeightGrams: true, source: true }
    });

    console.log('=== AI Serving for Five Spice (471316) ===');
    console.log(serving ? JSON.stringify(serving, null, 2) : 'Not found');

    // Check the mapping for five spice  
    const mapping = await prisma.ingredientFoodMap.findFirst({
        where: {
            ingredient: {
                name: { contains: 'five spice', mode: 'insensitive' }
            }
        },
        include: { ingredient: true },
        orderBy: { createdAt: 'desc' }
    });

    console.log('\n=== IngredientFoodMap for five spice ===');
    if (mapping) {
        console.log({
            ingredientName: mapping.ingredient.name,
            fatsecretFoodId: mapping.fatsecretFoodId,
            fdcId: mapping.fdcId,
            createdAt: mapping.createdAt
        });
    } else {
        console.log('Not found in IngredientFoodMap');
    }

    // Check validated mapping
    const validatedMapping = await prisma.$queryRaw`
    SELECT "normalizedForm", "foodId", "foodName", "createdAt" 
    FROM "ValidatedMapping" 
    WHERE LOWER("normalizedForm") LIKE '%five spice%'
    ORDER BY "createdAt" DESC
    LIMIT 3
  `;

    console.log('\n=== ValidatedMapping for five spice ===');
    console.log(JSON.stringify(validatedMapping, null, 2));

    await prisma.$disconnect();
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
