/**
 * Debug flaxseed and ground beef issues
 */
import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function main() {
    // Test 1: Flaxseed meal (being matched to cocktail)
    console.log('=== Test 1: Flaxseed Meal ===');
    const flax = await mapIngredientWithFallback('0.25 cup ground golden flaxseed meal', { debug: true });
    if (flax) {
        console.log(`\n✓ Result: ${flax.foodName} (${flax.grams}g) ${flax.kcal}kcal`);
    } else {
        console.log('\n✗ FAILED');
    }

    console.log('\n\n');

    // Test 2: Ground beef (wrong grams calculation)
    console.log('=== Test 2: Ground Beef ===');
    const beef = await mapIngredientWithFallback('16 oz ground beef', { debug: true });
    if (beef) {
        console.log(`\n✓ Result: ${beef.foodName} (${beef.grams}g) ${beef.kcal}kcal`);
        // 16 oz should be about 453.6g, not 1600g
        console.log(`   Expected grams: ~453g (16 oz × 28.35)`);
    } else {
        console.log('\n✗ FAILED');
    }
}

main()
    .then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1); });
