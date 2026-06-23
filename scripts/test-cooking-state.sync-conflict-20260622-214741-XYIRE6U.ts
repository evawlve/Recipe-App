/**
 * Targeted Cooking State Tests
 * 
 * Tests the cooking state disambiguation logic in isolation before running
 * a full pilot batch import. Verifies that:
 * 1. Raw/unspecified ingredients map to raw products
 * 2. Cooked ingredients map to cooked products
 * 
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/test-cooking-state.ts
 */

import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

interface TestCase {
    input: string;
    expectCookedInName: boolean;
    description: string;
}

const TEST_CASES: TestCase[] = [
    // ============================================================
    // GRAINS & STARCHES
    // ============================================================
    { input: '4 cups quinoa', expectCookedInName: false, description: 'Quinoa (raw) - no cooking specified' },
    { input: '2 cups cooked quinoa', expectCookedInName: true, description: 'Quinoa (cooked) - explicit' },
    { input: '1 cup rice', expectCookedInName: false, description: 'Rice (raw) - no cooking specified' },
    { input: '1 cup cooked rice', expectCookedInName: true, description: 'Rice (cooked) - explicit' },
    { input: '200g pasta', expectCookedInName: false, description: 'Pasta (raw) - no cooking specified' },
    { input: '200g cooked pasta', expectCookedInName: true, description: 'Pasta (cooked) - explicit' },
    { input: '1 cup oats', expectCookedInName: false, description: 'Oats (raw) - no cooking specified' },
    { input: '1 cup cooked oatmeal', expectCookedInName: true, description: 'Oatmeal (cooked) - explicit' },

    // ============================================================
    // POULTRY
    // ============================================================
    { input: '200g chicken breast', expectCookedInName: false, description: 'Chicken breast (raw) - no cooking specified' },
    { input: '200g cooked chicken breast', expectCookedInName: true, description: 'Chicken breast (cooked) - explicit' },
    { input: '1 lb ground turkey', expectCookedInName: false, description: 'Ground turkey (raw) - no cooking specified' },
    { input: '1 lb grilled chicken thigh', expectCookedInName: true, description: 'Chicken thigh (grilled) - cooking method' },
    { input: '4 oz roasted turkey breast', expectCookedInName: true, description: 'Turkey breast (roasted) - cooking method' },

    // ============================================================
    // BEEF
    // ============================================================
    { input: '8 oz steak', expectCookedInName: false, description: 'Steak (raw) - no cooking specified' },
    { input: '8 oz grilled steak', expectCookedInName: true, description: 'Steak (grilled) - cooking method' },
    { input: '1 lb ground beef', expectCookedInName: false, description: 'Ground beef (raw) - no cooking specified' },
    { input: '1 lb cooked ground beef', expectCookedInName: true, description: 'Ground beef (cooked) - explicit' },

    // ============================================================
    // PORK
    // ============================================================
    { input: '6 oz pork chop', expectCookedInName: false, description: 'Pork chop (raw) - no cooking specified' },
    { input: '6 oz baked pork chop', expectCookedInName: true, description: 'Pork chop (baked) - cooking method' },
    { input: '4 slices bacon', expectCookedInName: false, description: 'Bacon (raw) - no cooking specified' },
    { input: '4 slices cooked bacon', expectCookedInName: true, description: 'Bacon (cooked) - explicit' },

    // ============================================================
    // SEAFOOD
    // ============================================================
    { input: '6 oz salmon fillet', expectCookedInName: false, description: 'Salmon (raw) - no cooking specified' },
    { input: '6 oz baked salmon', expectCookedInName: true, description: 'Salmon (baked) - cooking method' },
    { input: '1 lb shrimp', expectCookedInName: false, description: 'Shrimp (raw) - no cooking specified' },
    { input: '1 lb grilled shrimp', expectCookedInName: true, description: 'Shrimp (grilled) - cooking method' },

    // ============================================================
    // EGGS
    // ============================================================
    { input: '2 eggs', expectCookedInName: false, description: 'Eggs (raw) - no cooking specified' },
    { input: '2 scrambled eggs', expectCookedInName: true, description: 'Eggs (scrambled) - cooking method' },
    { input: '2 boiled eggs', expectCookedInName: true, description: 'Eggs (boiled) - cooking method' },
    { input: '2 fried eggs', expectCookedInName: true, description: 'Eggs (fried) - cooking method' },

    // ============================================================
    // LEGUMES
    // ============================================================
    { input: '1 cup black beans', expectCookedInName: false, description: 'Black beans (raw/dry) - no cooking specified' },
    { input: '1 cup cooked black beans', expectCookedInName: true, description: 'Black beans (cooked) - explicit' },
    { input: '1 cup lentils', expectCookedInName: false, description: 'Lentils (raw/dry) - no cooking specified' },
    { input: '1 cup cooked lentils', expectCookedInName: true, description: 'Lentils (cooked) - explicit' },

    // ============================================================
    // VEGETABLES
    // ============================================================
    { input: '1 medium potato', expectCookedInName: false, description: 'Potato (raw) - no cooking specified' },
    { input: '1 baked potato', expectCookedInName: true, description: 'Potato (baked) - cooking method' },
    { input: '2 cups spinach', expectCookedInName: false, description: 'Spinach (raw) - no cooking specified' },
    { input: '2 cups cooked spinach', expectCookedInName: true, description: 'Spinach (cooked) - explicit' },
];

