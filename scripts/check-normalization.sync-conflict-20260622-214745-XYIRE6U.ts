import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkNormalization() {
    const entry = await prisma.aiNormalizeCache.findFirst({
        where: { rawLine: { contains: 'rushed', mode: 'insensitive' } }
    });

    console.log('AI Normalize Cache for crushed tomatoes:');
    if (entry) {
        console.log('  rawLine:', entry.rawLine);
        console.log('  normalizedName:', entry.normalizedName);
        console.log('  prepPhrases:', entry.prepPhrases);
        console.log('  synonyms:', entry.synonyms);
    } else {
        console.log('  No entry found');
    }

    await prisma.$disconnect();
}

checkNormalization();
