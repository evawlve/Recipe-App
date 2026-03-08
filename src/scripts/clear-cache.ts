// Clear cached validated mappings for affected queries
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({ log: [] });

async function main() {
    console.log('=== Clearing cached mappings for moderate issues ===\n');

    const queriesToClear = [
        '%cornmeal%',
        '%milk lowfat%',
        '%lowfat milk%',
        '%green bell pepper%',
        '%green pepper%',
        '%100% liquid%',
        '%liquid%',
    ];

    for (const pattern of queriesToClear) {
        const deleted = await prisma.validatedMapping.deleteMany({
            where: {
                rawIngredient: { contains: pattern.replace(/%/g, ''), mode: 'insensitive' },
            },
        });
        console.log(`Cleared ${deleted.count} mappings matching "${pattern}"`);
    }

    console.log('\nDone!');
    await prisma.$disconnect();
}

main().catch(console.error);
