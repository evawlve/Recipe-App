/**
 * Debug why these specific ingredients are failing mapping
 */
import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

const failedInputs = [
    "0.5 tsp buttery cinnamon powder",
    "0.75 cup sugar free cherry pie filling",
    "6 oz vegetarian mince",
    "0.6666666666666666 tbsp burger relish",
    "14 oz plum tomatoes",
    "1 cup or ripe cherry tomatoes",
];

async function main() {
    console.log("\n=== INVESTIGATING FAILED MAPPINGS ===\n");

    for (const input of failedInputs) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`INPUT: "${input}"`);
        console.log('='.repeat(60));

        const result = await mapIngredientWithFallback(input, { debug: true });

        if (result) {
            console.log(`✅ MAPPED: ${result.foodName}`);
            console.log(`   Grams: ${result.grams.toFixed(1)}, Kcal: ${result.kcal.toFixed(1)}`);
        } else {
            console.log(`❌ FAILED: No mapping result`);
        }
    }

    console.log("\n=== INVESTIGATION COMPLETE ===\n");
    process.exit(0);
}

main().catch(console.error);
