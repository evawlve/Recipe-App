/**
 * Test script to verify canonical_base preserves nutrition modifiers
 * 
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/test-canonical-preservation.ts
 */

import 'dotenv/config';
import { aiNormalizeIngredient } from '../src/lib/fatsecret/ai-normalize';

const TEST_CASES = [
    { input: '2 cups fat free milk', expectedBase: 'fat free milk' },
    { input: '1 cup skim milk', expectedBase: 'skim milk' },
    { input: '3 tbsp reduced fat cream cheese', expectedBase: 'reduced fat cream cheese' },
    { input: '1 cup unsweetened almond milk', expectedBase: 'unsweetened almond milk' },
    { input: '4 oz sugar free pudding', expectedBase: 'sugar free pudding' },
    { input: '1 cup diced tomatoes', expectedBase: 'tomatoes' }, // Prep word should be stripped
    { input: '2 cups chopped onions', expectedBase: 'onions' }, // Prep word should be stripped
];

async function main() {
    console.log('='.repeat(60));
    console.log('Canonical Base Preservation Test');
    console.log('='.repeat(60));
    console.log();

    let passed = 0;
    let failed = 0;

    for (const testCase of TEST_CASES) {
        console.log(`Testing: "${testCase.input}"`);

        const result = await aiNormalizeIngredient(testCase.input);

        if (result.status === 'error') {
            console.log(`  ❌ Error: ${result.reason}`);
            failed++;
            continue;
        }

        const actualBase = result.canonicalBase.toLowerCase();
        const expectedBase = testCase.expectedBase.toLowerCase();

        if (actualBase === expectedBase) {
            console.log(`  ✅ canonical_base: "${result.canonicalBase}"`);
            passed++;
        } else {
            console.log(`  ❌ canonical_base: "${result.canonicalBase}" (expected: "${testCase.expectedBase}")`);
            failed++;
        }
        console.log(`     normalized_name: "${result.normalizedName}"`);
        console.log();
    }

    console.log('='.repeat(60));
    console.log(`Results: ${passed} passed, ${failed} failed`);
    console.log('='.repeat(60));

    if (failed > 0) {
        process.exit(1);
    }
}

main().catch(console.error);
