/**
 * Test script for ambiguous unit backfill
 */
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function main() {
    console.log('Testing ambiguous unit handling...\n');

    const testCases = [
        '1 container low fat yogurt',
        '2 scoops protein powder',
        '1 bowl cereal',
    ];

    for (const ingredient of testCases) {
        console.log(`\n======================================`);
        console.log(`Testing: "${ingredient}"`);
        console.log(`======================================`);

        try {
            const result = await mapIngredientWithFallback(ingredient);

            if (result) {
                console.log(`✅ SUCCESS`);
                console.log(`   Food: ${result.foodName}${result.brandName ? ` (${result.brandName})` : ''}`);
                console.log(`   Serving: ${result.servingDescription}`);
                console.log(`   Grams: ${result.grams}g`);
                console.log(`   Calories: ${result.kcal} kcal`);
                console.log(`   Protein: ${result.protein}g`);
                console.log(`   Carbs: ${result.carbs}g`);
                console.log(`   Fat: ${result.fat}g`);
                console.log(`   Confidence: ${(result.confidence * 100).toFixed(1)}%`);
            } else {
                console.log(`❌ FAILED - No mapping found`);
            }
        } catch (error) {
            console.log(`❌ ERROR: ${(error as Error).message}`);
        }
    }

    console.log('\n\nTest complete.');
}

main().catch(console.error);
