/**
 * Test the improved selectServing logic
 * Verifies: count units like "slice" don't fallback to generic serving
 */

import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { classifyUnit, isGenericServing } from '../src/lib/fatsecret/unit-type';

async function testUnitClassification() {
    console.log('=== Testing Unit Classification ===\n');

    const testUnits = [
        'slice', 'slices', 'piece', 'pieces',
        'cup', 'tbsp', 'tsp',
        'g', 'oz', 'lb',
        'tortilla', 'egg', 'medium',
    ];

    for (const unit of testUnits) {
        const type = classifyUnit(unit);
        console.log(`  ${unit}: ${type}`);
    }
}

async function testGenericServingDetection() {
    console.log('\n=== Testing Generic Serving Detection ===\n');

    const testDescriptions = [
        'serving',
        '1 serving',
        'standard serving',
        '1 slice',
        '1 cup',
        '100g',
        '1 tortilla',
    ];

    for (const desc of testDescriptions) {
        const isGeneric = isGenericServing(desc);
        console.log(`  "${desc}": ${isGeneric ? 'GENERIC' : 'specific'}`);
    }
}

async function testCapocolloScenario() {
    console.log('\n=== Testing Capocollo "3 slice" Scenario ===\n');

    // Get the servings for Capocollo (Daniele) - foodId 4445238
    const food = await prisma.fatSecretFoodCache.findUnique({
        where: { id: '4445238' },
        include: { servings: true },
    });

    if (!food) {
        console.log('  ❌ Capocollo (Daniele) not found in cache');
        return;
    }

    console.log(`  Food: ${food.name} (${food.brandName || 'generic'})`);
    console.log('  Available servings:');
    for (const s of food.servings) {
        const isGeneric = isGenericServing(s.measurementDescription || '');
        console.log(`    - "${s.measurementDescription}": ${s.servingWeightGrams}g ${isGeneric ? '[GENERIC]' : ''}`);
    }

    // Simulate what selectServing would do for "slice" unit
    const requestedUnitType = classifyUnit('slice');
    console.log(`\n  Requested unit: "slice" → type: ${requestedUnitType}`);

    // Check if any serving matches "slice"
    const hasSliceServing = food.servings.some(s => {
        const desc = (s.measurementDescription || '').toLowerCase();
        return desc.includes('slice');
    });

    // Check if any serving is count-based
    const hasCountServing = food.servings.some(s => {
        const desc = (s.measurementDescription || '').toLowerCase();
        return /\b(slice|piece|item|each)\b/i.test(desc);
    });

    console.log(`  Has slice serving: ${hasSliceServing ? 'YES' : 'NO'}`);
    console.log(`  Has any count serving: ${hasCountServing ? 'YES' : 'NO'}`);

    console.log('\n  Expected behavior:');
    if (hasSliceServing) {
        console.log('    ✅ Use the slice serving');
    } else if (hasCountServing) {
        console.log('    ⚠️ Use count-based serving as fallback');
    } else {
        console.log('    ❌ Return null - "serving = 28g" is generic, should NOT be used for "slice"');
        console.log('    → Should trigger AI backfill for count type');
    }
}

async function main() {
    await testUnitClassification();
    await testGenericServingDetection();
    await testCapocolloScenario();

    console.log('\n=== Done ===');
    await prisma.$disconnect();
}

main().catch(console.error);
