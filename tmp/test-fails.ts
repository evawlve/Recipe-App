import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function test() {
    const items = [
        "1 tsp garlic salt", // The McCormick failure was likely from a string like this but maybe the brand was appended later? Wait, the raw line in the summary was just "1 tsp garlic salt". Wait, why did the generic succeed but some fail? Let's test "1 tsp garlic salt".
        "3  peppers in adobo sauce",
        "8 tbsp omega blended cooking oil",
        "8 oz part-skim mozzarella",
        "1 cup low fat milk" // also test the AI value
    ];

    for (const item of items) {
        console.log(`\n--- Testing: ${item} ---`);
        const result = await mapIngredientWithFallback(item);
        if (result) {
            console.log(`Result => ${result.foodName} (${result.brandName || 'generic'})`);
            if (result.nutrition) {
                console.log(`Nutrition => P:${result.nutrition.protein} C:${result.nutrition.carbs} F:${result.nutrition.fat} / ${result.nutrition.perGrams}g`);
            }
            console.log(`Source => ${result.source}, Confidence => ${result.confidence}`);
        } else {
            console.log(`Result => FAILED TO MAP`);
        }
    }
}

test().catch(console.error).finally(() => process.exit(0));
