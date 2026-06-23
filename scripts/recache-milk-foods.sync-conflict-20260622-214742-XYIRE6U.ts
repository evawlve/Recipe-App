/**
 * Clear and re-cache milk foods to apply the fix
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { upsertFoodFromApi } from '../src/lib/fatsecret/cache';
import { FatSecretClient } from '../src/lib/fatsecret/client';

const MILK_FOOD_IDS = [
    '3913554',  // Coconut Milk Unsweetened (So Delicious)
];

async function main() {
    const client = new FatSecretClient();

    console.log('=== Re-caching milk foods with fix ===\n');

    for (const foodId of MILK_FOOD_IDS) {
        console.log(`Re-caching food ID: ${foodId}`);

        // Delete existing cache entry to force full refresh
        await prisma.fatSecretServingCache.deleteMany({ where: { foodId } });
        await prisma.fatSecretFoodCache.deleteMany({ where: { id: foodId } });
        console.log('  Deleted existing cache entry');

        // Re-fetch from API with fix applied
        const result = await upsertFoodFromApi(foodId, { client });

        if (result) {
            console.log(`  Cached: ${result.name}`);
            console.log(`  nutrientsPer100g: ${JSON.stringify(result.nutrientsPer100g)}`);
        } else {
            console.log('  FAILED to cache');
        }
        console.log('');
    }

    console.log('\n✅ Done!');
}

main()
    .then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1); });
