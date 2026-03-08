import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function testCacheHit() {
    // First, check if we have a cached mapping for "onion" or any simple ingredient
    const cached = await prisma.validatedMapping.findFirst({
        where: { normalizedForm: 'onion' },
        select: { rawIngredient: true, foodName: true, foodId: true }
    });

    console.log('=== NORMALIZED CACHE CHECK TEST ===');

    if (!cached) {
        console.log('No "onion" in cache. Creating one first...');
        // Map a simple onion to seed the cache
        const r = await mapIngredientWithFallback('onion');
        console.log(`Mapped "onion" -> ${r?.foodName || 'FAILED'}`);
    } else {
        console.log(`Found in cache: "${cached.rawIngredient}" -> ${cached.foodName}`);
    }

    // Now test with a variation that should hit cache via normalized form
    console.log('\nTesting: "1 cup chopped onion" (should hit cache for "onion")');
    const start = Date.now();
    const result = await mapIngredientWithFallback('1 cup chopped onion');
    const elapsed = Date.now() - start;

    console.log(`Result: ${result?.foodName || 'FAILED'}`);
    console.log(`Source: ${result?.source}`);
    console.log(`Time: ${elapsed}ms`);

    if (result?.source === 'cache') {
        console.log('✅ CACHE HIT CONFIRMED!');
    } else {
        console.log('⚠️ Did not hit cache (might have used search)');
    }
}

testCacheHit().finally(() => prisma.$disconnect());
