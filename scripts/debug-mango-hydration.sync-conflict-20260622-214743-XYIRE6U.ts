/**
 * Debug hydration for Mangos/Mango
 */
import 'dotenv/config';
import { FatSecretClient } from '../src/lib/fatsecret/client';
import { getCachedFoodWithRelations, cacheFoodToDetails } from '../src/lib/fatsecret/cache-search';
import { ensureFoodCached } from '../src/lib/fatsecret/cache';

async function main() {
    const client = new FatSecretClient();

    // First, get the IDs for Mangos and Mango from API
    console.log('\n=== Getting Mango Food IDs ===\n');
    const results = await client.searchFoodsV4('mango', { maxResults: 3 });

    for (const food of results) {
        console.log(`\n--- ${food.name} (ID: ${food.id}) ---`);

        // Check if in cache
        const cached = await getCachedFoodWithRelations(food.id);
        console.log(`In cache: ${cached ? 'YES' : 'NO'}`);

        if (cached) {
            const details = cacheFoodToDetails(cached);
            console.log(`Servings in cache: ${details.servings?.length || 0}`);
            if (details.servings) {
                for (const s of details.servings.slice(0, 3)) {
                    const grams = s.servingWeightGrams || s.metricServingAmount;
                    console.log(`  - "${s.description || s.measurementDescription}" = ${grams}g`);
                }
            }
        } else {
            // Try to get from API
            console.log('Fetching from API...');
            const details = await client.getFoodDetails(food.id);
            console.log(`Servings from API: ${details?.servings?.length || 0}`);
            if (details?.servings) {
                for (const s of details.servings.slice(0, 3)) {
                    const grams = s.servingWeightGrams || s.metricServingAmount;
                    console.log(`  - "${s.description || s.measurementDescription}" = ${grams}g`);
                }
            }
        }
    }
}

main().finally(() => process.exit(0));
