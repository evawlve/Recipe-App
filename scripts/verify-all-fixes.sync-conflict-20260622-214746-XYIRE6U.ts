#!/usr/bin/env tsx
import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function test() {
    console.log('=== Final Verification ===\n');

    const tests = [
        "1 onion",
        "0.5 tsp pepper sauce",
        "2 cup nonfat milk"
    ];

    for (const item of tests) {
        console.log(`Testing: "${item}"`);
        const result = await mapIngredientWithFallback(item);
        if (result) {
            console.log(`  ✓ Mapped to: "${result.foodName}"`);
            if (result.brandName) console.log(`    Brand: ${result.brandName}`);
        } else {
            console.log(`  ✗ Failed to map`);
        }
        console.log('');
    }
}

test().catch(console.error);
