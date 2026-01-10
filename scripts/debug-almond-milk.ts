import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { prisma } from '../src/lib/db';

async function debug() {
    const inputs = [
        "1 cup unsweetened chocolate almond milk",
        "0.5 cup unsweetened vanilla almond milk",
    ];

    console.log('=== DEBUGGING ALMOND MILK FAILURES ===\n');

    for (const input of inputs) {
        console.log(`\n--- Testing: "${input}" ---`);

        const result = await mapIngredientWithFallback(input, { debug: true });

        if (result) {
            console.log(`  ✅ SUCCESS: ${result.foodName}`);
            console.log(`     Serving: ${result.servingDescription}`);
            console.log(`     Grams: ${result.grams}`);
        } else {
            console.log(`  ❌ FAILED`);
        }
    }

    // Also check what's in the cache for almond milk
    console.log('\n\n=== ALMOND MILK FOODS IN CACHE ===');
    const foods = await prisma.fatSecretFoodCache.findMany({
        where: { name: { contains: 'almond milk', mode: 'insensitive' } },
        select: { id: true, name: true },
        take: 5,
    });

    for (const food of foods) {
        console.log(`\nFood: ${food.name} (${food.id})`);
        const servings = await prisma.fatSecretServingCache.findMany({
            where: { foodId: food.id },
            select: { measurementDescription: true, servingWeightGrams: true, source: true }
        });
        console.log('  Servings:');
        for (const s of servings) {
            console.log(`    - ${s.measurementDescription}: ${s.servingWeightGrams}g (${s.source})`);
        }
    }
}

debug().finally(() => prisma.$disconnect());
