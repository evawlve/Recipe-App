/**
 * Test the burger relish and cherry pie filling fixes with verbose logging
 */
import 'dotenv/config';
process.env.LOG_LEVEL = 'debug';
import { mapIngredientWithFallback } from '../lib/fatsecret/map-ingredient-with-fallback';

async function main() {
    console.log("\n=== TESTING BURGER RELISH FIX ===\n");
    console.log("Expected: Should trigger AI simplify fallback since initial Black Bean Burger has conf 0.80 < 0.85");
    console.log("Expected result: Pickle Relish\n");

    const burgerResult = await mapIngredientWithFallback("0.67 tbsp burger relish");
    console.log(`\n=== BURGER RELISH RESULT ===`);
    console.log(`Food: ${burgerResult?.foodName || 'FAILED'}`);
    console.log(`Confidence: ${burgerResult?.confidence}`);
    console.log(`Grams: ${burgerResult?.grams}`);
    console.log(`Kcal: ${burgerResult?.kcal}`);
    console.log(`Success: ${burgerResult?.foodName?.toLowerCase().includes('relish') ? '✅ PASS' : '❌ FAIL'}`);

    console.log("\n=== TESTING SUGAR FREE CHERRY PIE FILLING ===\n");
    console.log("Expected: Should find 'Low Calorie Cherry Pie Filling' via synonym expansion");

    const cherryResult = await mapIngredientWithFallback("0.75 cup sugar free cherry pie filling");
    console.log(`\n=== CHERRY PIE FILLING RESULT ===`);
    console.log(`Food: ${cherryResult?.foodName || 'FAILED'}`);
    console.log(`Confidence: ${cherryResult?.confidence}`);
    console.log(`Grams: ${cherryResult?.grams}`);
    console.log(`Kcal: ${cherryResult?.kcal}`);
    console.log(`Success: ${cherryResult ? '✅ PASS' : '❌ FAIL'}`);

    console.log("\n=== TEST COMPLETE ===\n");
    process.exit(0);
}

main().catch(console.error);
