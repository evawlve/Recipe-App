import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function testPlumTomatoes() {
    console.log('Testing plum tomatoes mapping...\n');

    const testCases = [
        '14 oz plum tomatoes',
        'Plum Tomatoes',
        '2 plum tomato',
    ];

    for (const line of testCases) {
        console.log(`Testing: "${line}"`);
        try {
            const result = await mapIngredientWithFallback(line, { debug: false });
            if (result) {
                console.log(`  ✅ → ${result.foodName} (${result.grams.toFixed(1)}g, ${result.kcal.toFixed(0)}kcal) confidence=${result.confidence.toFixed(2)}`);
            } else {
                console.log(`  ❌ No mapping found`);
            }
        } catch (err) {
            console.log(`  ❌ Error: ${(err as Error).message}`);
        }
        console.log('');
    }
}

testPlumTomatoes().catch(console.error);
