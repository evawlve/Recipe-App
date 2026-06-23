/**
 * Clear targeted ValidatedMapping entries affected by the April 2026 audit fixes.
 *
 * Targets:
 *  - sweetener / splenda / sucralose / stevia  (packet routing fix: 100g → 1g)
 *  - gluten                                    (semantic inversion: Oreo → vital wheat gluten)
 *  - apple pie spice / pie spice               (semantic inversion: apple chips → spice blend)
 *  - extra light                               (fat modifier fix: fat free → light)
 *  - drops / drop                              (micro-unit: 2400g → ~0.05g/drop)
 *  - "second" cooking spray                    (micro-unit: 40g → ~0.25g)
 */

import 'dotenv/config';
import { prisma } from '../src/lib/db';

const TARGET_SUBSTRINGS = [
    // Sweetener packet routing fix
    'sweetener',
    'splenda',
    'sucralose',
    'stevia',
    'aspartame',
    // Semantic inversion: gluten query → gluten free oreo
    'gluten',
    // Semantic inversion: apple pie spice → apple chips
    'apple pie spice',
    'pie spice',
    // Fat modifier: extra light → fat free (should be light)
    'extra light',
    // Micro-unit: drops
    'drops tabasco',
    'drops liquid',
    'drops stevia',
    'drops sriracha',
    // Micro-unit: cooking spray seconds
    'second cooking spray',
    'seconds cooking spray',
    '0.4 second',
    '0.5 second',
];

async function main() {
    console.log('\n=== Targeted ValidatedMapping Clear (Audit Fixes 2026-04-02) ===\n');

    let totalDeleted = 0;

    for (const substr of TARGET_SUBSTRINGS) {
        // Delete from ValidatedMapping (keyed by normalizedForm)
        const vm = await prisma.validatedMapping.deleteMany({
            where: {
                normalizedForm: { contains: substr, mode: 'insensitive' },
            },
        });

        // Also clear IngredientFoodMap so per-recipe cached results are re-mapped
        const ifm = await prisma.ingredientFoodMap.deleteMany({
            where: {
                ingredient: {
                    name: { contains: substr, mode: 'insensitive' },
                },
            },
        });

        // Clear any AI serving cache entries for these ingredient names
        const aiServing = await prisma.fatSecretServingCache.deleteMany({
            where: {
                id: { startsWith: 'ai_' },
                foodId: { contains: substr, mode: 'insensitive' },
            },
        });

        const subtotal = vm.count + ifm.count + aiServing.count;
        if (subtotal > 0) {
            console.log(`  "${substr}": ${vm.count} ValidatedMapping + ${ifm.count} IngredientFoodMap + ${aiServing.count} AI serving cache`);
            totalDeleted += subtotal;
        }
    }

    console.log(`\n✅ Total deleted: ${totalDeleted} records`);
    console.log('   Affected ingredients will be re-mapped on next pilot import.\n');
}

main()
    .catch(console.error)
    .finally(() => prisma.$disconnect());
