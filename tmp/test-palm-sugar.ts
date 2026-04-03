import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function main() {
    console.log("Starting test for Palm Sugar...");
    const res = await mapIngredientWithFallback('Palm Sugar');
    console.log(JSON.stringify(res, null, 2));
}main().catch(console.error);
