/**
 * Verify all mapping audit fixes by running targeted pipeline lookups.
 * Tests the end-to-end pipeline for each critical ingredient that was failing.
 */

import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { normalizeIngredientName } from '../src/lib/fatsecret/normalization-rules';
import { prisma } from '../src/lib/db';

interface TestCase {
    raw: string;
    expectFoodContains?: string;     // Substring expected in the resolved food name
    expectFoodNotContains?: string;  // Substring that MUST NOT be in food name
    expectNotNull?: boolean;         // Must resolve (not null)
}

const TEST_CASES: TestCase[] = [
    // === P0: "sour cream" no longer injects "regular" ===
    { raw: '1 cup sour cream', expectFoodContains: 'sour cream', expectNotNull: true },
    
    // === P0: Light/lowfat modifiers now resolve ===
    { raw: '2 tbsp light sour cream', expectFoodContains: 'light', expectNotNull: true },
    { raw: '1 cup low fat cheddar cheese', expectFoodContains: 'cheddar', expectNotNull: true },
    { raw: '1 tbsp light butter', expectFoodContains: 'butter', expectNotNull: true },
    { raw: '1 cup light cream', expectFoodContains: 'cream', expectNotNull: true },
    { raw: '1 oz low fat monterey jack cheese', expectFoodContains: 'monterey', expectNotNull: true },
    
    // === P0: Red pepper → red bell pepper (not chili flakes) ===
    { raw: '1 red pepper', expectFoodContains: 'bell pepper', expectFoodNotContains: 'flake' },
    
    // === P0: Cilantro seeds → coriander ===
    { raw: '1 tsp cilantro seeds', expectFoodContains: 'coriander', expectNotNull: true },
    
    // === P0: Green beans → not Ranch Style ===
    { raw: '1 lb green beans', expectFoodNotContains: 'ranch', expectNotNull: true },
    
    // === P1: Normalization check — bare "sour cream" no longer has "regular" ===
    { raw: 'sour cream', expectFoodContains: 'sour cream', expectNotNull: true },
];

async function main() {
    console.log('\n🔍 Verifying Mapping Audit Fixes\n');
    console.log('='.repeat(70));

    let passed = 0;
    let failed = 0;

    // First, check normalization directly
    console.log('\n📝 Normalization Checks:');
    const normChecks = [
        { input: 'light sour cream', notContains: 'regular' },
        { input: 'sour cream', notContains: 'regular' },
        { input: 'red pepper', contains: 'red bell pepper' },
        { input: 'cilantro seeds', contains: 'coriander' },
        { input: 'green beans', contains: 'green string beans' },
        { input: 'crushed red pepper', notContains: 'bell' },  // Should NOT rewrite spice context
    ];

    for (const check of normChecks) {
        const result = normalizeIngredientName(check.input);
        const ok = check.contains 
            ? result.cleaned.toLowerCase().includes(check.contains)
            : !result.cleaned.toLowerCase().includes(check.notContains!);
        
        const flag = ok ? '✅' : '❌';
        console.log(`  ${flag} "${check.input}" → "${result.cleaned}"${!ok ? ` (expected ${check.contains ? `to contain "${check.contains}"` : `NOT to contain "${check.notContains}"`})` : ''}`);
        if (ok) passed++; else failed++;
    }

    // Then, run pipeline lookups
    console.log('\n📦 Pipeline Mapping Checks:');
    for (const tc of TEST_CASES) {
        try {
            const result = await mapIngredientWithFallback(tc.raw, { skipCache: true });
            
            const checks: string[] = [];
            let ok = true;

            if (tc.expectNotNull && !result) {
                ok = false;
                checks.push('expected non-null but got null');
            }

            if (result) {
                if (tc.expectFoodContains && !result.foodName.toLowerCase().includes(tc.expectFoodContains.toLowerCase())) {
                    ok = false;
                    checks.push(`expected food to contain "${tc.expectFoodContains}"`);
                }
                if (tc.expectFoodNotContains && result.foodName.toLowerCase().includes(tc.expectFoodNotContains.toLowerCase())) {
                    ok = false;
                    checks.push(`expected food NOT to contain "${tc.expectFoodNotContains}"`);
                }
            }

            const flag = ok ? '✅' : '❌';
            const foodDesc = result ? `${result.foodName}${result.brandName ? ` (${result.brandName})` : ''}` : 'NULL';
            console.log(`  ${flag} "${tc.raw}" → ${foodDesc}${!ok ? ` [${checks.join(', ')}]` : ''}`);
            
            if (ok) passed++; else failed++;
        } catch (err) {
            console.log(`  ❌ "${tc.raw}" → ERROR: ${(err as Error).message}`);
            failed++;
        }
    }

    console.log(`\n${'='.repeat(70)}`);
    console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${passed + failed} checks`);
    
    if (failed > 0) {
        console.log('\n⚠️  Some checks failed! Review the output above.\n');
        process.exitCode = 1;
    } else {
        console.log('\n✅ All checks passed!\n');
    }
}

main()
    .catch((error) => {
        console.error('Error:', error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
