/**
 * Debug serving selection for coconut milk
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    // Get coconut milk details
    const food = await prisma.fatSecretFoodCache.findFirst({
        where: { name: { contains: 'Coconut Milk Unsweetened', mode: 'insensitive' } },
        include: { servings: true }
    });

    if (!food) {
        console.log('Food not found');
        return;
    }

    console.log('Food:', food.name);
    console.log('FoodId:', food.id);
    console.log('Nutrients per 100g:', food.nutrientsPer100g);
    console.log('\nServings:');
    for (const s of food.servings) {
        console.log('  - ID:', s.id);
        console.log('    measurementDescription:', s.measurementDescription);
        console.log('    numberOfUnits:', s.numberOfUnits);
        console.log('    metricServingAmount:', s.metricServingAmount);
        console.log('    metricServingUnit:', s.metricServingUnit);
        console.log('    servingWeightGrams:', s.servingWeightGrams);
        console.log('    volumeMl:', s.volumeMl);
        console.log('    isVolume:', s.isVolume);
        console.log('');
    }

    // Test gramsForServing logic
    console.log('\n--- gramsForServing Logic Test ---');
    for (const s of food.servings) {
        let grams: number | null = null;

        if (s.servingWeightGrams && s.servingWeightGrams > 0) {
            grams = s.servingWeightGrams;
            console.log(`Serving "${s.measurementDescription}": ${grams}g (from servingWeightGrams)`);
        } else if (s.metricServingUnit?.toLowerCase() === 'g' && s.metricServingAmount) {
            grams = s.metricServingAmount;
            console.log(`Serving "${s.measurementDescription}": ${grams}g (from metric g)`);
        } else if (s.metricServingUnit?.toLowerCase() === 'ml' && s.metricServingAmount) {
            grams = s.metricServingAmount;
            console.log(`Serving "${s.measurementDescription}": ${grams}g (from metric ml)`);
        } else {
            console.log(`Serving "${s.measurementDescription}": NULL (no grams source)`);
        }
    }
}

main()
    .then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1); });
