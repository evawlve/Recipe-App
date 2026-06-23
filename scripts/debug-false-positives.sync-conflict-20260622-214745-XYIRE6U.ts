import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { prisma } from '../src/lib/db';

const testCases = [
    { input: "1 cup almond milk", expected: "almond milk", issue: "matched candy instead of milk" },
    { input: "1.5 tbsp vegetarian egg replacer", expected: "egg replacer", issue: "matched egg (animal product)" },
    { input: "1 tomato desedded and", expected: "tomato", issue: "matched tomato juice" },
    { input: "2 green chilies", expected: "green chili", issue: "matched canned tomatoes w/ chilies" },
    { input: "2 cup low sodium chicken broth", expected: "low sodium chicken broth", issue: "matched regular broth" },
    { input: "1 tbsp miso soybean paste", expected: "miso paste", issue: "matched miso soup" },
    { input: "2 tsp mustard seeds", expected: "mustard seeds", issue: "suspicious 100g fat for 2 tsp" },
];

async function debug() {
    console.log('=== DEBUGGING FALSE POSITIVE MAPPINGS ===\n');

    for (const tc of testCases) {
        console.log('================================================================================');
        console.log(`INPUT: "${tc.input}"`);
        console.log(`ISSUE: ${tc.issue}`);
        console.log('--------------------------------------------------------------------------------');

        const result = await mapIngredientWithFallback(tc.input, { debug: true });

        if (result) {
            console.log(`\n✅ MAPPED TO: ${result.foodName}`);
            console.log(`   FoodId: ${result.foodId}`);
            console.log(`   Source: ${result.source}`);
            console.log(`   Confidence: ${result.confidence}`);
            console.log(`   Serving: ${result.servingDescription}`);
            console.log(`   Grams: ${result.grams}g`);
            console.log(`   Nutrition: ${result.kcal}kcal, P:${result.protein}g, C:${result.carbs}g, F:${result.fat}g`);

            // Check if this looks like a false positive
            const foodNameLower = result.foodName.toLowerCase();
            const inputLower = tc.input.toLowerCase();

            // Simple checks
            if (inputLower.includes('milk') && foodNameLower.includes('chocolate')) {
                console.log('   🔴 FALSE POSITIVE: Milk matched to chocolate!');
            }
            if (inputLower.includes('replacer') && foodNameLower === 'egg') {
                console.log('   🔴 FALSE POSITIVE: Egg replacer matched to actual egg!');
            }
            if (result.fat && result.fat > 50 && result.grams && result.grams < 20) {
                console.log('   🔴 SUSPICIOUS: Very high fat for small serving!');
            }
        } else {
            console.log('\n❌ MAPPING FAILED');
        }
        console.log('');
    }
}

debug().finally(() => prisma.$disconnect());
