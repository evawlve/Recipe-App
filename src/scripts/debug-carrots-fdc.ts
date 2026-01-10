// Debug carrots WITH FDC enabled to check FDC priority
import 'dotenv/config';
process.env.LOG_LEVEL = 'debug';

async function main() {
    const { mapIngredientWithFallback } = await import('../lib/fatsecret/map-ingredient-with-fallback');

    console.log('=== TESTING CARROTS WITH FDC ENABLED ===\n');

    const result = await mapIngredientWithFallback('2 carrots', {
        minConfidence: 0,
        skipFdc: false,  // ENABLE FDC!
        debug: true
    });

    console.log('\n=== FINAL RESULT ===');
    if (result) {
        console.log('Food:', result.foodName);
        console.log('Source:', result.source);
        console.log('Grams:', result.grams);
        console.log('Kcal:', result.kcal);
        console.log('Confidence:', result.confidence);
        console.log('Reason:', result.reason);
    } else {
        console.log('No result!');
    }
}

main().catch(console.error);
