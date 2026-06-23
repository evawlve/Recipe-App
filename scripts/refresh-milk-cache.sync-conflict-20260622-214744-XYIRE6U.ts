/**
 * Refresh cache for milk-based foods
 * 
 * This script finds all milk-related foods in the cache and re-fetches them
 * from the API to apply the ml→grams fix for nutrientsPer100g.
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { upsertFoodFromApi } from '../src/lib/fatsecret/cache';
import { FatSecretClient } from '../src/lib/fatsecret/client';

const MILK_KEYWORDS = [
    'coconut milk',
    'almond milk',
    'soy milk',
    'oat milk',
    'fat free milk',
    'skim milk',
    'whole milk',
    '2% milk',
    '1% milk',
    'plant milk',
    'cashew milk',
    'rice milk',
];

async function main() {
    const client = new FatSecretClient();

    console.log('=== Refreshing Milk-Based Food Cache ===\n');

    // Find all milk-related foods in cache
    const milkFoods = await prisma.fatSecretFoodCache.findMany({
        where: {
            OR: MILK_KEYWORDS.map(keyword => ({
                name: { contains: keyword, mode: 'insensitive' as const }
            }))
        },
        select: { id: true, name: true, nutrientsPer100g: true }
    });

    console.log(`Found ${milkFoods.length} milk-related foods in cache\n`);

    let refreshed = 0;
    let failed = 0;
    let skipped = 0;

    for (const food of milkFoods) {
        const hasNutrients = food.nutrientsPer100g != null;

        // Skip if already has nutrients (already up to date)
        if (hasNutrients) {
            console.log(`○ ${food.name} (${food.id}) - already has nutrients, skipping`);
            skipped++;
            continue;
        }

        console.log(`↻ Refreshing: ${food.name} (${food.id})`);

        try {
            // Delete existing cache entries to force fresh fetch
            await prisma.fatSecretServingCache.deleteMany({ where: { foodId: food.id } });
            await prisma.fatSecretFoodCache.deleteMany({ where: { id: food.id } });

            // Re-fetch from API with fix applied
            const result = await upsertFoodFromApi(food.id, { client });

            if (result && result.nutrientsPer100g) {
                console.log(`  ✓ Cached with nutrients: ${JSON.stringify(result.nutrientsPer100g)}`);
                refreshed++;
            } else {
                console.log(`  ✗ Still missing nutrients after refresh`);
                failed++;
            }
        } catch (err) {
            console.log(`  ✗ Error: ${(err as Error).message}`);
            failed++;
        }

        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log('\n=== Summary ===');
    console.log(`Refreshed: ${refreshed}`);
    console.log(`Skipped (already had nutrients): ${skipped}`);
    console.log(`Failed: ${failed}`);
    console.log(`Total: ${milkFoods.length}`);
}

main()
    .then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1); });
