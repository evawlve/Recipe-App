// Test singular/plural consistency for eggs
import 'dotenv/config';
process.env.LOG_LEVEL = 'error';

async function main() {
    const { mapIngredientWithFallback } = await import('../lib/fatsecret/map-ingredient-with-fallback');

    const tests = [
        '1 egg',
        '2 eggs',
        '4 eggs',
    ];

    console.log('=== SINGULAR/PLURAL EGG TEST ===\n');

    for (const line of tests) {
        const result = await mapIngredientWithFallback(line, { minConfidence: 0, skipFdc: true });
        if (result) {
            const gramsPerEgg = result.grams / (parseFloat(line) || 1);
            console.log(`"${line}" => ${result.foodName}`);
            console.log(`  Total: ${result.grams.toFixed(1)}g, ${result.kcal.toFixed(0)}kcal`);
            console.log(`  Per egg: ${gramsPerEgg.toFixed(1)}g`);
            console.log('');
        }
    }
}

main().catch(console.error);
