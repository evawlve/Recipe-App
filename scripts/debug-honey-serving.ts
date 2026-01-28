/**
 * Debug script to check serving cache for failed mappings
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const FOODS_TO_CHECK = [
    { name: 'Honey', id: '39536' },
    { name: 'Quick Rolled Oats (Fresh & Easy)', id: '634254' },
];

async function main() {

    if (servings.length === 0) {
        console.log('No servings found for foodId:', foodId);
        return;
    }

    console.log(`Found ${servings.length} servings:\n`);

    for (const s of servings) {
        console.log(`  ID: ${s.id}`);
        console.log(`    measurementDescription: "${s.measurementDescription}"`);
        console.log(`    metricServingAmount: ${s.metricServingAmount}`);
        console.log(`    metricServingUnit: "${s.metricServingUnit}"`);
        console.log(`    servingWeightGrams: ${s.servingWeightGrams}`);
        console.log(`    numberOfUnits: ${s.numberOfUnits}`);
        console.log(`    volumeMl: ${s.volumeMl}`);
        console.log(`    isVolume: ${s.isVolume}`);
        console.log(`    isDefault: ${s.isDefault}`);
        console.log('');
    }

    // Check if there's a serving with metricServingUnit = 'ml'
    const mlServing = servings.find(s => s.metricServingUnit?.toLowerCase() === 'ml');
    if (mlServing) {
        console.log('✅ Found ml serving:');
        console.log(`   ${mlServing.measurementDescription}: ${mlServing.metricServingAmount}${mlServing.metricServingUnit}`);
        console.log(`   This SHOULD be convertible to cup (240ml = 1 cup)`);
    } else {
        console.log('❌ No ml serving found - ml→cup conversion not possible');
    }

    // Export volumeToMl for the test
    const volumeToMl: Record<string, number> = {
        'ml': 1,
        'tsp': 5,
        'tbsp': 15,
        'cup': 240,
    };

    // Simulate what selectServing would see
    console.log('\n=== Simulating selectServing logic ===\n');
    console.log('Requested: 1 cup (240ml)');

    for (const s of servings) {
        const desc = (s.measurementDescription || '').toLowerCase();
        console.log(`\nChecking serving: "${s.measurementDescription}"`);

        // Check for exact cup match
        if (/\bcup\b/.test(desc)) {
            console.log('  → Exact cup match!');
            continue;
        }

        // Check metricServingUnit fallback (lines 2267-2271)
        if (s.metricServingUnit && s.metricServingAmount) {
            const metricUnit = s.metricServingUnit.toLowerCase();
            if (volumeToMl[metricUnit]) {
                const servingMl = s.metricServingAmount * volumeToMl[metricUnit];
                console.log(`  → Has metricServingUnit: ${s.metricServingAmount} ${metricUnit} = ${servingMl}ml`);
                console.log(`  → 1 cup = 240ml, conversion factor = ${240 / servingMl}`);
                console.log(`  → This SHOULD work for volume conversion!`);
            } else {
                console.log(`  → metricServingUnit "${metricUnit}" is not a volume unit`);
            }
        }
    }
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
