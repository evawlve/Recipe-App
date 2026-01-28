/**
 * Test what AI simplify returns for cherry pie filling
 */
import 'dotenv/config';
import { aiSimplifyIngredient } from '../lib/fatsecret/ai-simplify';
import { buildQueryVariants } from '../lib/fatsecret/gather-candidates';
import { parseIngredientLine } from '../lib/parse/ingredient-line';
import { normalizeIngredientName } from '../lib/fatsecret/normalization-rules';

async function main() {
    const input = "0.75 cup sugar free cherry pie filling";
    console.log(`\nInput: "${input}"\n`);

    // Check what the AI simplify returns
    console.log("=== AI Simplify Result ===");
    const simplifyResult = await aiSimplifyIngredient(input);
    console.log(`  Simplified: "${simplifyResult?.simplified}"`);
    console.log(`  Rationale: ${simplifyResult?.rationale}`);

    // Check what query variants are generated
    console.log("\n=== Query Variants (with synonym expansion) ===");
    const parsed = parseIngredientLine(input);
    const normalized = normalizeIngredientName(parsed?.name || input);
    console.log(`  Parsed name: "${parsed?.name}"`);
    console.log(`  Normalized: "${normalized}"`);
    const variants = buildQueryVariants(parsed, normalized);
    console.log(`  Variants: ${JSON.stringify(variants, null, 2)}`);

    console.log("\n✅ Done\n");
    process.exit(0);
}

main().catch(e => {
    console.error("Error:", e);
    process.exit(1);
});
