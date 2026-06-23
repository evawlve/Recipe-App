/**
 * Test all ambiguous units to verify AI estimation works
 */
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function main() {
    console.log('Testing ambiguous unit handling for various units...\n');

    const testCases = [
        '1 container greek yogurt',
        '2 scoops protein powder',
        '1 bowl oatmeal',
        '1 can black beans',
        '1 bottle water',
        '1 bag spinach',
        '1 jar peanut butter',
        '1 box cereal',
        '1 pouch tuna',
        '1 carton milk',
        '1 handful almonds',
        '1 medium banana',
        '1 large apple',
    ];

    console.log('| Ingredient | Grams | Kcal | Food Name |');
    console.log('|------------|-------|------|-----------|');

    for (const ingredient of testCases) {
        try {
            const result = await mapIngredientWithFallback(ingredient);

            if (result) {
                console.log(`| ${ingredient} | ${result.grams.toFixed(0)}g | ${result.kcal.toFixed(0)} kcal | ${result.foodName} |`);
            } else {
                console.log(`| ${ingredient} | FAILED | - | - |`);
            }
        } catch (error) {
            console.log(`| ${ingredient} | ERROR | - | ${(error as Error).message.slice(0, 30)} |`);
        }
    }

    console.log('\nTest complete.');
}

main().catch(console.error);
