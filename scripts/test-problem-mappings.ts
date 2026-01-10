/**
 * Test remaining problematic mappings
 */
import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function main() {
    const testCases = [
        '0.25 cup & 1 tbsp ground golden flaxseed meal',
        '1 serving 1 packet splenda',
        '1 green bell pepper',
        '16 oz ground beef',
    ];

    for (const rawLine of testCases) {
        console.log('\n=== Testing:', rawLine, '===');
        const result = await mapIngredientWithFallback(rawLine, { debug: false });
        if (result) {
            console.log(`  ✓ ${result.foodName} (${result.grams}g) ${result.kcal}kcal`);
        } else {
            console.log('  ✗ FAILED');
        }
    }
}

main()
    .then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1); });
