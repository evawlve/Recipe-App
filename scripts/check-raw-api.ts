#!/usr/bin/env tsx
import 'dotenv/config';
import { FatSecretClient } from '../src/lib/fatsecret/client';
import { fdcApi } from '../src/lib/usda/fdc-api';

async function checkRawApi() {
    const queries = ["onion", "fat free pudding", "lemon zest"];
    const fsClient = new FatSecretClient();

    console.log('=== Raw API Results Verification ===\n');

    for (const q of queries) {
        console.log(`\n🔎 Query: "${q}"`);

        // FatSecret
        console.log('--- FatSecret Top 5 ---');
        try {
            const fsResults = await fsClient.searchFoodsV4(q, { maxResults: 5 });
            fsResults.forEach((f, i) => {
                console.log(`  ${i + 1}. ${f.name} (${f.brandName || 'Generic'}) [${f.foodType}]`);
            });
        } catch (e) {
            console.error('FS Error:', e);
        }

        // FDC
        console.log('--- FDC Top 5 ---');
        try {
            const fdcResults = await fdcApi.searchFoods({ query: q, pageSize: 5 });
            if (fdcResults && fdcResults.foods) {
                fdcResults.foods.forEach((f: any, i: number) => {
                    console.log(`  ${i + 1}. ${f.description} (${f.brandOwner || f.brandName || 'Generic'})`);
                });
            } else {
                console.log('  (No results)');
            }
        } catch (e) {
            console.error('FDC Error:', e);
        }
    }
}

checkRawApi().catch(console.error);
