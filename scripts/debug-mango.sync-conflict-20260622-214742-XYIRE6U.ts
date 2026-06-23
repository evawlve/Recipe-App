/**
 * Debug mango mapping - trace serving selection
 */
import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { FatSecretClient } from '../src/lib/fatsecret/client';
import { getCachedFoodWithRelations } from '../src/lib/fatsecret/cache-search';

async function main() {
    console.log('\n=== MANGO DEBUG ===\n');

    // First, check what food is being selected
    console.log('1. Testing mapping for "1 mango"...\n');
    const result = await mapIngredientWithFallback('1 mango', { debug: true });

    if (result) {
        console.log(`\nMapped to: ${result.foodName}`);
        console.log(`Food ID: ${result.foodId}`);
        console.log(`Serving: ${result.servingDescription}`);
        console.log(`Grams: ${result.grams}`);

        // Get the full food details with all servings
        console.log('\n2. Checking all available servings for this food...\n');
        const cached = await getCachedFoodWithRelations(result.foodId);

        if (cached?.servings) {
            console.log(`Found ${cached.servings.length} servings:`);
            for (const s of cached.servings) {
                console.log(`  - "${s.measurementDescription}" = ${s.servingWeightGrams}g`);
            }
        }
    } else {
        console.log('Mapping failed!');
    }

    // Also check what FatSecret returns for "mango"
    console.log('\n3. FatSecret API results for "mango"...\n');
    const client = new FatSecretClient();
    const apiResults = await client.searchFoodsV4('mango', { maxResults: 3 });

    for (const food of apiResults) {
        console.log(`[${food.foodType}] ${food.name}${food.brandName ? ` (${food.brandName})` : ''}`);

        // Get details with servings
        const details = await client.getFoodDetails(food.id);
        if (details?.servings) {
            for (const s of details.servings.slice(0, 5)) {
                const grams = s.servingWeightGrams || s.metricServingAmount;
                console.log(`    - "${s.description || s.measurementDescription}" = ${grams}g`);
            }
        }
    }
}

main().finally(() => process.exit(0));
