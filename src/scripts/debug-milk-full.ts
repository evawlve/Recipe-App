// Full debug of milk lowfat mapping with API call
import 'dotenv/config';
process.env.LOG_LEVEL = 'debug';

async function main() {
    const { mapIngredientWithFallback } = await import('../lib/fatsecret/map-ingredient-with-fallback');

    console.log('\n=== FULL MAPPING DEBUG: "1.5 cup milk lowfat" ===\n');

    const result = await mapIngredientWithFallback('1.5 cup milk lowfat', {
        minConfidence: 0,
        skipFdc: true,
        debug: true
    });

    console.log('\n\n=== FINAL RESULT ===');
    if (result) {
        console.log('Food:', result.foodName);
        console.log('Brand:', result.brandName);
        console.log('Confidence:', result.confidence);
        console.log('Reason:', result.reason);
    } else {
        console.log('No result!');
    }
}

main().catch(console.error);
