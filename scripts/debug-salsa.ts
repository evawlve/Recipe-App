#!/usr/bin/env npx tsx

import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { FatSecretClient } from '../src/lib/fatsecret/client';

async function main() {
    const client = new FatSecretClient();
    const query = 'tomato salsa';

    console.log('=== FatSecret search for "tomato salsa" ===');
    const results = await client.searchFoodsV4(query, { maxResults: 10 });
    results.forEach((r, i) => {
        console.log(`${i + 1}. [${r.id}] ${r.name}${r.brandName ? ` (${r.brandName})` : ''}`);
    });

    console.log('\n=== Mapping "2 tbsp tomato salsa" ===');
    const result = await mapIngredientWithFallback('2 tbsp tomato salsa', { debug: true });

    if (result) {
        console.log('\n✓ RESULT:');
        console.log('  Food:', result.foodName);
        console.log('  Food ID:', result.foodId);
        console.log('  Grams:', result.grams);
    }
}

main().catch(console.error);
