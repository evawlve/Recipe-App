
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function investigateOats() {
    const inputs = ["1 cup oats dry"];

    console.log("=== Investigating OATS Mapping ===");

    for (const rawLine of inputs) {
        console.log(`\n\n---------------------------------`);
        console.log(`INPUT: "${rawLine}"`);

        try {
            console.log("Mapping...");
            const mapped = await mapIngredientWithFallback(rawLine, { debug: true, minConfidence: 0.1 });
            if (mapped) {
                console.log(`WINNER: [${mapped.source}] ${mapped.foodName} (ID: ${mapped.foodId})`);
                console.log(`SERVING: ${mapped.servingDescription} (${mapped.grams}g)`);
                console.log(`KCAL: ${mapped.kcal}`);
            } else {
                console.log("WINNER: NONE");
            }
        } catch (e) {
            console.error("Mapping Error:", e);
        }
    }
}

investigateOats();
