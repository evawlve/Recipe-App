#!/usr/bin/env npx tsx

import 'dotenv/config';
import { FatSecretClient } from '../src/lib/fatsecret/client';
import { fdcApi } from '../src/lib/usda/fdc-api';

async function main() {
    const query = 'reduced fat colby jack cheese';
    const client = new FatSecretClient();

    console.log('=== FatSecret API Results ===');
    console.log(`Query: "${query}"`);
    try {
        const fsResults = await client.searchFoodsV4(query, { maxResults: 10 });
        console.log(`Found ${fsResults.length} results:`);
        fsResults.forEach((r, i) => {
            console.log(`  ${i + 1}. [${r.id}] ${r.name}${r.brandName ? ` (${r.brandName})` : ''}`);
        });
    } catch (e) {
        console.error('FatSecret search error:', e);
    }

    console.log('\n=== FDC API Results ===');
    console.log(`Query: "${query}"`);
    try {
        const fdcResults = await fdcApi.searchFoods({ query, pageSize: 10 });
        console.log(`Found ${fdcResults.foods?.length || 0} results:`);
        fdcResults.foods?.forEach((r, i) => {
            console.log(`  ${i + 1}. [${r.fdcId}] ${r.description}${r.brandName ? ` (${r.brandName})` : ''}`);
        });
    } catch (e) {
        console.error('FDC search error:', e);
    }

    // Also try some relevant search terms
    const altQueries = [
        'colby jack cheese reduced fat',
        'colby monterey reduced fat',
        'reduced fat colby',
    ];

    for (const altQuery of altQueries) {
        console.log(`\n=== FatSecret: "${altQuery}" ===`);
        try {
            const fsResults = await client.searchFoodsV4(altQuery, { maxResults: 5 });
            fsResults.forEach((r, i) => {
                console.log(`  ${i + 1}. ${r.name}${r.brandName ? ` (${r.brandName})` : ''}`);
            });
        } catch (e) {
            console.error('Error:', e);
        }
    }
}

main().catch(console.error);
