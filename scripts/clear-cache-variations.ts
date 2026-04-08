import { prisma } from '../src/lib/db';

async function clearCaches() {
    console.log('🧹 Clearing FatSecretFoodCache...');

    const rm2 = await prisma.fatSecretFoodCache.deleteMany({
        where: {
            name: { contains: 'fat free', mode: 'insensitive' }
        }
    });
    console.log(`✓ Fat free Cache items cleared: ${rm2.count}`);

    console.log('\n✅ Done!');
}

clearCaches()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
