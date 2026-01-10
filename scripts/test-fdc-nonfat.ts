import 'dotenv/config';
import { fdcApi } from '../src/lib/usda/fdc-api';

async function testFdcQueries() {
    const queries = [
        'fat free cheddar cheese',
        'nonfat cheddar cheese',
        'cheddar cheese nonfat',  // FDC naming format
        'cheese cheddar nonfat',  // USDA format
        'cheddar nonfat',
    ];

    for (const query of queries) {
        console.log(`\n=== FDC: "${query}" ===`);
        try {
            const results = await fdcApi.searchFoods({ query, pageSize: 10 });
            if (results?.foods?.length) {
                results.foods.forEach((f, i) => {
                    const hasFatFree = f.description.toLowerCase().includes('fat free') ||
                        f.description.toLowerCase().includes('nonfat');
                    const marker = hasFatFree ? '✅' : '  ';
                    console.log(`  ${marker} ${i + 1}. [${f.fdcId}] ${f.description} (${f.dataType})`);
                });
            } else {
                console.log('  No results');
            }
        } catch (e) {
            console.log('  Error:', (e as Error).message);
        }
    }
}

testFdcQueries().catch(console.error);
