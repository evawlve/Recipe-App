/**
 * Debug serving selection step by step V2
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';

// Copy gramsForServing logic inline to test
function gramsForServing(serving: {
    servingWeightGrams: number | null;
    metricServingAmount: number | null;
    metricServingUnit: string | null;
}): number | null {
    if (serving.servingWeightGrams && serving.servingWeightGrams > 0) {
        return serving.servingWeightGrams;
    }
    if (serving.metricServingUnit?.toLowerCase() === 'g' && serving.metricServingAmount) {
        return serving.metricServingAmount;
    }
    if (serving.metricServingUnit?.toLowerCase() === 'ml' && serving.metricServingAmount) {
        return serving.metricServingAmount;
    }
    return null;
}

async function main() {
    console.log('=== Debug Serving Selection ===\n');

    const food = await prisma.fatSecretFoodCache.findFirst({
        where: { id: '3913554' },
        include: { servings: true }
    });

    if (!food) {
        console.log('Food not found');
        return;
    }

    console.log('Food:', food.name);
    console.log('nutrientsPer100g:', JSON.stringify(food.nutrientsPer100g));

    console.log('\nServings:');
    for (const s of food.servings) {
        const grams = gramsForServing({
            servingWeightGrams: s.servingWeightGrams,
            metricServingAmount: s.metricServingAmount,
            metricServingUnit: s.metricServingUnit,
        });

        console.log(`  "${s.measurementDescription}"`);
        console.log(`    metricServingAmount: ${s.metricServingAmount}`);
        console.log(`    metricServingUnit: ${s.metricServingUnit}`);
        console.log(`    servingWeightGrams: ${s.servingWeightGrams}`);
        console.log(`    gramsForServing result: ${grams}`);
        console.log(`    VALID?: ${grams != null && grams > 0}`);
    }
}

main()
    .then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1); });
