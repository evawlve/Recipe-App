/**
 * Verify Audit Fixes (2026-04-02)
 *
 * Directly tests each fix from the mapping audit by running
 * mapIngredientWithFallback on the specific problematic ingredient strings
 * and asserting the resolved food / grams fall within acceptable bounds.
 */

import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

interface TestCase {
    description: string;
    ingredientLine: string;
    // The resolved food name must NOT contain any of these strings (case-insensitive)
    mustNotContain?: string[];
    // The resolved food name SHOULD contain at least one of these strings
    shouldContain?: string[];
    // Resolved grams must be below this maximum
    maxGrams?: number;
    // Resolved grams must be above this minimum
    minGrams?: number;
}

const TEST_CASES: TestCase[] = [
    // Fix 1: extra light → fat free bug
    {
        description: 'Fix 1: "extra light mayo" should NOT map to FAT FREE product',
        ingredientLine: '2 tbsp extra light mayonnaise',
        mustNotContain: ['fat free', 'fat-free', 'nonfat'],
        // Note: FatSecret may not carry exact "extra light mayo" — just verify it doesn't return fat-free
    },
    // Fix 2a: gluten semantic inversion
    {
        description: 'Fix 2a: "gluten" should NOT map to Gluten Free Oreos',
        ingredientLine: '2 tbsp gluten',
        mustNotContain: ['oreo', 'cookie', 'gluten free', 'biscuit', 'chip'],
        shouldContain: ['gluten', 'wheat'],
    },
    // Fix 2b: apple pie spice inversion
    {
        description: 'Fix 2b: "apple pie spice" should NOT map to apple pie filling or canned goods',
        ingredientLine: '1 tsp apple pie spice',
        mustNotContain: ['filling', 'canned', 'pie filling'],
        // Note: rewritten to "apple pie spice seasoning" — FatSecret may return "apple pie spice" or spice product
    },
    // Fix 3: drop micro-unit (drops of tabasco or liquid stevia)
    {
        description: 'Fix 3: "20 drops liquid stevia" should be < 5g',
        ingredientLine: '20 drops liquid stevia',
        maxGrams: 5,
    },
    // Fix 3b: second micro-unit (cooking spray duration)
    {
        description: 'Fix 3b: "0.4 second cooking spray" should be < 2g',
        ingredientLine: '0.4 second cooking spray',
        maxGrams: 2,
    },
    // Fix 4: sweetener packet routing (100g FDC → 1g seed)
    {
        description: 'Fix 4: "2 packet sweetener" should be < 10g total',
        ingredientLine: '2 packet sweetener',
        maxGrams: 10,
    },
    // Fix 4b: sucralose / splenda
    {
        description: 'Fix 4b: "1 packet sucralose sweetener" should be < 5g',
        ingredientLine: '1 packet sucralose sweetener',
        maxGrams: 5,
    },
];

async function run() {
    console.log('\n=== Audit Fix Verification (2026-04-02) ===\n');

    let passed = 0;
    let failed = 0;

    for (const tc of TEST_CASES) {
        process.stdout.write(`  ${tc.description}\n    → `);

        try {
            // Clear the specific cache entry so we're testing fresh
            await prisma.validatedMapping.deleteMany({
                where: { normalizedForm: { contains: tc.ingredientLine.slice(0, 20), mode: 'insensitive' } },
            });

            const result = await mapIngredientWithFallback(tc.ingredientLine);

            const foodName = result?.foodName ?? result?.food?.name ?? '(none)';
            const grams     = result?.grams ?? result?.servingGrams ?? 0;

            const issues: string[] = [];

            if (tc.mustNotContain) {
                for (const bad of tc.mustNotContain) {
                    if (foodName.toLowerCase().includes(bad.toLowerCase())) {
                        issues.push(`food name contains "${bad}": "${foodName}"`);
                    }
                }
            }
            if (tc.shouldContain) {
                const anyMatch = tc.shouldContain.some(s => foodName.toLowerCase().includes(s.toLowerCase()));
                if (!anyMatch) {
                    issues.push(`food name "${foodName}" doesn't match any of [${tc.shouldContain.join(', ')}]`);
                }
            }
            if (tc.maxGrams !== undefined && grams > tc.maxGrams) {
                issues.push(`grams ${grams.toFixed(2)}g exceeds max ${tc.maxGrams}g`);
            }
            if (tc.minGrams !== undefined && grams < tc.minGrams) {
                issues.push(`grams ${grams.toFixed(2)}g below min ${tc.minGrams}g`);
            }

            if (issues.length === 0) {
                console.log(`✅  PASS  food="${foodName}" grams=${grams.toFixed(2)}g`);
                passed++;
            } else {
                console.log(`❌  FAIL  food="${foodName}" grams=${grams.toFixed(2)}g`);
                for (const issue of issues) {
                    console.log(`         ⚠  ${issue}`);
                }
                failed++;
            }
        } catch (err) {
            console.log(`❌  ERROR  ${(err as Error).message}`);
            failed++;
        }

        console.log('');
    }

    console.log(`=== Results: ${passed}/${passed + failed} passed ===\n`);
    process.exit(failed > 0 ? 1 : 0);
}

run()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
