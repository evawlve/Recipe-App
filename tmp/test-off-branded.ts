/**
 * tmp/test-off-branded.ts
 *
 * Cache-busted test for the OpenFoodFacts integration.
 * Clears ValidatedMapping + AiNormalizeCache rows for the branded test cases,
 * then runs them fresh so OFF has a chance to win against uncached FatSecret/FDC results.
 *
 * Run: npx tsx tmp/test-off-branded.ts
 */

import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

const BRANDED_CASES = [
    '1 cup Oikos Triple Zero Vanilla Greek Yogurt',
    '2 tbsp Heinz Tomato Ketchup',
    '1 serving Kodiak Cakes Protein Pancake Mix',
];

async function clearCaches(rawLine: string) {
    // Clear ValidatedMapping rows for this ingredient (all sources)
    const vmDeleted = await prisma.validatedMapping.deleteMany({
        where: {
            rawIngredient: { contains: rawLine.replace(/^\d+\s+\w+\s+/, '').split(' ').slice(0, 3).join(' '), mode: 'insensitive' },
        },
    });

    // Clear AiNormalizeCache rows so isBranded gets re-detected fresh
    const ncDeleted = await prisma.aiNormalizeCache.deleteMany({
        where: {
            rawLine: { contains: rawLine.split(' ').slice(2, 5).join(' '), mode: 'insensitive' },
        },
    });

    console.log(`  🗑️  Cleared ${vmDeleted.count} ValidatedMapping + ${ncDeleted.count} AiNormalizeCache rows for: "${rawLine}"`);
}

async function runCase(label: string, rawLine: string) {
    const start = Date.now();
    const result = await mapIngredientWithFallback(rawLine);
    const elapsed = Date.now() - start;

    if (!result) {
        console.warn(`  ❌  ${label} → null  (${elapsed}ms)`);
        return;
    }

    const sourceBadge =
        result.source === 'openfoodfacts' ? '🟢 OFF     ' :
        result.source === 'fdc'           ? '🔵 FDC     ' :
        result.source === 'fatsecret'     ? '🟡 FatSec  ' :
                                            `⚪ ${result.source.padEnd(9)}`;

    console.log(
        `  ${sourceBadge}  "${result.foodName}"` +
        (result.brandName ? ` [${result.brandName}]` : '') + '\n' +
        `            ${result.grams.toFixed(1)}g | ${result.kcal.toFixed(0)} kcal | ` +
        `P ${result.protein.toFixed(1)}g C ${result.carbs.toFixed(1)}g F ${result.fat.toFixed(1)}g | ` +
        `conf ${(result.confidence * 100).toFixed(0)}%  (${elapsed}ms)`
    );
}

async function main() {
    console.log('\n=== OFF Cache-Busted Branded Test ===');
    console.log(`OFF_ENABLED=${process.env.OFF_ENABLED}\n`);

    console.log('── Clearing caches ──');
    for (const line of BRANDED_CASES) {
        await clearCaches(line);
    }

    console.log('\n── Fresh branded lookups ──');
    for (const line of BRANDED_CASES) {
        console.log(`\n  Query: "${line}"`);
        await runCase(line, line);
    }

    console.log('\nDone.\n');
    await prisma.$disconnect();
    process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
