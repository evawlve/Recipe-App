/**
 * Debug API candidates and scoring for product type issues
 */
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

const testCases = [
    '3 1/2 cups fire roasted tomatoes',
    '14 1/2 oz stewed tomatoes italian style',
    '2 tbsp mayonnaise extra light',
    '1 oz low fat popcorn',
];

async function main() {
    // Set log level to debug to see candidates and scoring
    process.env.LOG_LEVEL = 'debug';

    console.log('=== Debugging Product Type Issues ===\n');

    for (const ingredient of testCases) {
        console.log('─'.repeat(60));
        console.log(`\n📋 INPUT: "${ingredient}"\n`);

        try {
            const result = await mapIngredientWithFallback(ingredient);

            if (result) {
                console.log(`\n✅ FINAL RESULT:`);
                console.log(`   Food: ${result.foodName}`);
                console.log(`   Brand: ${result.brandName || '(none)'}`);
                console.log(`   Grams: ${result.grams.toFixed(1)}g`);
                console.log(`   Kcal: ${result.kcal.toFixed(0)}`);
                console.log(`   Source: ${result.source}`);
            } else {
                console.log(`\n❌ MAPPING FAILED`);
            }
        } catch (error) {
            console.log(`\n❌ ERROR: ${(error as Error).message}`);
        }

        console.log('\n');
    }
}

main().catch(console.error);
