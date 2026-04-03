import { prisma } from '../src/lib/db';

async function clearAll() {
    try {
        console.log('Clearing IngredientFoodMap (Recipe Mappings)...');
        await prisma.ingredientFoodMap.deleteMany({});
        
        console.log('Clearing ValidatedMapping (Global Mappings)...');
        await prisma.validatedMapping.deleteMany({});

        console.log('Clearing AiNormalizeCache (Learned Normals)...');
        await prisma.aiNormalizeCache.deleteMany({});

        console.log('Clearing AI Serving Estimates...');
        await prisma.fatSecretServingCache.deleteMany({
            where: { id: { startsWith: 'ai_' } }
        });

        console.log('✅ Clean slate achieved. All derived mappings purged.');
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

clearAll();
