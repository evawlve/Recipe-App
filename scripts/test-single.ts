import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { prisma } from '../src/lib/db';

async function test() {
    // Test the complex pancake mix - should trigger AI fallback
    const input = "light fluffy buttermilk pancake mix";
    console.log(`Testing: "${input}"`);

    const result = await mapIngredientWithFallback(input);

    console.log('---');
    console.log('RESULT:');
    console.log(`  Food: ${result?.foodName || 'FAILED'}`);
    console.log(`  Source: ${result?.source || 'N/A'}`);
    console.log(`  Confidence: ${result?.confidence?.toFixed(2) || 'N/A'}`);
}

test().finally(() => prisma.$disconnect());
