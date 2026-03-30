import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function run() {
    try {
        await mapIngredientWithFallback("1 package cubed tofu", undefined, { skipCache: true, skipFdc: false });
        console.log("Success");
    } catch (err) {
        console.error("CAUGHT ERROR:", err.stack || err.message || err);
    }
}

run().catch(console.error);
