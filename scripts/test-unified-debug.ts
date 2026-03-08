/**
 * Debug test for unified pipeline - capture actual errors
 */
import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { prisma } from '../src/lib/db';

async function test() {
    console.log('='.repeat(60));
    console.log('DEBUG: UNIFIED PIPELINE');
    console.log('='.repeat(60));

    const testCase = '1 tsp vanilla extract';
    console.log(`\nTesting: "${testCase}"`);
    console.log('─'.repeat(60));

    try {
        const result = await mapIngredientWithFallback(testCase, { debug: true });

        console.log('\nRaw result:', JSON.stringify(result, null, 2));

        if (result) {
            console.log(`\n✅ SUCCESS`);
            console.log(`   foodId: ${result.foodId}`);
            console.log(`   foodName: ${result.foodName}`);
            console.log(`   confidence: ${result.confidence}`);
            console.log(`   grams: ${result.grams}`);
            console.log(`   kcal: ${result.kcal}`);
            console.log(`   protein: ${result.protein}`);
            console.log(`   carbs: ${result.carbs}`);
            console.log(`   fat: ${result.fat}`);
        } else {
            console.log(`\n❌ FAILED - returned null`);
        }
    } catch (err) {
        console.log(`\n❌ ERROR: ${(err as Error).message}`);
        console.log(`Stack:\n${(err as Error).stack}`);
    }

    await prisma.$disconnect();
}

test().catch(console.error);
