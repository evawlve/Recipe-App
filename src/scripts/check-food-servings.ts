/**
 * Look up cached serving data for a food by name.
 * Useful for debugging serving selection and unit conversions.
 *
 * Usage:
 *   npx tsx src/scripts/check-food-servings.ts "honey"
 *   npx tsx src/scripts/check-food-servings.ts "mayonnaise" --exact
 *   npx tsx src/scripts/check-food-servings.ts "chicken broth" --limit 20
 */
import 'dotenv/config';
import { prisma } from '../lib/db';

async function main() {
    const args = process.argv.slice(2);
    const foodName = args.find(a => !a.startsWith('--'));
    if (!foodName) {
        console.error('Usage: npx tsx src/scripts/check-food-servings.ts "<food name>" [--exact] [--limit N]');
        process.exit(1);
    }

    const exact = args.includes('--exact');
    const limitArg = args.indexOf('--limit');
    const limit = limitArg !== -1 ? parseInt(args[limitArg + 1] ?? '10') : 10;

    const where = exact
        ? { food: { name: { equals: foodName, mode: 'insensitive' as const } } }
        : { food: { name: { contains: foodName, mode: 'insensitive' as const } } };

    const servings = await prisma.fatSecretServingCache.findMany({
        where,
        include: {
            food: { select: { id: true, name: true, brandName: true, nutrientsPer100g: true } },
        },
        orderBy: [{ food: { name: 'asc' } }, { id: 'asc' }],
        take: limit,
    });

    if (servings.length === 0) {
        console.log(`No cached servings found for "${foodName}"${exact ? ' (exact match)' : ''}`);
        await prisma.$disconnect();
        return;
    }

    // Group by food
    const byFood = new Map<string, typeof servings>();
    for (const s of servings) {
        if (!byFood.has(s.food.id)) byFood.set(s.food.id, []);
        byFood.get(s.food.id)!.push(s);
    }

    for (const [foodId, foodServings] of byFood) {
        const food = foodServings[0].food;
        const nutrients = food.nutrientsPer100g as Record<string, number> | null;
        console.log(`\n${'='.repeat(60)}`);
        console.log(`${food.name}${food.brandName ? ` (${food.brandName})` : ''}`);
        console.log(`ID: ${foodId}`);
        if (nutrients) {
            console.log(`Per 100g: ${nutrients.calories?.toFixed(0)}kcal | P:${nutrients.protein?.toFixed(1)} C:${nutrients.carbs?.toFixed(1)} F:${nutrients.fat?.toFixed(1)}`);
        }
        console.log(`${'─'.repeat(60)}`);

        for (const s of foodServings) {
            const grams = s.servingWeightGrams ?? s.metricServingAmount ?? 0;
            const flag = (s.measurementDescription?.toLowerCase().includes('cup') && grams < 50)
                || (s.measurementDescription?.toLowerCase().includes('tbsp') && grams < 3)
                ? ' ⚠️ SUSPICIOUS'
                : '';
            console.log(`  "${s.measurementDescription}"`);
            console.log(`    grams=${grams}  numberOfUnits=${s.numberOfUnits ?? 'null'}  metricAmount=${s.metricServingAmount} ${s.metricServingUnit ?? ''}${flag}`);
            console.log(`    nutrition per 100g: from food above (servings don't store per-serving macros)`);
        }
    }

    console.log(`\nTotal: ${servings.length} serving records across ${byFood.size} foods`);
    await prisma.$disconnect();
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});
