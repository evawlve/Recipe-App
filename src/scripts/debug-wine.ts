// Debug wine mapping to see exactly what's happening
process.env.LOG_LEVEL = 'debug';

async function main() {
    const { mapIngredientWithFallback } = await import('../lib/fatsecret/map-ingredient-with-fallback');

    console.log('=== Testing: "1 5 fl oz serving red wine" ===\n');

    const result = await mapIngredientWithFallback('1 5 fl oz serving red wine', {
        minConfidence: 0,
        skipFdc: true,
    });

    if (result) {
        console.log('\n=== FINAL RESULT ===');
        console.log(`Food: ${result.foodName}`);
        console.log(`Grams: ${result.grams}`);
        console.log(`Kcal: ${result.kcal}`);
        console.log(`Serving ID: ${result.servingId}`);
        console.log(`Food ID: ${result.foodId}`);
    } else {
        console.log('No result!');
    }
}

main().catch(console.error);
