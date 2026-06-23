#!/usr/bin/env npx tsx
/**
 * Test remaining potential issues from the mapping log review
 */

import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

interface TestCase {
    input: string;
    description: string;
    shouldNotContain?: string[];
    shouldContain?: string[];
    maxKcalPer100g?: number;
    minProteinPer100g?: number;
    expectFailure?: boolean;
}

const testCases: TestCase[] = [
    // Issue: Whey protein with wrong macros (more carbs than protein)
    {
        input: '1 scoop whey protein',
        description: 'Whey protein should have high protein, low carbs',
        minProteinPer100g: 40,
    },
    
    // Issue: Rolled oats vs Quick oats
    {
        input: '1.5 cup rolled oats',
        description: 'Rolled oats should map to rolled/old-fashioned, not quick oats',
        shouldContain: ['rolled', 'old fashioned', 'oat'],
        shouldNotContain: ['quick', 'instant'],
    },
    
    // Issue: Vegetable fat spread → wrong product (Garden Vegetable Spread)
    {
        input: '1 oz vegetable fat spread reduced calorie',
        description: 'Should be margarine/spread, not cream cheese based dip',
        shouldNotContain: ['garden', 'hickory', 'cream cheese', 'dip'],
    },
    
    // Issue: Single cream (British term) - failed to map
    {
        input: '3 fl oz single cream',
        description: 'British "single cream" should map to light cream or half-and-half',
        shouldContain: ['cream', 'half'],
    },
    
    // Issue: "100% liquid" mapping to egg whites (very ambiguous)
    {
        input: '3 tbsp 100% liquid',
        description: 'Ambiguous "100% liquid" - verify it handles gracefully',
    },
    
    // Issue: Fat free pudding → tapioca specifically
    {
        input: '1 oz fat free pudding',
        description: 'Generic pudding should map to generic pudding, not specific tapioca',
        shouldNotContain: ['tapioca'],
    },
    
    // Issue: Dry protein → TVP (might not be intended)
    {
        input: '0.33 oz dry protein',
        description: 'Generic "dry protein" - should be protein powder or fail gracefully',
    },
];

async function main() {
    let passed = 0;
    let failed = 0;
    const results: Array<{input: string; status: string; food?: string; notes?: string}> = [];

    console.log('Testing Remaining Potential Issues');
    console.log('='.repeat(70));

    for (const testCase of testCases) {
        console.log(`\n${testCase.description}`);
        console.log(`Input: "${testCase.input}"`);

        try {
            const result = await mapIngredientWithFallback(testCase.input, { debug: false });

            if (!result) {
                if (testCase.expectFailure) {
                    console.log('  ✓ Expected no mapping (ambiguous input)');
                    passed++;
                    results.push({ input: testCase.input, status: 'PASS (no mapping expected)' });
                } else {
                    console.log('  ⚠ No mapping found');
                    results.push({ input: testCase.input, status: 'NO MAPPING', notes: 'Consider if this is acceptable' });
                }
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
                        issues.push(`Contains forbidden: "${term}"`);
                        testPassed = false;
                    }
                }
            }

            // Check shouldContain (at least one)
            if (testCase.shouldContain && testCase.shouldContain.length > 0) {
                const hasAny = testCase.shouldContain.some(term => foodNameLower.includes(term.toLowerCase()));
                if (!hasAny) {
                    issues.push(`Missing one of: ${testCase.shouldContain.join(', ')}`);
                    testPassed = false;
                }
            }

            // Check minProteinPer100g
            if (testCase.minProteinPer100g && proteinPer100g < testCase.minProteinPer100g) {
                issues.push(`Protein too low: ${proteinPer100g.toFixed(1)} < ${testCase.minProteinPer100g}`);
                testPassed = false;
            }

            // Check maxKcalPer100g
            if (testCase.maxKcalPer100g && kcalPer100g > testCase.maxKcalPer100g) {
                issues.push(`Calories too high: ${kcalPer100g.toFixed(1)} > ${testCase.maxKcalPer100g}`);
                testPassed = false;
            }

            if (testPassed) {
                console.log('  ✓ PASSED');
                passed++;
                results.push({ input: testCase.input, status: 'PASS', food: result.foodName });
            } else {
                console.log('  ✗ ISSUES:');
                for (const issue of issues) {
                    console.log(`    - ${issue}`);
                }
                failed++;
                results.push({ input: testCase.input, status: 'FAIL', food: result.foodName, notes: issues.join('; ') });
            }
        } catch (err) {
            console.log(`  ✗ ERROR: ${(err as Error).message}`);
            failed++;
            results.push({ input: testCase.input, status: 'ERROR', notes: (err as Error).message });
        }
    }

    console.log('\n' + '='.repeat(70));
    console.log('SUMMARY');
    console.log('='.repeat(70));
    console.log(`Passed: ${passed}, Failed: ${failed}`);
    
    console.log('\nResults Table:');
    console.log('-'.repeat(70));
    for (const r of results) {
        console.log(`${r.status.padEnd(10)} | ${r.input.substring(0, 30).padEnd(32)} | ${(r.food || r.notes || '').substring(0, 25)}`);
    }

    process.exit(failed > 0 ? 1 : 0);
}

main().catch(console.error);
