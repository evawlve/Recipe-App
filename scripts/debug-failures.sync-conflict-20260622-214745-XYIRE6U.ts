import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

const FAILING_INGREDIENTS = [
    '1 5 floz serving red wine',
    '3.5 cup fire roasted tomatoes',
    '4 cup tinned tomatoes',
    '0.25 cup calorie-free pancake syrup',
    '0.5 tsp buttery cinnamon powder',
];

async function debug() {
    console.log('=== Debugging 5 Failing Ingredients ===\n');

    for (const ingredient of FAILING_INGREDIENTS) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`INPUT: "${ingredient}"`);
        console.log('='.repeat(60));

        try {
            const result = await mapIngredientWithFallback(ingredient, {
                debug: true,
                minConfidence: 0.3,
            });

            if (result) {
                console.log(`\n✅ MAPPED TO: ${result.foodName}`);
                console.log(`   Confidence: ${result.confidence}`);
                console.log(`   Grams: ${result.grams}g`);
                console.log(`   Kcal: ${result.kcal}`);
            } else {
                console.log(`\n❌ FAILED: No mapping found`);
            }
        } catch (err) {
            console.log(`\n❌ ERROR: ${(err as Error).message}`);
        }
    }

    process.exit(0);
}

debug().catch(console.error);
