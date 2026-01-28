/**
 * Detailed test with logging interception
 */
import 'dotenv/config';
import { mapIngredientWithFallback } from '../lib/fatsecret/map-ingredient-with-fallback';
import { aiSimplifyIngredient } from '../lib/fatsecret/ai-simplify';

async function main() {
    console.log("\n========================================");
    console.log("TEST 1: AI SIMPLIFY FOR BURGER RELISH");
    console.log("========================================\n");

    const simplifyResult = await aiSimplifyIngredient("0.67 tbsp burger relish");
    console.log(`AI Simplify result:`);
    console.log(`  Simplified: "${simplifyResult?.simplified}"`);
    console.log(`  Rationale: ${simplifyResult?.rationale}`);

    if (simplifyResult?.simplified) {
        console.log("\n----------------------------------------");
        console.log("TEST 2: MAP THE SIMPLIFIED TERM DIRECTLY");
        console.log("----------------------------------------\n");

        const directResult = await mapIngredientWithFallback(simplifyResult.simplified);
        console.log(`Direct mapping of "${simplifyResult.simplified}":`);
        console.log(`  Food: ${directResult?.foodName || 'FAILED'}`);
        console.log(`  Confidence: ${directResult?.confidence}`);
    }

    console.log("\n========================================");
    console.log("TEST 3: MAP ORIGINAL BURGER RELISH (FULL FLOW)");
    console.log("========================================\n");

    const fullResult = await mapIngredientWithFallback("0.67 tbsp burger relish");
    console.log(`Full pipeline result:`);
    console.log(`  Food: ${fullResult?.foodName || 'FAILED'}`);
    console.log(`  Confidence: ${fullResult?.confidence}`);
    console.log(`  Success: ${fullResult?.foodName?.toLowerCase().includes('relish') ? '✅ PASS' : '❌ FAIL'}`);

    console.log("\n✅ Tests complete\n");
    process.exit(0);
}

main().catch(e => {
    console.error("Error:", e);
    process.exit(1);
});
