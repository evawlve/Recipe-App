/**
 * Debug: What APIs return for "egg whites"
 */
import 'dotenv/config';
import { FatSecretClient } from '../src/lib/fatsecret/client';
import { fdcApi } from '../src/lib/usda/fdc-api';

async function debug() {
    console.log('=== Debugging "egg whites" API results ===\n');

    // Test queries
    const queries = [
        'egg whites',
        'egg whites, stirred until fluffy',
    ];

    for (const query of queries) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`Query: "${query}"`);
        console.log('='.repeat(60));

        // FatSecret API
        console.log('\n--- FatSecret API (top 5) ---');
        try {
            const client = new FatSecretClient();
            const fsResults = await client.searchFoods(query, 5);
            if (fsResults && fsResults.length > 0) {
                fsResults.forEach((food, i) => {
                    console.log(`${i + 1}. [${food.food_id}] ${food.food_name}`);
                    if (food.brand_name) console.log(`   Brand: ${food.brand_name}`);
                    if (food.food_type) console.log(`   Type: ${food.food_type}`);
                });
            } else {
                console.log('   No results');
            }
        } catch (e) {
            console.log('   Error:', (e as Error).message);
        }

        // FDC API
        console.log('\n--- FDC API (top 5) ---');
        try {
            const fdcResults = await fdcApi.searchFoods({ query, pageSize: 5 });
            if (fdcResults && fdcResults.foods.length > 0) {
                fdcResults.foods.forEach((food, i) => {
                    console.log(`${i + 1}. [${food.fdcId}] ${food.description}`);
                    if (food.brandName) console.log(`   Brand: ${food.brandName}`);
                    if (food.dataType) console.log(`   Type: ${food.dataType}`);
                });
            } else {
                console.log('   No results');
            }
        } catch (e) {
            console.log('   Error:', (e as Error).message);
        }
    }

    console.log('\n\nDone!');
}

debug().then(() => process.exit(0)).catch(e => {
    console.error(e);
    process.exit(1);
});
