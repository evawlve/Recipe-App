/**
 * Test what the APIs actually return for "banana" (without cache interference)
 */
import 'dotenv/config';
import { FatSecretClient } from '../src/lib/fatsecret/client';
import { fdcApi } from '../src/lib/usda/fdc-api';

async function main() {
    console.log('\n=== API RESULTS FOR "banana" ===\n');

    // FatSecret
    console.log('FatSecret API:');
    try {
        const fsClient = new FatSecretClient();
        const fsResults = await fsClient.searchFoodsV4('banana', { maxResults: 5 });
        if (fsResults.length > 0) {
            for (let i = 0; i < fsResults.length; i++) {
                const food = fsResults[i];
                console.log(`  ${i + 1}. "${food.name}"${food.brandName ? ` (${food.brandName})` : ''} [${food.foodType}]`);
            }
        } else {
            console.log('  No results');
        }
    } catch (err) {
        console.log('  Error:', (err as Error).message);
    }

    // FDC
    console.log('\nFDC API:');
    try {
        const fdcResults = await fdcApi.searchFoods({ query: 'banana', pageSize: 5 });
        if (fdcResults?.foods?.length) {
            for (let i = 0; i < fdcResults.foods.length; i++) {
                const food = fdcResults.foods[i];
                console.log(`  ${i + 1}. "${food.description}"${food.brandName ? ` (${food.brandName})` : ''} [${food.dataType}]`);
            }
        } else {
            console.log('  No results (API key may be missing)');
        }
    } catch (err) {
        console.log('  Error:', (err as Error).message);
    }
}

main().finally(() => process.exit(0));
