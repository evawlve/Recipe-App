/**
 * Debug scallions 450g issue
 */
import 'dotenv/config';
import { mapIngredientWithFallback } from '../lib/fatsecret/map-ingredient-with-fallback';

async function main() {
    console.log("\n=== SCALLIONS DEBUG ===\n");

    const result = await mapIngredientWithFallback("3 medium scallions");

    console.log(`\nResult:`);
    console.log(`  Food: ${result?.foodName}`);
    console.log(`  Food ID: ${result?.foodId}`);
    console.log(`  Grams: ${result?.grams}`);
    console.log(`  Kcal: ${result?.kcal}`);
    console.log(`  Serving: ${result?.servingDescription}`);
    console.log(`  Confidence: ${result?.confidence}`);

    // Also test with explicit unit
    console.log("\n=== WITH 'scallion' UNIT ===\n");
    const result2 = await mapIngredientWithFallback("3 scallions");
    console.log(`  Food: ${result2?.foodName}`);
    console.log(`  Grams: ${result2?.grams}`);
    console.log(`  Serving: ${result2?.servingDescription}`);

    console.log("\n✅ Done\n");
    process.exit(0);
}

main().catch(console.error);
