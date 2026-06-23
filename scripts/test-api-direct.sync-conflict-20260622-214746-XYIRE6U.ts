import 'dotenv/config';
import { FatSecretClient } from '../src/lib/fatsecret/client';
import { fdcApi } from '../src/lib/usda/fdc-api';

async function testAPIs() {
    const query = 'fat free cheddar cheese';
    console.log(`\n=== Testing APIs with query: "${query}" ===\n`);

    // Test FDC
    console.log('--- FDC Results ---');
    try {
        const fdcResults = await fdcApi.searchFoods({ query, pageSize: 3 });
        if (fdcResults?.foods?.length) {
            fdcResults.foods.forEach((f, i) => {
                console.log(`  ${i + 1}. [${f.fdcId}] ${f.description} (${f.dataType})`);
            });
        } else {
            console.log('  No results');
        }
    } catch (e) {
        console.log('  Error:', (e as Error).message);
    }

    // Test FatSecret
    console.log('\n--- FatSecret Results ---');
    try {
        const client = new FatSecretClient();
        const fsResults = await client.searchFoodsV4(query, { maxResults: 3 });
        if (fsResults?.length) {
            fsResults.forEach((f, i) => {
                console.log(`  ${i + 1}. [${f.id}] ${f.name} (${f.brandName || 'Generic'})`);
            });
        } else {
            console.log('  No results');
        }
    } catch (e) {
        console.log('  Error:', (e as Error).message);
    }
}

testAPIs().catch(console.error);
