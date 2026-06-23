import 'dotenv/config';
import { fdcApi } from '../src/lib/usda/fdc-api';

async function testFdc() {
    const queries = [
        'cheddar cheese fat free',
        'fat free cheddar',
        'nonfat cheddar cheese',
        'cherry tomatoes',
    ];

    for (const query of queries) {
        console.log(`\n=== FDC: "${query}" ===`);
        try {
            const results = await fdcApi.searchFoods({ query, pageSize: 5 });
            if (results?.foods?.length) {
                results.foods.forEach((f, i) => {
                    console.log(`  ${i + 1}. [${f.fdcId}] ${f.description} (${f.dataType})`);
                });
            } else {
                console.log('  No results');
            }
        } catch (e) {
            console.log('  Error:', (e as Error).message);
        }
    }
}

testFdc().catch(console.error);
