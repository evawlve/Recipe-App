import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function deleteBeefStockServing() {
    console.log('Deleting incorrect AI-estimated beef stock cube serving...\n');

    // Delete the bad AI-estimated serving for beef stock cube
    const result = await prisma.fatSecretServingCache.deleteMany({
        where: {
            id: 'ai_34996_cube'
        }
    });

    console.log(`Deleted ${result.count} AI serving entry`);

    // Also clear any validated mappings that used this bad data
    const vm = await prisma.validatedMapping.deleteMany({
        where: {
            normalizedForm: { contains: 'beef stock', mode: 'insensitive' }
        }
    });

    console.log(`Deleted ${vm.count} ValidatedMapping entries for beef stock`);

    console.log('\nDone. Re-run mapping to get correct estimate.');
    await prisma.$disconnect();
}

deleteBeefStockServing().catch(console.error);
