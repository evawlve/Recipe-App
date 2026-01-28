/**
 * Direct test of AI simplify for burger relish
 */
import 'dotenv/config';
import { aiSimplifyIngredient } from '../lib/fatsecret/ai-simplify';

async function main() {
    console.log("\n=== Testing AI Simplify ===\n");

    const testCases = [
        "burger relish",
        "0.67 tbsp burger relish",
        "sugar free cherry pie filling"
    ];

    for (const input of testCases) {
        console.log(`Input: "${input}"`);
        const result = await aiSimplifyIngredient(input);
        console.log(`  Simplified: ${result?.simplified || 'NULL'}`);
        console.log(`  Rationale: ${result?.rationale || 'N/A'}\n`);
    }

    console.log("✅ Done\n");
    process.exit(0);
}

main().catch(console.error);
