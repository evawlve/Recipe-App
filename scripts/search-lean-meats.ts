/**
 * Search FDC and FatSecret for lean ground meat entries to see what formats exist
 */
import { FatSecretClient } from '../src/lib/fatsecret/client';
import { fdcApi } from '../src/lib/usda/fdc-api';

async function search() {
    const client = new FatSecretClient();

    const queries = [
        '90/10 ground beef',
        '90 10 ground beef',
        '93/7 ground beef',
        'lean ground beef',
        'extra lean ground beef',
        '90/10 ground pork',
        'lean ground pork',
        '93/7 ground turkey',
        'lean ground turkey',
    ];

    console.log('='.repeat(70));
    console.log('FDC SEARCH RESULTS');
    console.log('='.repeat(70));

    for (const query of queries) {
        console.log(`\n--- "${query}" ---`);
        try {
            const fdcResults = await fdcApi.searchFoods({ query, pageSize: 3 });
            if (fdcResults?.foods?.length) {
                for (const f of fdcResults.foods.slice(0, 3)) {
                    console.log(`  FDC: ${f.description} (${f.dataType})`);
                }
            } else {
                console.log('  FDC: No results');
            }
        } catch (e) {
            console.log(`  FDC Error: ${(e as Error).message}`);
        }
    }

    console.log('\n' + '='.repeat(70));
    console.log('FATSECRET SEARCH RESULTS');
    console.log('='.repeat(70));

    for (const query of queries.slice(0, 5)) {  // Just test a few
        console.log(`\n--- "${query}" ---`);
        try {
            const fsResults = await client.searchFoodsV4(query, { maxResults: 3 });
            if (fsResults.length) {
                for (const f of fsResults.slice(0, 3)) {
                    console.log(`  FS: ${f.name}${f.brandName ? ` (${f.brandName})` : ''}`);
                }
            } else {
                console.log('  FS: No results');
            }
        } catch (e) {
            console.log(`  FS Error: ${(e as Error).message}`);
        }
    }

    console.log('\n\nDone!');
    process.exit(0);
}

search();
