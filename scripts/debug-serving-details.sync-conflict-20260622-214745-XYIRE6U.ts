import 'dotenv/config';
import { getCachedFoodWithRelations, cacheFoodToDetails } from '../src/lib/fatsecret/cache-search';

async function main() {
    const cached = await getCachedFoodWithRelations('299911');
    if (!cached) {
        console.log('No cached food');
        process.exit(1);
    }

    const details = cacheFoodToDetails(cached);

    console.log('Checking hasUsableServing for each converted serving:');
    console.log('Food:', details.name);
    console.log('nutrientsPer100g:', JSON.stringify(details.nutrientsPer100g));
    console.log('');

    details.servings?.forEach((s, i) => {
        const grams = s.servingWeightGrams;
        const hasGrams = grams != null && grams > 0;
        const hasNutri = s.calories != null;
        console.log(`${i + 1}. "${s.description}"`);
        console.log(`   servingWeightGrams: ${s.servingWeightGrams}`);
        console.log(`   metricServingAmount: ${s.metricServingAmount} ${s.metricServingUnit || ''}`);
        console.log(`   calories: ${s.calories}`);
        console.log(`   USABLE: ${hasGrams && hasNutri}`);
        console.log('');
    });

    const hasUsableServing = details.servings?.some(s => {
        const grams = s.servingWeightGrams;
        return grams != null && grams > 0 && s.calories != null;
    });
    console.log('hasUsableServing:', hasUsableServing);

    process.exit(0);
}
main();
