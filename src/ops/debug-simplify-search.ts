/**
 * Test AI simplify and search for failed ingredients - writes to JSON file
 */
import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { aiSimplifyIngredient } from '../lib/fatsecret/ai-simplify';
import { FatSecretClient } from '../lib/fatsecret/client';

const failedIngredients = [
    "buttery cinnamon powder",
    "sugar free cherry pie filling",
    "vegetarian mince",
    "burger relish",
    "plum tomatoes",
    "or ripe cherry tomatoes",
];

async function main() {
    const client = new FatSecretClient();
    const results: any[] = [];

    console.log("Testing AI simplify...");

    for (const ingredient of failedIngredients) {
        const result: any = { ingredient };

        // 1. Test AI Simplify
        const simplified = await aiSimplifyIngredient(ingredient);
        result.aiSimplified = simplified?.simplified ?? null;
        result.rationale = simplified?.rationale ?? null;

        // 2. Test search with original
        const originalResults = await client.searchFoods(ingredient, { maxResults: 3 });
        result.originalSearchResults = originalResults.foods.map(f => ({
            name: f.name,
            brand: f.brandName || null
        }));

        // 3. Test search with simplified (if different)
        if (simplified?.simplified && simplified.simplified.toLowerCase() !== ingredient.toLowerCase()) {
            const simplifiedResults = await client.searchFoods(simplified.simplified, { maxResults: 3 });
            result.simplifiedSearchResults = simplifiedResults.foods.map(f => ({
                name: f.name,
                brand: f.brandName || null
            }));
        }

        results.push(result);
    }

    // Write results to file
    const outputPath = path.join(process.cwd(), 'logs', 'debug-simplify-analysis.json');
    fs.writeFileSync(outputPath, JSON.stringify(results, null, 2));
    console.log(`\nResults written to: ${outputPath}`);
    process.exit(0);
}

main().catch(console.error);