// Cooking indicators to check in food names
const COOKING_INDICATORS = [
    'cooked', 'prepared', 'boiled', 'steamed',
    'roasted', 'grilled', 'baked', 'fried',
    'sauteed', 'sautéed', 'braised', 'stewed',
    'broiled', 'poached', 'smoked', 'pan-fried',
    'rotisserie', 'barbecued', 'bbq', 'scrambled'
];

function hasCookingIndicator(name: string): boolean {
    const lower = name.toLowerCase();
    return COOKING_INDICATORS.some(ind => lower.includes(ind));
}

async function runTests() {
    console.log('='.repeat(80));
    console.log('  COOKING STATE DISAMBIGUATION TESTS');
    console.log('='.repeat(80));
    console.log();

    let passed = 0;
    let failed = 0;
    const failures: { test: TestCase; result: any; reason: string }[] = [];

    for (const test of TEST_CASES) {
        process.stdout.write(`Testing: ${test.description}... `);

        try {
            const result = await mapIngredientWithFallback(test.input, { debug: false });

            if (!result) {
                console.log('❌ FAILED - No result');
                failed++;
                failures.push({ test, result: null, reason: 'No mapping result' });
                continue;
            }

            const foodName = result.foodName;
            const hasCooked = hasCookingIndicator(foodName);
            // Also accept isCookingEstimate flag as valid cooked indicator
            // (fallback uses raw product name + cooking conversion)
            const isCookingEstimate = (result as any).isCookingEstimate === true;

            if (test.expectCookedInName && !hasCooked && !isCookingEstimate) {
                console.log(`❌ FAILED - Expected cooked, got: "${foodName}"`);
                failed++;
                failures.push({ test, result, reason: `Expected cooked indicator in "${foodName}"` });
            } else if (!test.expectCookedInName && hasCooked) {
                console.log(`❌ FAILED - Expected raw, got: "${foodName}"`);
                failed++;
                failures.push({ test, result, reason: `Unexpected cooked indicator in "${foodName}"` });
            } else {
                console.log(`✅ PASSED → "${foodName}"`);
                passed++;
            }
        } catch (err) {
            console.log(`❌ ERROR - ${(err as Error).message}`);
            failed++;
            failures.push({ test, result: null, reason: (err as Error).message });
        }
    }

    console.log();
    console.log('='.repeat(80));
    console.log(`  RESULTS: ${passed} passed, ${failed} failed out of ${TEST_CASES.length} tests`);
    console.log('='.repeat(80));

    if (failures.length > 0) {
        console.log('\n  FAILURES:');
        failures.forEach((f, i) => {
            console.log(`  ${i + 1}. ${f.test.input}`);
            console.log(`     Expected: ${f.test.expectCookedInName ? 'cooked' : 'raw'}`);
            console.log(`     Reason: ${f.reason}`);
        });
    }

    console.log();
    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
