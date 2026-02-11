import { prisma } from '../src/lib/db';

async function main() {
    console.log('=== Clearing Jalapeño mappings ===\n');

    // Clear ValidatedMapping
    const deleted = await prisma.validatedMapping.deleteMany({
        where: {
            normalizedForm: { contains: 'jalapeno', mode: 'insensitive' }
        }
    });
    console.log('ValidatedMapping deleted:', deleted.count);

    // Also clear jalapeño with ñ
    const deleted2 = await prisma.validatedMapping.deleteMany({
        where: {
            normalizedForm: { contains: 'jalapeño', mode: 'insensitive' }
        }
    });
    console.log('ValidatedMapping (ñ) deleted:', deleted2.count);

    // Clear AiNormalizeCache 
    const deleted3 = await prisma.aiNormalizeCache.deleteMany({
        where: {
            normalizedName: { contains: 'jalapeno', mode: 'insensitive' }
        }
    });
    console.log('AiNormalizeCache deleted:', deleted3.count);

    console.log('\n✅ Complete!');
    await prisma.$disconnect();
}

main();
