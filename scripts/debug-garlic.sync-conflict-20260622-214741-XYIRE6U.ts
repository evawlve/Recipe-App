/**
 * Debug script to trace garlic mapping and backfill
 */
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function main() {
    console.log('\n=== Testing Garlic Mapping ===\n');

    try {
        const result = await mapIngredientWithFallback('5 garlic', { debug: true });

        if (result) {
            console.log('\n✓ SUCCESS');
            console.log('  Food:', result.foodName);
            console.log('  Grams:', result.grams);
            console.log('  Serving:', result.servingDescription);
            console.log('  Kcal:', result.kcal);
            console.log('  Confidence:', result.confidence);
        } else {
            console.log('\n✗ FAILED - No mapping returned');
        }
    } catch (error) {
        console.error('\n✗ ERROR:', (error as Error).message);
        console.error((error as Error).stack);
    }

    process.exit(0);
}

main();
