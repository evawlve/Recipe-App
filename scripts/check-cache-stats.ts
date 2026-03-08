import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const cache = await prisma.fatSecretFoodCache.count();
    const validMap = await prisma.validatedMapping.count();
    const synonyms = await prisma.learnedSynonym.count();
    const aiNorm = await prisma.aiNormalizeCache.count();

    console.log('Cache stats after pilot import:');
    console.log('  FatSecretFoodCache:', cache);
    console.log('  ValidatedMapping:', validMap);
    console.log('  LearnedSynonym:', synonyms);
    console.log('  AiNormalizeCache:', aiNorm);

    // Show a few sample synonyms
    const sampleSynonyms = await prisma.learnedSynonym.findMany({ take: 5 });
    console.log('\nSample synonyms:');
    for (const s of sampleSynonyms) {
        console.log(`  ${s.sourceTerm} → ${s.targetTerm}`);
    }

    await prisma.$disconnect();
}

main();
