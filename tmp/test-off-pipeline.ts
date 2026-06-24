/**
 * tmp/test-off-pipeline.ts
 *
 * Smoke test for the OpenFoodFacts integration.
 *
 * Tests three scenarios:
 *   1. BRANDED  — should prefer OFF result (isBranded=true)
 *   2. GENERIC  — should prefer FatSecret/FDC, NOT an OFF result
 *   3. REPEATED — second call for a branded ingredient should hit ValidatedMapping cache
 *
 * Run:
 *   npx tsx tmp/test-off-pipeline.ts
 *
 * Set OFF_ENABLED=true in .env before running, or the test will show that OFF
 * is skipped for generic queries (expected) but engaged for branded ones.
 */

import 'dotenv/config';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

const BRANDED_CASES = [
    '1 cup Oikos Triple Zero Vanilla Greek Yogurt',
    '2 tbsp Heinz Tomato Ketchup',
    '1 serving Kodiak Cakes Protein Pancake Mix',
];

const GENERIC_CASES = [
    '2 cups all-purpose flour',
    '1 tbsp olive oil',
    '3 large eggs',
];

async function runCase(label: string, rawLine: string) {
    const start = Date.now();
    const result = await mapIngredientWithFallback(rawLine);
    const elapsed = Date.now() - start;

    if (!result) {
        console.warn(`  ❌  ${label} → null  (${elapsed}ms)`);
        return;
    }

    const sourceBadge = result.source === 'openfoodfacts' ? '🟢 OFF' :
                        result.source === 'fdc'            ? '🔵 FDC' :
                        result.source === 'fatsecret'      ? '🟡 FS ' :
                                                             `⚪ ${result.source}`;

    console.log(
        `  ${sourceBadge}  ${label}\n` +
        `          → "${result.foodName}"` +
        (result.brandName ? ` (${result.brandName})` : '') + '\n' +
        `          ${result.grams.toFixed(1)}g | ` +
        `${result.kcal.toFixed(0)} kcal | ` +
        `P ${result.protein.toFixed(1)}g | ` +
        `C ${result.carbs.toFixed(1)}g | ` +
        `F ${result.fat.toFixed(1)}g | ` +
        `conf ${(result.confidence * 100).toFixed(0)}%  (${elapsed}ms)`
    );
}

async function main() {
    const offEnabled = process.env.OFF_ENABLED === 'true';
    console.log(`\n=== OpenFoodFacts Pipeline Smoke Test ===`);
    console.log(`OFF_ENABLED=${offEnabled} (set to "true" in .env to fully activate OFF for all queries)\n`);

    console.log('── BRANDED queries (OFF should win or at least appear) ──');
    for (const line of BRANDED_CASES) {
        await runCase(line, line);
    }

    console.log('\n── GENERIC staples (FatSecret/FDC should win, NOT OFF) ──');
    for (const line of GENERIC_CASES) {
        await runCase(line, line);
    }

    console.log('\n── REPEATED lookup (should hit ValidatedMapping cache) ──');
    const repeatLine = BRANDED_CASES[0];
    console.log(`  [1st call already ran above — running 2nd call now]`);
    await runCase(`(2nd) ${repeatLine}`, repeatLine);

    console.log('\nDone.\n');
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
