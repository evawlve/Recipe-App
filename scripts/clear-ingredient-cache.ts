/**
 * Clear mapping caches for specific ingredients
 *
 * Removes ValidatedMapping, IngredientFoodMap, and AiNormalizeCache entries
 * matching a search term, so you can re-run the full pipeline without --skip-cache.
 *
 * Usage:
 *   npx tsx scripts/clear-ingredient-cache.ts "mint"
 *   npx tsx scripts/clear-ingredient-cache.ts "plum tomato" "canellini"
 */

import 'dotenv/config';
import { prisma } from '../src/lib/db';

async function clearIngredientCache(terms: string[]) {
    console.log('\n=== Clearing Ingredient-Specific Caches ===\n');
    console.log(`Search terms: ${terms.map(t => `"${t}"`).join(', ')}\n`);

    let totalValidated = 0;
    let totalFoodMap = 0;
    let totalNormCache = 0;

    for (const term of terms) {
        const termLower = term.toLowerCase();

        // ValidatedMapping — keyed on rawIngredient
        const validated = await prisma.validatedMapping.findMany({
            where: {
                OR: [
                    { rawIngredient: { contains: term } },
                    { rawIngredient: { contains: termLower } },
                ],
            },
            select: { rawIngredient: true, foodName: true },
        });
        if (validated.length > 0) {
            await prisma.validatedMapping.deleteMany({
                where: {
                    OR: [
                        { rawIngredient: { contains: term } },
                        { rawIngredient: { contains: termLower } },
                    ],
                },
            });
            console.log(`✓ ValidatedMapping [${term}]: deleted ${validated.length}`);
            validated.forEach(v => console.log(`    "${v.rawIngredient}" → ${v.foodName}`));
        } else {
            console.log(`  ValidatedMapping [${term}]: none found`);
        }
        totalValidated += validated.length;

        // Note: IngredientFoodMap entries are linked via recipeId/ingredientId — not directly
        // searchable by ingredient name. Use scripts/clear-all-mappings.ts to clear all of these,
        // or delete them via the DB if you need to clear specific recipe-level nutrition mappings.

        // AiNormalizeCache — keyed on normalizedKey / rawLine / normalizedName
        const normCache = await prisma.aiNormalizeCache.findMany({
            where: {
                OR: [
                    { normalizedKey: { contains: termLower } },
                    { rawLine: { contains: term } },
                    { rawLine: { contains: termLower } },
                    { normalizedName: { contains: term } },
                    { normalizedName: { contains: termLower } },
                ],
            },
            select: { normalizedKey: true, normalizedName: true },
        });
        if (normCache.length > 0) {
            await prisma.aiNormalizeCache.deleteMany({
                where: {
                    OR: [
                        { normalizedKey: { contains: termLower } },
                        { rawLine: { contains: term } },
                        { rawLine: { contains: termLower } },
                        { normalizedName: { contains: term } },
                        { normalizedName: { contains: termLower } },
                    ],
                },
            });
            console.log(`✓ AiNormalizeCache [${term}]: deleted ${normCache.length}`);
            normCache.forEach(n => console.log(`    "${n.normalizedKey}" (${n.normalizedName})`));
        } else {
            console.log(`  AiNormalizeCache [${term}]: none found`);
        }
        totalNormCache += normCache.length;

        console.log();
    }

    console.log('=== Summary ===');
    console.log(`  ValidatedMapping deleted : ${totalValidated}`);
    console.log(`  IngredientFoodMap deleted: ${totalFoodMap}`);
    console.log(`  AiNormalizeCache deleted : ${totalNormCache}`);
    console.log('\n✅ Done. Now run the full pipeline without --skip-cache to verify.\n');
}


const terms = process.argv.slice(2);
if (terms.length === 0) {
    console.error('Usage: npx tsx scripts/clear-ingredient-cache.ts "term1" "term2" ...');
    process.exit(1);
}

clearIngredientCache(terms)
    .catch(console.error)
    .finally(() => prisma.$disconnect());
