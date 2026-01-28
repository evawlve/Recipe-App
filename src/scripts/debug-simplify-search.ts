/**
 * Test AI simplify and search for failed ingredients
 */
import 'dotenv/config';
import { aiSimplifyIngredient } from '../lib/fatsecret/ai-simplify';
import { fetchFromApi, getFatsecretClient } from '../lib/fatsecret/fatsecret-api';

const failedIngredients = [
    "buttery cinnamon powder",
    "sugar free cherry pie filling",
    "vegetarian mince",
    "burger relish",
    "plum tomatoes",
    "or ripe cherry tomatoes",
];

async function searchFoods(query: string, maxResults = 3) {
    const client = await getFatsecretClient();
    const response = await fetchFromApi(client, 'foods.search.v3', {
        search_expression: query,
        max_results: maxResults.toString(),
        include_food_attributes: 'true',
    });
    return response?.foods_search?.results?.food || [];
}

async function main() {
    console.log("\n=== TESTING AI SIMPLIFY & SEARCH ===\n");

    for (const ingredient of failedIngredients) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`INGREDIENT: "${ingredient}"`);

        // 1. Test AI Simplify
        const simplified = await aiSimplifyIngredient(ingredient);
        console.log(`  AI SIMPLIFIED: ${simplified?.simplified ?? 'NULL'}`);
        console.log(`  RATIONALE: ${simplified?.rationale ?? 'N/A'}`);

        // 2. Test search with original
        console.log(`\n  SEARCHING ORIGINAL "${ingredient}":`);
        const originalResults = await searchFoods(ingredient, 3);
        if (originalResults.length > 0) {
            originalResults.forEach((r: { food_name: string, brand_name?: string }, i: number) =>
                console.log(`    ${i + 1}. ${r.food_name} (${r.brand_name || 'Generic'})`));
        } else {
            console.log(`    NO RESULTS`);
        }

        // 3. Test search with simplified (if different)
        if (simplified?.simplified && simplified.simplified.toLowerCase() !== ingredient.toLowerCase()) {
            console.log(`\n  SEARCHING SIMPLIFIED "${simplified.simplified}":`);
            const simplifiedResults = await searchFoods(simplified.simplified, 3);
            if (simplifiedResults.length > 0) {
                simplifiedResults.forEach((r: { food_name: string, brand_name?: string }, i: number) =>
                    console.log(`    ${i + 1}. ${r.food_name} (${r.brand_name || 'Generic'})`));
            } else {
                console.log(`    NO RESULTS`);
            }
        }
    }

    console.log("\n=== TEST COMPLETE ===\n");
    process.exit(0);
}

main().catch(console.error);
