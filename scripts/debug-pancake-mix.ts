import 'dotenv/config';
import { aiSimplifyIngredient } from '../src/lib/fatsecret/ai-simplify';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { prisma } from '../src/lib/db';

async function debug() {
    const input = "4 cup dry mix light & fluffy buttermilk complete pancake mix";

    console.log('=== DEBUGGING PANCAKE MIX FALLBACK ===');
    console.log(`Input: "${input}"`);

    // Step 1: Test if aiSimplifyIngredient works directly
    console.log('\n1. Testing aiSimplifyIngredient directly...');
    const simplified = await aiSimplifyIngredient(input);
    console.log('   Simplified result:', simplified);

    if (simplified) {
        console.log(`   -> Would search for: "${simplified.simplified}"`);

        // Step 2: Test if the simplified term gets candidates
        console.log('\n2. Testing mapIngredientWithFallback with simplified term...');
        const simplifiedResult = await mapIngredientWithFallback(simplified.simplified, {
            debug: true,
            minConfidence: 0.1,
        });

        if (simplifiedResult) {
            console.log(`   ✅ Simplified term mapped to: ${simplifiedResult.foodName}`);
            console.log(`   Confidence: ${simplifiedResult.confidence}`);
        } else {
            console.log('   ❌ Simplified term also failed!');
        }
    }

    // Step 3: Test full flow
    console.log('\n3. Testing full mapIngredientWithFallback with original input...');
    const result = await mapIngredientWithFallback(input, { debug: true });

    if (result) {
        console.log(`   ✅ SUCCESS: ${result.foodName}`);
        console.log(`   Source: ${result.source}`);
        console.log(`   Confidence: ${result.confidence}`);
    } else {
        console.log('   ❌ STILL FAILED');
    }
}

debug().finally(() => prisma.$disconnect());
