import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function test() {
    console.log('\n=== MAPPING TEST RESULTS ===\n');

    const testCases = ['1 banana', '1 medium banana', '1 onion', '1 medium onion', '1 mango'];

    for (const rawLine of testCases) {
        try {
            const result = await mapIngredientWithFallback(rawLine);
            if (result) {
                const status = result.grams > 50 ? '✓' : '⚠';
                console.log(`${status} "${rawLine}" → ${result.foodName} (${result.grams}g)`);
            } else {
                console.log(`✗ "${rawLine}" → FAILED`);
            }
        } catch (err) {
            console.log(`✗ "${rawLine}" → ERROR: ${(err as Error).message}`);
        }
    }

    console.log('\n');
}

test().finally(() => process.exit(0));
