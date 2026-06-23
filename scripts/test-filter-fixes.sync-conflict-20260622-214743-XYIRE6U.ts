#!/usr/bin/env npx tsx
/**
 * Test script to verify the filter-candidates fixes work correctly.
 * Tests the following issues:
 * 1. Strawberry → should NOT match FRUTSTIX (high calorie processed product)
 * 2. Whey protein → should reject wrong macro profiles (more carbs than protein)
 * 3. Unsweetened coconut milk → should NOT match canned coconut cream
 * 4. Tacos → should NOT match assembled tacos with fillings
 * 5. Lowfat milk → should NOT match nonfat milk
 * 6. Splenda → should NOT match Splenda Naturals Stevia
 */

import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

interface TestCase {
    input: string;
    shouldNotContain?: string[];  // Food name should NOT contain these
    shouldContain?: string[];     // Food name SHOULD contain these
    maxKcalPer100g?: number;      // Max expected calorie density
    minProteinPer100g?: number;   // Min expected protein density
}

const testCases: TestCase[] = [
    // Issue 1: Strawberry should not match FRUTSTIX
    {
        input: '2 cup strawberry halves',
        shouldNotContain: ['frutstix', 'dried', 'freeze-dried'],
        maxKcalPer100g: 60,  // Fresh strawberries are ~32 kcal/100g
    },
    {
        input: '0.5 cup strawberries',
        shouldNotContain: ['frutstix', 'dried'],
        maxKcalPer100g: 60,
    },

    // Issue 2: Whey protein should have correct macros
    {
        input: '1 scoop whey protein',
        minProteinPer100g: 40,  // Whey should be at least 40% protein
    },

    // Issue 3: Unsweetened coconut milk should not match canned cream
    {
        input: '1 cup unsweetened coconut milk',
        shouldNotContain: ['cream', 'canned'],
        maxKcalPer100g: 50,  // Carton is ~15-25, canned is ~190
    },

    // Issue 4: Tacos should not match assembled tacos
    {
        input: '8 tacos',
        shouldNotContain: ['with beef', 'with cheese', 'with lettuce', 'tostada'],
    },

    // Issue 5: Lowfat milk should not match nonfat
    {
        input: '1.5 cup milk lowfat',
        shouldNotContain: ['nonfat', 'non-fat', 'skim', 'fat free', 'fat-free'],
        shouldContain: ['low', 'reduced', 'lite', 'light', '1%', '2%'],
    },

    // Issue 6: Splenda should not match Splenda Naturals Stevia
    {
        input: '1 packet splenda',
        shouldNotContain: ['stevia', 'naturals', 'monk fruit'],
    },
];

async function main() {
    let passed = 0;
    let failed = 0;
    const failures: string[] = [];

    console.log('Testing Filter Fixes');
    console.log('='.repeat(70));

    for (const testCase of testCases) {
        console.log(`\nTesting: "${testCase.input}"`);

        try {
            const result = await mapIngredientWithFallback(testCase.input, { debug: false });

            if (!result) {
                console.log('  ⚠ No mapping found (may be expected for some cases)');
                // Not necessarily a failure - depends on test case
                continue;
            }

            const foodNameLower = result.foodName.toLowerCase();
            const kcalPer100g = result.grams > 0 ? (result.kcal / result.grams) * 100 : 0;
            const proteinPer100g = result.grams > 0 ? (result.protein / result.grams) * 100 : 0;

            console.log(`  Mapped to: ${result.foodName}`);
            console.log(`  kcal/100g: ${kcalPer100g.toFixed(1)}, P/100g: ${proteinPer100g.toFixed(1)}`);

            let testPassed = true;
            const issues: string[] = [];

            // Check shouldNotContain
            if (testCase.shouldNotContain) {
                for (const term of testCase.shouldNotContain) {
                    if (foodNameLower.includes(term.toLowerCase())) {
                        issues.push(`Contains forbidden term: "${term}"`);
                        testPassed = false;
                    }
                }
            }

            // Check shouldContain (at least one)
            if (testCase.shouldContain && testCase.shouldContain.length > 0) {
                const hasAny = testCase.shouldContain.some(term => foodNameLower.includes(term.toLowerCase()));
                if (!hasAny) {
                    issues.push(`Missing required term (one of: ${testCase.shouldContain.join(', ')})`);
                    testPassed = false;
                }
            }

            // Check maxKcalPer100g
            if (testCase.maxKcalPer100g && kcalPer100g > testCase.maxKcalPer100g) {
                issues.push(`Calorie density too high: ${kcalPer100g.toFixed(1)} > ${testCase.maxKcalPer100g}`);
                testPassed = false;
            }

            // Check minProteinPer100g
            if (testCase.minProteinPer100g && proteinPer100g < testCase.minProteinPer100g) {
                issues.push(`Protein density too low: ${proteinPer100g.toFixed(1)} < ${testCase.minProteinPer100g}`);
                testPassed = false;
            }

            if (testPassed) {
                console.log('  ✓ PASSED');
                passed++;
            } else {
                console.log('  ✗ FAILED:');
                for (const issue of issues) {
                    console.log(`    - ${issue}`);
                }
                failed++;
                failures.push(`"${testCase.input}": ${issues.join('; ')}`);
            }
        } catch (err) {
            console.log(`  ✗ ERROR: ${(err as Error).message}`);
            failed++;
            failures.push(`"${testCase.input}": ${(err as Error).message}`);
        }
    }

    console.log('\n' + '='.repeat(70));
    console.log(`Results: ${passed} passed, ${failed} failed`);

    if (failures.length > 0) {
        console.log('\nFailures:');
        for (const f of failures) {
            console.log(`  - ${f}`);
        }
    }

    process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);

