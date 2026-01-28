/**
 * Test scallion fix - verify mapping produces correct weight
 */
process.env.DEBUG = '';  // Disable debug logging
import 'dotenv/config';
import { mapIngredientWithFallback } from '../lib/fatsecret/map-ingredient-with-fallback';

async function main() {
    console.log("\n=== TESTING SCALLION FIX ===\n");

    const testCases = [
        "3 medium scallions",
        "3 scallions",
        "1 large scallion",
        "5 small scallions",
    ];

    const results: { input: string; grams: number | null; status: string }[] = [];

    for (const input of testCases) {
        const result = await mapIngredientWithFallback(input);

        if (result && 'grams' in result) {
            const expectedMax = input.includes('large') ? 100 :
                input.includes('small') ? 30 : 60;
            const isGood = result.grams < expectedMax;

            results.push({
                input,
                grams: result.grams,
                status: isGood ? '✅' : '❌',
            });
        } else {
            results.push({ input, grams: null, status: '❌ No result' });
        }
    }

    // Print clean summary at the end
    console.log("\n=== RESULTS ===\n");
    for (const r of results) {
        console.log(`"${r.input}" → ${r.grams?.toFixed(1) ?? 'N/A'}g ${r.status}`);
    }

    console.log("\n✅ Done\n");
    process.exit(0);
}

main().catch(console.error);
