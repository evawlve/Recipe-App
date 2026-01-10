#!/usr/bin/env npx tsx

import 'dotenv/config';
import { FatSecretClient } from '../src/lib/fatsecret/client';

async function main() {
    const client = new FatSecretClient();

    console.log('SALSA SEARCH RESULTS:');
    const results = await client.searchFoodsV4('tomato salsa', { maxResults: 5 });
    results.forEach((r, i) => {
        console.log(`${i + 1}. ${r.name}${r.brandName ? ` (${r.brandName})` : ''}`);
    });
}

main().catch(console.error);
