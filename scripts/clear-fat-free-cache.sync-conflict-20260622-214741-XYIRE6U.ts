import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function clearFatFreeCacheEntries() {
    console.log('Clearing stale fat-free cheddar cache entries...');

    // Delete ValidatedMapping entries that mapped fat-free to wrong items
    const deleted = await prisma.validatedMapping.deleteMany({
        where: {
            rawIngredient: {
                contains: 'fat free cheddar',
                mode: 'insensitive',
            },
        },
    });

    console.log('Deleted ValidatedMapping entries:', deleted.count);

    // Also clear normalizedForm matches
    const deleted2 = await prisma.validatedMapping.deleteMany({
        where: {
            normalizedForm: {
                contains: 'fat free cheddar',
                mode: 'insensitive',
            },
        },
    });

    console.log('Deleted by normalizedForm:', deleted2.count);
}

clearFatFreeCacheEntries()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
