// Delete validated mapping for sugar substitute to test fresh
process.env.LOG_LEVEL = 'error';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: [] });

async function main() {
    const deleted = await prisma.validatedMapping.deleteMany({
        where: { normalizedForm: { contains: 'sugar substitute', mode: 'insensitive' } }
    });

    console.log('Deleted validated mappings:', deleted.count);

    // Also delete the Market Pantry's servings to force backfill
    await prisma.fatSecretServingCache.deleteMany({
        where: { foodId: '1269847', source: 'ai' }
    });

    console.log('Deleted AI-generated servings for Market Pantry sweetener');

    await prisma.$disconnect();
}

main().catch(console.error);
