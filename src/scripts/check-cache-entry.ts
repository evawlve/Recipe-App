/**
 * Check validated mapping cache and AI normalize cache for any ingredient.
 * Useful for debugging why an ingredient is getting a stale/wrong cached result.
 *
 * Usage:
 *   npx tsx src/scripts/check-cache-entry.ts "onion"
 *   npx tsx src/scripts/check-cache-entry.ts "rice vinegar" --clear
 */
import 'dotenv/config';
import { prisma } from '../lib/db';

async function main() {
    const args = process.argv.slice(2);
    const ingredient = args.find(a => !a.startsWith('--'));
    if (!ingredient) {
        console.error('Usage: npx tsx src/scripts/check-cache-entry.ts "<ingredient>" [--clear]');
        process.exit(1);
    }

    const shouldClear = args.includes('--clear');

    console.log(`\n${'='.repeat(60)}`);
    console.log(`CACHE LOOKUP: "${ingredient}"`);
    console.log('='.repeat(60));

    // 1. ValidatedMapping (exact and fuzzy)
    const validatedMappings = await prisma.validatedMapping.findMany({
        where: {
            OR: [
                { rawIngredient: { contains: ingredient, mode: 'insensitive' } },
                { normalizedForm: { contains: ingredient, mode: 'insensitive' } },
                { foodName: { contains: ingredient, mode: 'insensitive' } },
            ]
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
    });

    console.log(`\n📦 ValidatedMapping (${validatedMappings.length} entries):`);
    for (const m of validatedMappings) {
        console.log(`  "${m.rawIngredient}" → normalized: "${m.normalizedForm}"`);
        console.log(`    Food: "${m.foodName}" (ID: ${m.foodId})`);
        console.log(`    Confidence: ${m.aiConfidence}  |  Created: ${m.createdAt.toISOString().split('T')[0]}`);
    }

    // 2. AiNormalizeCache
    const aiCacheEntries = await prisma.aiNormalizeCache.findMany({
        where: {
            OR: [
                { rawLine: { contains: ingredient, mode: 'insensitive' } },
                { normalizedName: { contains: ingredient, mode: 'insensitive' } },
            ]
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
    });

    console.log(`\n🤖 AiNormalizeCache (${aiCacheEntries.length} entries):`);
    for (const e of aiCacheEntries) {
        console.log(`  "${e.rawLine}" → "${e.normalizedName}"`);
        if (e.canonicalBase) console.log(`    canonicalBase: "${e.canonicalBase}"`);
        const data = e as any;
        if (data.nutritionEstimate) {
            const n = data.nutritionEstimate as Record<string, number>;
            console.log(`    nutrition: ${n.caloriesPer100g?.toFixed(0)}kcal/100g  conf=${n.confidence?.toFixed(2)}`);
        }
    }

    // 3. IngredientFoodMap (recent mapped uses)
    const recentMaps = await prisma.ingredientFoodMap.findMany({
        where: {
            ingredient: { name: { contains: ingredient, mode: 'insensitive' } }
        },
        include: { ingredient: { select: { name: true, qty: true, unit: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
    });

    console.log(`\n🗺️  IngredientFoodMap (${recentMaps.length} recent):`);
    for (const m of recentMaps) {
        console.log(`  "${m.ingredient.qty} ${m.ingredient.unit} ${m.ingredient.name}"`);
        console.log(`    → foodId: ${m.fatsecretFoodId}  grams: ${m.fatsecretGrams}  confidence: ${m.confidence}`);
        console.log(`    source: ${m.fatsecretSource}  |  Created: ${m.createdAt.toISOString().split('T')[0]}`);
    }

    if (shouldClear) {
        console.log(`\n🗑️  CLEARING cache entries for "${ingredient}"...`);
        const deletedMappings = await prisma.validatedMapping.deleteMany({
            where: {
                OR: [
                    { rawIngredient: { contains: ingredient, mode: 'insensitive' } },
                    { normalizedForm: { contains: ingredient, mode: 'insensitive' } },
                ]
            }
        });
        const deletedNormalize = await prisma.aiNormalizeCache.deleteMany({
            where: { rawLine: { contains: ingredient, mode: 'insensitive' } }
        });
        console.log(`  Deleted ${deletedMappings.count} ValidatedMapping entries`);
        console.log(`  Deleted ${deletedNormalize.count} AiNormalizeCache entries`);
    }

    await prisma.$disconnect();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
