import { mapIngredientWithFallback } from './src/lib/fatsecret/map-ingredient-with-fallback';

async function test() {
    const inputs = ["2 large eggs", "1 medium onion", "1 dash pepper"];
    for (const input of inputs) {
        console.log(`\n\n=== DOING: ${input} ===`);
        await mapIngredientWithFallback(input);
    }
}

test().catch(console.error).finally(() => process.exit(0));
