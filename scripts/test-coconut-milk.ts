/**
 * Test coconut milk mapping specifically
 */
import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function main() {
    console.log('Testing: "1 cup unsweetened coconut milk"');
    const result = await mapIngredientWithFallback('1 cup unsweetened coconut milk', { debug: true });

    if (result) {
        console.log('\n✓ SUCCESS');
        console.log(`  Food: ${result.foodName}`);
        console.log(`  Grams: ${result.grams}`);
        console.log(`  Kcal: ${result.kcal}`);
        console.log(`  Protein: ${result.protein}`);
        console.log(`  Carbs: ${result.carbs}`);
        console.log(`  Fat: ${result.fat}`);
        console.log(`  Confidence: ${result.confidence}`);
    } else {
        console.log('\n✗ FAILED: No result returned');
    }
}

main()
    .then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1); });
