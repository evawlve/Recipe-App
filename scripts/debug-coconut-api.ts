/**
 * Debug full serving data for coconut milk
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { FatSecretClient } from '../src/lib/fatsecret/client';

async function main() {
    console.log('=== Checking cached serving data ===\n');

    const serving = await prisma.fatSecretServingCache.findFirst({
        where: { foodId: '3913554' }
    });

    console.log('Full serving record:');
    console.log(JSON.stringify(serving, null, 2));

    console.log('\n\n=== Fetching fresh from API ===\n');

    const client = new FatSecretClient();
    const details = await client.getFoodDetails('3913554');

    if (details) {
        console.log('Food name:', details.foodName);
        console.log('Nutrients per 100g:', details.nutrientsPer100g);
        console.log('\nServings from API:');
        for (const s of details.servings || []) {
            console.log(`  "${s.measurementDescription || s.description}"`);
            console.log(`    calories=${s.calories}, protein=${s.protein}, carbs=${s.carbohydrate}, fat=${s.fat}`);
            console.log(`    grams=${s.metricServingAmount} ${s.metricServingUnit}`);
        }
    } else {
        console.log('Failed to get details from API');
    }
}

main()
    .then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1); });
