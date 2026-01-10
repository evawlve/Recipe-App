/**
 * Debug why milk mappings are failing
 */
import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function main() {
    const testCases = [
        '1 cup unsweetened coconut milk',
        '0.5 cup almond milk vanilla',
        '0.25 cup fat free milk'
    ];

    for (const rawLine of testCases) {
        console.log('\n' + '='.repeat(60));
        console.log(`Testing: "${rawLine}"`);
        console.log('='.repeat(60));

        try {
            const result = await mapIngredientWithFallback(rawLine, { debug: true });
            if (result) {
                console.log('\n✓ SUCCESS');
                console.log(`  Food: ${result.foodName}`);
                console.log(`  Grams: ${result.grams}`);
                console.log(`  Serving: ${result.servingDescription}`);
                console.log(`  Confidence: ${result.confidence}`);
            } else {
                console.log('\n✗ FAILED: No result returned');
            }
        } catch (err) {
            console.log('\n✗ ERROR:', (err as Error).message);
        }
    }

    process.exit(0);
}

main();
