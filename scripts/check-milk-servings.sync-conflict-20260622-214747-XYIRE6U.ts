/**
 * Check servings for Fat Free Milk foods
 */
import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function main() {
    // Find Fat Free Milk from Wegmans
    const foods = await prisma.fatSecretFoodCache.findMany({
        where: { name: { contains: 'Fat Free Milk', mode: 'insensitive' } },
        take: 3,
        include: { servings: true }
    });

    for (const food of foods) {
        console.log('\nFood:', food.name, '(', food.id, ')');
        console.log('Servings:');
        for (const s of food.servings) {
            console.log('  -', s.measurementDescription, '|', s.metricServingAmount, s.metricServingUnit, '| grams:', s.servingWeightGrams);
        }
    }

    // Also check coconut milk
    console.log('\n\n--- COCONUT MILK ---');
    const coconutFoods = await prisma.fatSecretFoodCache.findMany({
        where: { name: { contains: 'Coconut Milk Unsweetened', mode: 'insensitive' } },
        take: 3,
        include: { servings: true }
    });

    for (const food of coconutFoods) {
        console.log('\nFood:', food.name, '(', food.id, ')');
        console.log('Servings:');
        for (const s of food.servings) {
            console.log('  -', s.measurementDescription, '|', s.metricServingAmount, s.metricServingUnit, '| grams:', s.servingWeightGrams);
        }
    }
}

main()
    .then(() => process.exit(0))
    .catch(e => { console.error(e); process.exit(1); });
