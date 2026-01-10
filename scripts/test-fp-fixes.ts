#!/usr/bin/env tsx
import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

const testCases = [
    // Issue 1: Simple ingredient shouldn't match branded products
    "1 onion",           // Should NOT match "Blazing Bagels Onion"

    // Issue 2: Required modifiers should be enforced
    "1 cup lowfat milk", // Should match lowfat milk, NOT whole milk
    "1 cup skim milk",   // Should match skim milk

    // Normal cases (regression check)
    "1 cup milk",        // Should match regular milk (no modifier)
    "1 chicken breast",
];

async function test() {
    console.log('=== Testing False Positive Fixes ===\n');

    for (const ingredient of testCases) {
        console.log(`Testing: "${ingredient}"`);
        const result = await mapIngredientWithFallback(ingredient);

        if (result) {
            console.log(`  ✓ Mapped to: "${result.foodName}"`);
            if (result.brandName) {
                console.log(`    Brand: ${result.brandName}`);
            }
        } else {
            console.log(`  ✗ Failed to map`);
        }
        console.log('');
    }
}

test().catch(console.error);
