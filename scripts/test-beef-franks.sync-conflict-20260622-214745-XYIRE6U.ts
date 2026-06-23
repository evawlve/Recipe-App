/**
 * Test selectServing directly with beef franks servings
 */
import { PrismaClient } from '@prisma/client';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function main() {
    // Clear any cached mapping
    const prisma = new PrismaClient();
    await prisma.validatedMapping.deleteMany({
        where: { normalizedForm: 'beef franks' }
    });
    console.log('Cleared cached mapping\n');

    // Now map with fresh data
    const result = await mapIngredientWithFallback('2 beef franks', {
        debug: true
    });

    if (result) {
        console.log('\n=== RESULT ===');
        console.log('Food:', result.foodName);
        console.log('Grams:', result.grams);
        console.log('Kcal:', result.kcal);
        console.log('Serving:', result.servingDescription);
        console.log('Food ID:', result.foodId);

        // Check what the expected result should be
        console.log('\n=== EXPECTED ===');
        console.log('For "2 beef franks" with a 45g "serving" default:');
        console.log('Expected grams: 90g (2 x 45g)');
        console.log('Actual grams:', result.grams);
        console.log(result.grams <= 100 ? '✅ CORRECT' : '❌ INCORRECT - still using medium');
    } else {
        console.log('FAILED - no result');
    }

    await prisma.$disconnect();
}

main().catch(console.error);
