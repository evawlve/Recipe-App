/**
 * Phase 0 Validation: Test Recent AutoMapper Fixes
 * 
 * This script validates that the bug fixes for:
 * 1. Leanness percentages (90 lean, 93% lean)
 * 2. Protected compounds (rice vinegar, soy sauce, etc.)
 * are working correctly before implementing AI validation.
 */

import { parseIngredientLine } from '../src/lib/parse/ingredient-line';
import { buildSearchExpressions } from '../src/lib/fatsecret/map-ingredient';

type TestCase = {
    name: string;
    rawLine: string;
    shouldInclude: string[];
    shouldNotInclude: string[];
    description: string;
};

const TEST_CASES: TestCase[] = [
    // Leanness percentage tests
    {
        name: 'Lean beef with number',
        rawLine: '16oz 90 lean ground beef',
        shouldInclude: ['90 lean ground beef', '90'],
        shouldNotInclude: ['beef'], // Should not simplify to just "beef"
        description: 'Preserves "90 lean" qualifier'
    },
    {
        name: 'Lean beef with percentage',
        rawLine: '1 lb 93% lean ground beef',
        shouldInclude: ['93% lean ground beef', '93'],
        shouldNotInclude: ['beef'], // Should not simplify to just "beef"
        description: 'Preserves "93%" qualifier'
    },
    {
        name: 'Lean beef 80/20',
        rawLine: '1 lb 80/20 ground beef',
        shouldInclude: ['ground beef'],
        shouldNotInclude: ['beef'], // Should not simplify to just "beef"
        description: 'Preserves ground beef compound (80/20 might be stripped by parser)'
    },

    // Protected compounds - vinegars
    {
        name: 'Rice vinegar',
        rawLine: '2 tbsp rice vinegar',
        shouldInclude: ['rice vinegar'],
        shouldNotInclude: ['vinegar'], // Protected compound
        description: 'Does not simplify to generic "vinegar"'
    },
    {
        name: 'Apple cider vinegar',
        rawLine: '1/4 cup apple cider vinegar',
        shouldInclude: ['apple cider vinegar'],
        shouldNotInclude: ['vinegar', 'cider'], // Protected compound
        description: 'Does not simplify to generic "vinegar" or "cider"'
    },
    {
        name: 'Balsamic vinegar',
        rawLine: '1 tbsp balsamic vinegar',
        shouldInclude: ['balsamic vinegar'],
        shouldNotInclude: ['vinegar'], // Protected compound
        description: 'Does not simplify to generic "vinegar"'
    },

    // Protected compounds - sauces
    {
        name: 'Soy sauce',
        rawLine: '2 tbsp soy sauce',
        shouldInclude: ['soy sauce'],
        shouldNotInclude: ['sauce'], // Protected compound
        description: 'Does not simplify to generic "sauce"'
    },
    {
        name: 'Fish sauce',
        rawLine: '1 tbsp fish sauce',
        shouldInclude: ['fish sauce'],
        shouldNotInclude: ['sauce'], // Protected compound
        description: 'Does not simplify to generic "sauce"'
    },

    // Protected compounds - oils
    {
        name: 'Olive oil',
        rawLine: '2 tbsp olive oil',
        shouldInclude: ['olive oil'],
        shouldNotInclude: ['oil'], // Protected compound
        description: 'Does not simplify to generic "oil"'
    },
    {
        name: 'Coconut oil',
        rawLine: '1/4 cup coconut oil',
        shouldInclude: ['coconut oil'],
        shouldNotInclude: ['oil'], // Protected compound
        description: 'Does not simplify to generic "oil"'
    },
    {
        name: 'Vegetable oil',
        rawLine: '2 tbsp vegetable oil',
        shouldInclude: ['vegetable oil'],
        shouldNotInclude: [], // Vegetable oil can also search for related oils
        description: 'Keeps "vegetable oil" together'
    },

    // Non-protected ingredients (should still work)
    {
        name: 'All-purpose flour',
        rawLine: '2 cups all-purpose flour',
        shouldInclude: ['flour'], // Should still add "flour" fallback
        shouldNotInclude: [],
        description: 'Non-protected ingredients still get generic fallbacks'
    },
    {
        name: 'Simple ingredient (salt)',
        rawLine: '1 tsp salt',
        shouldInclude: ['salt'],
        shouldNotInclude: [],
        description: 'Simple ingredients work as before'
    },
];

function runTests() {
    console.log('='.repeat(80));
    console.log('PHASE 0 VALIDATION: AutoMapper Bug Fix Tests');
    console.log('='.repeat(80));
    console.log('');

    let passed = 0;
    let failed = 0;
    const failures: { test: TestCase; issue: string }[] = [];

    for (const test of TEST_CASES) {
        const parsed = parseIngredientLine(test.rawLine);
        const expressions = buildSearchExpressions(parsed, test.rawLine);

        let testPassed = true;
        const issues: string[] = [];

        // Check shouldInclude
        for (const expected of test.shouldInclude) {
            const found = expressions.some(e => e.includes(expected));
            if (!found) {
                testPassed = false;
                issues.push(`Missing expected: "${expected}"`);
            }
        }

        // Check shouldNotInclude
        for (const unexpected of test.shouldNotInclude) {
            // Check for exact match, not just substring
            const found = expressions.includes(unexpected);
            if (found) {
                testPassed = false;
                issues.push(`Found unexpected: "${unexpected}"`);
            }
        }

        if (testPassed) {
            passed++;
            console.log(`✅ PASS: ${test.name}`);
            console.log(`   ${test.description}`);
        } else {
            failed++;
            console.log(`❌ FAIL: ${test.name}`);
            console.log(`   ${test.description}`);
            issues.forEach(issue => console.log(`   - ${issue}`));
            console.log(`   Expressions: ${JSON.stringify(expressions.slice(0, 5))}`);
            failures.push({ test, issue: issues.join('; ') });
        }
        console.log('');
    }

    console.log('='.repeat(80));
    console.log('TEST SUMMARY');
    console.log('='.repeat(80));
    console.log(`Total:  ${TEST_CASES.length}`);
    console.log(`Passed: ${passed} ✅`);
    console.log(`Failed: ${failed} ${failed > 0 ? '❌' : ''}`);
    console.log('');

    if (failures.length > 0) {
        console.log('FAILED TESTS:');
        failures.forEach(({ test, issue }) => {
            console.log(`  - ${test.name}: ${issue}`);
        });
        console.log('');
        console.log('⚠️  Some tests failed. Review the fixes before proceeding to AI validation.');
        process.exit(1);
    } else {
        console.log('✅ All tests passed! Ready to proceed with AI validation implementation.');
        process.exit(0);
    }
}

runTests();
