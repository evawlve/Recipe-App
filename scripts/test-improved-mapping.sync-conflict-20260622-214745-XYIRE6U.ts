import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function testMapping() {
    console.log('=== TESTING IMPROVED MAPPING ===\n');

    const testCases = [
        '1 cup almond milk',
        '2 green chilies',
        '1 tomato',
        '1 tbsp miso paste',
        '1 cup cream',
    ];

    for (const ingredient of testCases) {
        console.log(`\n📝 Mapping: "${ingredient}"`);

        try {
            const result = await mapIngredientWithFallback(ingredient, { debug: false });

            if (result) {
                console.log(`   ✅ ${result.foodName}`);
                console.log(`      Source: ${result.source}, Confidence: ${result.confidence.toFixed(2)}`);
                console.log(`      Nutrition: ${result.kcal.toFixed(0)} kcal, ${result.protein.toFixed(1)}g protein`);
            } else {
                console.log(`   ❌ No mapping found`);
            }
        } catch (err) {
            console.log(`   ❌ Error: ${(err as Error).message}`);
        }
    }

    console.log('\n=== DONE ===');
}

testMapping().catch(console.error);
