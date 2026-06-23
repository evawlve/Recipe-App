import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { getCachedFoodWithRelations, cacheFoodToDetails } from '../src/lib/fatsecret/cache-search';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function test() {
    const input = "0.25 cup nonfat Italian dressing";

    console.log('=== FULL FLOW TEST ===\n');
    console.log(`Input: "${input}"`);

    // 1. First, verify parsing
    const parsed = parseIngredientLine(input);
    console.log(`\n1. PARSING:`);
    console.log(`   qty: ${parsed?.qty}`);
    console.log(`   unit: ${parsed?.unit}`);
    console.log(`   multiplier: ${parsed?.multiplier}`);

    // 2. Try direct mapping
    console.log(`\n2. CALLING mapIngredientWithFallback:`);

    // Clear any stale cache entries that might interfere
    await prisma.validatedMapping.deleteMany({
        where: { rawIngredient: { contains: 'Italian dressing', mode: 'insensitive' } }
    });
    console.log('   Cleared stale Italian dressing mappings');

    const result = await mapIngredientWithFallback(input, { debug: true });

    console.log('\n3. RESULT:');
    if (result) {
        console.log(`   ✅ SUCCESS`);
        console.log(`   Food: ${result.foodName}`);
        console.log(`   Serving: ${result.servingDescription}`);
        console.log(`   Grams: ${result.grams}`);
        console.log(`   kcal: ${result.kcal}`);
    } else {
        console.log(`   ❌ FAILED`);
    }
}

test().finally(() => prisma.$disconnect());
