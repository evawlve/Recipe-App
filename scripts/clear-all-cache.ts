import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Clearing old synonyms...');
    const deleted = await prisma.learnedSynonym.deleteMany({});
    console.log('Deleted', deleted.count, 'synonyms');

    // Also clear other cache tables for clean test
    console.log('\nClearing other tables...');
    const food = await prisma.fatSecretFoodCache.deleteMany({});
    console.log('  FatSecretFoodCache:', food.count);

    const valid = await prisma.validatedMapping.deleteMany({});
    console.log('  ValidatedMapping:', valid.count);

    const ai = await prisma.aiNormalizeCache.deleteMany({});
    console.log('  AiNormalizeCache:', ai.count);

    await prisma.$disconnect();
    console.log('\nDone! Ready for clean test.');
}

main();
