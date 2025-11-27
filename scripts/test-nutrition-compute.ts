#!/usr/bin/env ts-node

import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function testNutritionCompute() {
    const recipeId = 'cmifbcr81001t10al6fxn735m';

    console.log('\n🧪 Testing Nutrition Computation...\n');

    // Import compute function
    const { computeTotals } = await import('../src/lib/nutrition/compute');

    try {
        const result = await computeTotals(recipeId);

        console.log('✅ Computation successful!');
        console.log(`\nResults:`);
        console.log(`  Calories: ${result.calories}`);
        console.log(`  Protein: ${result.proteinG}g`);
        console.log(`  Carbs: ${result.carbsG}g`);
        console.log(`  Fat: ${result.fatG}g`);
        console.log(`\nUnmapped count: ${result.unmappedCount}`);
        console.log(`Low confidence share: ${(result.lowConfidenceShare * 100).toFixed(1)}%`);

        if (result.provisional) {
            console.log(`\nProvisional: ${result.provisional.provisional}`);
            if (result.provisional.provisionalReasons.length > 0) {
                console.log(`Reasons: ${result.provisional.provisionalReasons.join(', ')}`);
            }
        }

    } catch (error) {
        console.error('❌ Computation failed:', error);
    }

    await prisma.$disconnect();
}

testNutritionCompute();
