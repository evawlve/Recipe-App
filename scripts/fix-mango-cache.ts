/**
 * Fix corrupted mango cache entry
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { FatSecretClient } from '../src/lib/fatsecret/client';
import { ensureFoodCached } from '../src/lib/fatsecret/cache';

async function main() {
    console.log('\n=== Fixing Mango Cache ===\n');

    // Delete the corrupted Mangos cache entry
    const deleteResult = await prisma.fatSecretFoodCache.deleteMany({
        where: { id: '35863' },  // Mangos
    });

    console.log(`Deleted ${deleteResult.count} cache entries for Mangos (35863)`);

    // Also delete corrupted servings
    const deleteServings = await prisma.fatSecretServingCache.deleteMany({
        where: { foodId: '35863' },
    });

    console.log(`Deleted ${deleteServings.count} serving entries`);

    // Re-cache from fresh API data
    console.log('\nRe-caching Mangos from API...');
    const client = new FatSecretClient();
    await ensureFoodCached('35863', { client });

    // Verify the new cache
    const cached = await prisma.fatSecretServingCache.findMany({
        where: { foodId: '35863' },
        select: { measurementDescription: true, servingWeightGrams: true },
    });

    console.log(`\nNew servings for Mangos (${cached.length}):`);
    for (const s of cached) {
        console.log(`  - "${s.measurementDescription}" = ${s.servingWeightGrams}g`);
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
