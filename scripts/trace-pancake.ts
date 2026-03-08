import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { prisma } from '../src/lib/db';

// Enable more verbose logging
process.env.DEBUG = '*';

async function trace() {
    console.log('=== TRACING PANCAKE MIX MAPPING ===\n');

    // First test the simplified version directly
    const simplified = "Pancake Mix";
    console.log(`1. Testing with simplified term: "${simplified}"`);

    const result = await mapIngredientWithFallback(simplified, {
        debug: true,
        minConfidence: 0.1,
    });

    if (result) {
        console.log('\n✅ SUCCESS!');
        console.log('  Food ID:', result.foodId);
        console.log('  Food Name:', result.foodName);
        console.log('  Source:', result.source);
        console.log('  Serving:', result.servingDescription);
        console.log('  Grams:', result.servingGrams);
        console.log('  Confidence:', result.confidence);
    } else {
        console.log('\n❌ FAILED');
    }
}

trace().finally(() => prisma.$disconnect());
