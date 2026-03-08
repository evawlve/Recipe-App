/**
 * Test that final sanity check rejects absurd computed values
 */
import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

const testInputs = [
    { input: "1 cup flour", desc: "Normal input" },
    { input: "50 cups flour", desc: "Large but maybe valid (catering)" },
    { input: "500 cups flour", desc: "Very large - should likely fail sanity check" },
    { input: "0 311625 cup flour", desc: "Malformed - should fail early" },
];

async function main() {
    console.log("\n=== FINAL SANITY CHECK TEST ===\n");

    for (const { input, desc } of testInputs) {
        console.log(`\n--- ${desc} ---`);
        console.log(`Input: "${input}"`);

        const result = await mapIngredientWithFallback(input, { debug: false });

        if (result) {
            console.log(`✅ Mapped to: ${result.foodName}`);
            console.log(`   Grams: ${result.grams.toFixed(1)}`);
            console.log(`   Kcal: ${result.kcal.toFixed(1)}`);
        } else {
            console.log(`❌ Rejected (no result) - as expected for absurd values`);
        }
    }

    console.log("\n=== TEST COMPLETE ===\n");
    process.exit(0);
}

main().catch(console.error);
