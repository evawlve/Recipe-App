/**
 * Test cherry pie filling
 */
import 'dotenv/config';
import { mapIngredientWithFallback } from '../lib/fatsecret/map-ingredient-with-fallback';

async function main() {
    console.log("\n========================================");
    console.log("TEST: SUGAR FREE CHERRY PIE FILLING");
    console.log("========================================\n");

    const result = await mapIngredientWithFallback("0.75 cup sugar free cherry pie filling");
    console.log(`Result:`);
    console.log(`  Food: ${result?.foodName || 'FAILED'}`);
    console.log(`  Confidence: ${result?.confidence}`);
    console.log(`  Grams: ${result?.grams}`);
    console.log(`  Kcal: ${result?.kcal}`);
    console.log(`  Success: ${result ? '✅ PASS' : '❌ FAIL'}`);

    console.log("\n✅ Test complete\n");
    process.exit(0);
}

main().catch(e => {
    console.error("Error:", e);
    process.exit(1);
});
