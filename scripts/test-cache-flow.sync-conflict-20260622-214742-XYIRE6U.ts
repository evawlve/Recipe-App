/**
 * Test cache flow for parsley / parsley leaves
 * Verifies that the second encounter hits the cache instead of APIs
 */
import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { prisma } from '../src/lib/db';

async function test() {
    console.log('=== Test 1: First encounter - parsley ===');
    const result1 = await mapIngredientWithFallback('1 tbsp parsley');
    console.log('Mapped:', result1?.foodName, '| ID:', result1?.foodId);

    // Check cache
    const cache1 = await prisma.validatedMapping.findFirst({
        where: { normalizedForm: { contains: 'parsley' } },
        select: { normalizedForm: true, foodName: true, usedCount: true }
    });
    console.log('Cache entry:', cache1);

    console.log('\n=== Test 2: Second encounter - parsley leaves ===');
    const result2 = await mapIngredientWithFallback('1 tbsp parsley leaves');
    console.log('Mapped:', result2?.foodName, '| ID:', result2?.foodId);

    // Check cache usage
    const cache2 = await prisma.validatedMapping.findFirst({
        where: { normalizedForm: { contains: 'parsley' } },
        select: { normalizedForm: true, foodName: true, usedCount: true }
    });
    console.log('Cache entry after 2nd call:', cache2);
    console.log('\n✅ usedCount should be > 1 if cache was hit!');
    console.log('   If usedCount = 2, the second call hit cache (no API)');
}

test().finally(() => process.exit(0));
