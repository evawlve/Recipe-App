
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function verifyFlax() {
    const inputs = ["2 tbsp flaxseed meal", "2 tbsp ground flaxseed"];
    console.log("--- Investigating Flaxseed ---");
    for (const line of inputs) {
        const result = await mapIngredientWithFallback(line, { debug: true });
        if (result) {
            console.log(`\nInput: "${line}"`);
            console.log(`Mapped: ${result.foodName} (${result.source})`);
            console.log(`Serving: ${result.servingDescription}`);
            console.log(`Grams: ${result.grams}`);
            console.log(`Kcal: ${result.kcal}`);
        }
    }
}

verifyFlax();
