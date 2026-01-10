// Test wine mapping after fix
process.env.LOG_LEVEL = 'error';

async function main() {
    const { mapIngredientWithFallback } = await import('../lib/fatsecret/map-ingredient-with-fallback');

    console.log('=== Testing: "1 5 fl oz serving red wine" ===\n');

    const result = await mapIngredientWithFallback('1 5 fl oz serving red wine', {
        minConfidence: 0,
        skipFdc: true,
    });

    if (result) {
        console.log(`Food: ${result.foodName}`);
        console.log(`Grams: ${result.grams.toFixed(1)}g (expected: ~147g for 5 fl oz)`);
        console.log(`Kcal: ${result.kcal.toFixed(0)} (expected: ~125 for 5 fl oz)`);
        console.log(`Serving: ${result.servingDescription}`);

        const isFixed = result.grams < 200 && result.kcal < 200;
        console.log(`\nStatus: ${isFixed ? 'FIXED ✅' : 'STILL BROKEN ❌'}`);
    } else {
        console.log('No result!');
    }
}

main().catch(console.error);
