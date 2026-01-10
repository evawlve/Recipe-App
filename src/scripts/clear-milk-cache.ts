// Clear AI normalize cache for milk queries
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: [] });

async function main() {
    console.log('=== Clearing AI Normalize Cache for milk ===');

    const deleted = await prisma.aiNormalizeCache.deleteMany({
        where: {
            rawLine: { contains: 'milk', mode: 'insensitive' },
        },
    });

    console.log(`Deleted ${deleted.count} cached normalizations`);

    // Also clear validated mappings for milk
    const validatedDeleted = await prisma.validatedMapping.deleteMany({
        where: {
            rawIngredient: { contains: 'milk', mode: 'insensitive' },
        },
    });

    console.log(`Deleted ${validatedDeleted.count} validated mappings`);

    await prisma.$disconnect();
}

main().catch(console.error);
