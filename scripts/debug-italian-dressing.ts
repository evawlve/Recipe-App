import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function debug() {
    const input = "0.25 cup nonfat Italian dressing";
    const foodId = "fdc_173590";

    console.log('=== DEBUGGING ITALIAN DRESSING FAILURE ===\n');
    console.log(`Input: "${input}"`);
    console.log(`FDC Food ID: ${foodId}\n`);

    // Check if this food is in cache
    console.log('--- CACHE CHECK ---');
    const cached = await prisma.fatSecretFoodCache.findUnique({
        where: { id: foodId },
        select: { id: true, name: true, nutrientsPer100g: true }
    });

    if (cached) {
        console.log(`Found in cache: ${cached.name}`);
        console.log(`Has nutrition: ${!!cached.nutrientsPer100g}`);

        const servings = await prisma.fatSecretServingCache.findMany({
            where: { foodId },
            select: {
                id: true,
                measurementDescription: true,
                servingWeightGrams: true,
                metricServingAmount: true,
                metricServingUnit: true,
                source: true
            }
        });

        console.log(`\nServings (${servings.length}):`);
        for (const s of servings) {
            console.log(`  - ${s.measurementDescription}: ${s.servingWeightGrams}g (metric: ${s.metricServingAmount} ${s.metricServingUnit}) [${s.source}]`);
        }
    } else {
        console.log('NOT in cache!');
    }

    // Try mapping again to see detailed logs
    console.log('\n--- MAPPING ATTEMPT ---');
    const result = await mapIngredientWithFallback(input, { debug: true });

    if (result) {
        console.log(`\n✅ SUCCESS: ${result.foodName}`);
        console.log(`   Serving: ${result.servingDescription}`);
        console.log(`   Grams: ${result.grams}`);
    } else {
        console.log('\n❌ STILL FAILED');
    }
}

debug().finally(() => prisma.$disconnect());
