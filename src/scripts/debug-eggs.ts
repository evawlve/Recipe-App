// Investigate eggs vs egg inconsistency
import 'dotenv/config';
process.env.LOG_LEVEL = 'debug';

async function main() {
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient({ log: [] });

    // Clear egg mappings
    await prisma.validatedMapping.deleteMany({
        where: { rawIngredient: { contains: 'egg', mode: 'insensitive' } }
    });
    await prisma.aiNormalizeCache.deleteMany({
        where: { rawLine: { contains: 'egg', mode: 'insensitive' } }
    });
    console.log('Cleared egg mappings\n');

    // Check FatSecret cache for both "Egg" and "EGGS" foods
    console.log('=== FATSECRET CACHE ENTRIES FOR EGG ===\n');
    const eggFoods = await prisma.fatSecretFoodCache.findMany({
        where: {
            name: { contains: 'egg', mode: 'insensitive' },
            NOT: { name: { contains: 'eggplant', mode: 'insensitive' } }
        },
        include: { servings: true },
        take: 10,
    });

    for (const food of eggFoods) {
        console.log(`Food: "${food.name}" (id: ${food.id})`);
        if (food.servings.length > 0) {
            for (const s of food.servings.slice(0, 3)) {
                console.log(`  Serving: "${s.measurementDescription}" = ${s.servingWeightGrams}g`);
            }
        }
        console.log('');
    }

    await prisma.$disconnect();

    // Now test mapping
    const { mapIngredientWithFallback } = await import('../lib/fatsecret/map-ingredient-with-fallback');

    const tests = [
        '1 egg',
        '4 eggs',
        '2 eggs',
        '4 egg',
    ];

    console.log('\n=== MAPPING RESULTS ===\n');
    for (const line of tests) {
        const result = await mapIngredientWithFallback(line, { minConfidence: 0, skipFdc: true });
        if (result) {
            const numEggs = parseInt(line) || 1;
            const gramsPerEgg = result.grams / numEggs;
            console.log(`"${line}" => ${result.foodName}`);
            console.log(`  Total: ${result.grams.toFixed(1)}g, ${result.kcal.toFixed(0)}kcal`);
            console.log(`  Per egg: ${gramsPerEgg.toFixed(1)}g`);
            console.log(`  Status: ${gramsPerEgg > 60 ? '❌ TOO HEAVY' : '✅ OK'}`);
            console.log('');
        }
    }
}

main().catch(console.error);
