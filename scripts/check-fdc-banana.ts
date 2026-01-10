/**
 * Test what FDC API actually returns for "banana"
 */
import { fdcApi } from '../src/lib/usda/fdc-api';

async function main() {
    console.log('\n=== FDC API BANANA SEARCH ===\n');

    try {
        const results = await fdcApi.searchFoods({ query: 'banana', pageSize: 10 });

        if (results?.foods?.length) {
            console.log(`Found ${results.foods.length} results:\n`);
            for (let i = 0; i < results.foods.length; i++) {
                const food = results.foods[i];
                console.log(`${i + 1}. [${food.dataType}] "${food.description}"${food.brandName ? ` (${food.brandName})` : ''}`);
            }
        } else {
            console.log('No results returned');
            console.log('Raw response:', JSON.stringify(results, null, 2));
        }
    } catch (err) {
        console.error('Error:', err);
    }
}

main().finally(() => process.exit(0));
