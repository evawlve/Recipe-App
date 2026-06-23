#!/usr/bin/env npx tsx

import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function main() {
    console.log('Verifying stberry...');
    const result = await mapIngredientWithFallback('2 cup stberry halves', { debug: true });

    if (result) {
        console.log(`Food: ${result.foodName}`);
        if (result.foodName.toLowerCase().includes('strawberr') && !result.foodName.toLowerCase().includes('smoothie')) {
            console.log('SUCCESS: Mapped to Strawberry');
        } else {
            console.log('FAILURE: Mapped to ' + result.foodName);
        }
    } else {
        console.log('FAILURE: No mapping');
    }
}

main().catch(console.error);
