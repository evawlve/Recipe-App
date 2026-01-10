
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

async function main() {
    const foodId = "4170803";
    const food = await prisma.fatSecretFoodCache.findUnique({
        where: { id: foodId },
        include: { servings: true }
    });

    if (!food) {
        console.log(`Food ${foodId} not in cache.`);
    } else {
        console.log(`Food ${foodId} found in cache.`);
        console.log(`Servings count: ${food.servings.length}`);
        food.servings.forEach(s => {
            console.log(`- ${s.measurementDescription || s.description} (${s.metricServingAmount} ${s.metricServingUnit})`);
        });
    }

    console.log('\nRunning Mapping Test:');
    const result = await mapIngredientWithFallback("0.25 cup fat free milk");
    if (result) {
        console.log('SUCCESS:', result.foodName, result.servingDescription, result.kcal + 'kcal');
    } else {
        console.log('FAILURE');
    }
}

main().finally(() => prisma.$disconnect());
