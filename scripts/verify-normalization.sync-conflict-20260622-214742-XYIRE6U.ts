/**
 * Comprehensive test for normalization fixes
 * 
 * Tests all the issues identified in the pilot batch:
 * 1. "100% liquid" - percentage stripping
 * 2. "ice cubes ice cubes" - duplicate word deduplication  
 * 3. "all purpose flour" - hyphenated term preservation
 * 4. "liquid aminos" - proper synonym rewrite
 * 5. "single cream" - British to American translation
 */

import { normalizeIngredientName, clearRulesCache } from '../src/lib/fatsecret/normalization-rules';

// Clear cache to ensure we pick up the latest rules
clearRulesCache();

interface TestCase {
    input: string;
    expected: string;
    description: string;
}

const testCases: TestCase[] = [
    {
        input: '100% liquid',
        expected: 'liquid',
        description: 'Strip percentage patterns before generic terms'
    },
    {
        input: '3 tbsp 100% liquid',
        expected: '3 tbsp liquid',
        description: 'Percentage stripping with quantity/unit prefix'
    },
    {
        input: 'ice cubes ice cubes',
        expected: 'ice',
        description: 'Deduplicate repeated 2-word phrases, then apply synonym'
    },
    {
        input: 'egg egg',
        expected: 'egg',
        description: 'Deduplicate repeated single words'
    },
    {
        input: 'all purpose flour',
        expected: 'all-purpose flour',
        description: 'Normalize to hyphenated form (FatSecret standard)'
    },
    {
        input: 'liquid aminos',
        expected: 'bragg liquid aminos',
        description: 'Rewrite to specific product name'
    },
    {
        input: 'single cream',
        expected: 'light cream',
        description: 'British to American translation'
    },
    {
        input: 'double cream',
        expected: 'heavy cream',
        description: 'British to American translation'
    },
    {
        input: 'stberry halves',
        expected: 'strawberries',
        description: 'Fix truncated typo'
    },
    {
        input: 'ground beef',
        expected: 'ground beef 85 lean',
        description: 'Default to 85% lean for unspecified ground beef'
    },
];

let passed = 0;
let failed = 0;

console.log('='.repeat(60));
console.log('Normalization Fix Verification');
console.log('='.repeat(60));

for (const tc of testCases) {
    const result = normalizeIngredientName(tc.input);
    const actual = result.cleaned;
    const success = actual === tc.expected;

    if (success) {
        console.log(`✓ "${tc.input}" → "${actual}"`);
        passed++;
    } else {
        console.log(`✗ "${tc.input}"`);
        console.log(`  Expected: "${tc.expected}"`);
        console.log(`  Actual:   "${actual}"`);
        console.log(`  (${tc.description})`);
        failed++;
    }
}

console.log('='.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

process.exit(failed > 0 ? 1 : 0);
