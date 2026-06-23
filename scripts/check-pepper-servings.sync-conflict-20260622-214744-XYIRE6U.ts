/**
 * Check serving data for Crushed Red Pepper products
 * Compare multiple FatSecret products to find best one
 */
import 'dotenv/config';
import { FatSecretClient } from '../src/lib/fatsecret/client';

async function main() {
    const client = new FatSecretClient();

    // IDs from debug output
    const ids = ['4350223', '3234251'];

    for (const id of ids) {
        console.log(`\n=== Food ID ${id} ===`);
        const food = await client.getFoodById(id);

        if (!food) {
            console.log('  Food not found');
            continue;
        }

        console.log(`Name: ${food.name}`);
        console.log(`Brand: ${food.brandName || 'Generic'}`);

        for (const s of food.servings) {
            const grams = s.metricServingAmount || s.servingWeightGrams;
            const calPer100g = grams && grams > 0 ? (s.calories / grams * 100).toFixed(0) : 'N/A';
            console.log(`  Serving: ${s.description}`);
            console.log(`    Grams: ${grams}g | Calories: ${s.calories} | Cal/100g: ${calPer100g}`);
        }
    }

    // Also search for generic "crushed red pepper"
    console.log('\n\n=== Searching for "crushed red pepper" ===');
    const results = await client.searchFoods('crushed red pepper', 10);
    console.log(`Found ${results.length} results:`);
    for (const r of results.slice(0, 5)) {
        console.log(`  - [${r.id}] ${r.name} ${r.brandName ? `(${r.brandName})` : ''}`);
        console.log(`    Per serving: ${r.servingDescription} = ${r.calories} kcal`);
    }
}

main().catch(console.error);
