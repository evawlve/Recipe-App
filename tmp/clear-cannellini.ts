import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function run() {
    console.log('Clearing valid mapping for cannellini beans');
    await prisma.validatedMapping.deleteMany({
        where: {
            normalizedForm: 'cannellini beans'
        }
    });

    await prisma.aiNormalizeCache.deleteMany({
        where: {
            rawLine: { contains: 'cannellini' }
        }
    });
    
    // We can also clear FatSecret cache for the name just in case
    console.log('Done clearing');
}

run().finally(() => prisma.$disconnect());
