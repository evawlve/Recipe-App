/**
 * Debug script to check serving cache for failed ingredients
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    // Foods to check based on the mapping summary failures
    const foodsToCheck = [
        { name: 'Quick Oats (Fresh & Easy)', id: '36451' },      // Failed in summary line 20
        { name: 'Honey', id: '39536' },                          // Failed in summary line 53
        { name: 'Quick Oats (Quaker)', id: '4358509' },          // Debug found this winner
        { name: 'Beef Franks (Vienna Beef)', id: '90452' },      // High weight concern
    ];

    for (const food of foodsToCheck) {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`Checking: ${food.name} (ID: ${food.id})`);
        console.log('='.repeat(60));

        // Check FatSecret food cache
        const fsFood = await prisma.fatSecretFoodCache.findUnique({
            where: { id: food.id }
        });

        if (fsFood) {
            console.log('\nFood Cache Entry:');
            console.log(`  Name: ${fsFood.name}`);
            console.log(`  kcal/100g: ${fsFood.caloriesPer100g}`);
            console.log(`  Protein: ${fsFood.proteinPer100g}, Carbs: ${fsFood.carbsPer100g}, Fat: ${fsFood.fatPer100g}`);
        } else {
            console.log('\n  ⚠️  Food NOT in cache');
        }

        // Check servings
        const servings = await prisma.fatSecretServingCache.findMany({
            where: { foodId: food.id }
        });

        if (servings.length > 0) {
            console.log(`\nServings (${servings.length} found):`);
            for (const s of servings) {
                console.log(`  - ${s.description}: ${s.metricServingAmount}${s.metricServingUnit} | ${s.calories}kcal`);
            }
        } else {
            console.log('\n  ⚠️  NO SERVINGS in cache');
        }

        // Check validated mapping
        const mapping = await prisma.validatedMapping.findFirst({
            where: { foodId: food.id }
        });

        if (mapping) {
            console.log(`\nValidated Mapping:`);
            console.log(`  Normalized: "${mapping.normalizedForm}"`);
            console.log(`  Confidence: ${mapping.confidence}`);
        }
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
