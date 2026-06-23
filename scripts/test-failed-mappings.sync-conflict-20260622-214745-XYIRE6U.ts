import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function test() {
    const ingredients = ['butter', 'salted butter', 'chia seeds', 'crushed red pepper flakes'];

    for (const ing of ingredients) {
        console.log(`Testing: ${ing}`);
        try {
            const result = await mapIngredientWithFallback(ing, {
                debug: false,
                skipAiValidation: true
            });
            if (result) {
                console.log(`  ✓ ${result.foodName} (${result.confidence.toFixed(2)})`);
            } else {
                console.log(`  ✗ No match`);
            }
        } catch (e: any) {
            console.log(`  ✗ Error: ${e.message}`);
        }
    }

    process.exit(0);
}

test();
