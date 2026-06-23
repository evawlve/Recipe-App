/**
 * Simple test for salted butter mapping
 */
import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function main() {
    console.log('Testing: 2 tbsp salted butter');
    console.log('Start time:', new Date().toISOString());

    const result = await mapIngredientWithFallback('2 tbsp salted butter', {
        minConfidence: 0.5,
        skipAiValidation: true,
        debug: false,
    });

    console.log('End time:', new Date().toISOString());
    console.log('Result:', result ? { foodName: result.foodName, confidence: result.confidence } : 'null');
}

main().then(() => {
    console.log('Test complete');
    process.exit(0);
}).catch(err => {
    console.error('Error:', err);
    process.exit(1);
});
