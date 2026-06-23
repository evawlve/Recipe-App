/**
 * Clear corrupted AI serving caches identified in the Jan 26 investigation
 * 
 * Issues found:
 * 1. RED PEPPERS (AHOLD) fdc_1931325 - "medium" = 10g (should be ~120g)
 * 2. Black Olives - size qualifiers giving wrong weights
 */

import { prisma } from '../src/lib/db';

async function main() {
    console.log('Clearing corrupted AI serving caches...\n');

    // 1. Clear FDC serving cache for RED PEPPERS (AHOLD) - fdc_1931325
    const redPeppersFdcId = 1931325;
    const redPeppersResult = await prisma.fdcServingCache.deleteMany({
        where: { fdcId: redPeppersFdcId }
    });
    console.log(`✓ Cleared ${redPeppersResult.count} FDC servings for RED PEPPERS (AHOLD) [fdcId: ${redPeppersFdcId}]`);

    // 2. Clear any AI-generated size qualifier servings for olives that have unreasonable weights
    // Large olives should be ~5g each, not 46g
    const oliveSizeServings = await prisma.fatSecretServingCache.findMany({
        where: {
            food: {
                name: { contains: 'olive', mode: 'insensitive' }
            },
            source: { in: ['ai', 'ai_ambiguous'] },
            measurementDescription: { in: ['small', 'medium', 'large'] }
        },
        include: { food: { select: { name: true } } }
    });

    let deletedOliveCount = 0;
    for (const serving of oliveSizeServings) {
        const grams = serving.servingWeightGrams || 0;
        // Olives should be 3-8g each, anything over 20g is suspicious
        if (grams > 20) {
            await prisma.fatSecretServingCache.delete({ where: { id: serving.id } });
            console.log(`  ✗ Deleted: "${serving.food.name}" ${serving.measurementDescription} = ${grams}g (too high)`);
            deletedOliveCount++;
        }
    }
    console.log(`✓ Cleared ${deletedOliveCount} suspicious olive size servings`);

    // 3. Clear any AI-generated size qualifier servings for peppers with unreasonably low weights
    // Medium bell pepper should be ~120g, not 10g
    const pepperSizeServings = await prisma.fatSecretServingCache.findMany({
        where: {
            food: {
                name: { contains: 'pepper', mode: 'insensitive' },
                NOT: { name: { contains: 'flakes', mode: 'insensitive' } } // Exclude pepper flakes
            },
            source: { in: ['ai', 'ai_ambiguous'] },
            measurementDescription: { in: ['small', 'medium', 'large'] }
        },
        include: { food: { select: { name: true } } }
    });

    let deletedPepperCount = 0;
    for (const serving of pepperSizeServings) {
        const grams = serving.servingWeightGrams || 0;
        // Whole peppers should be at least 50g, anything under is suspicious
        if (grams < 50) {
            await prisma.fatSecretServingCache.delete({ where: { id: serving.id } });
            console.log(`  ✗ Deleted: "${serving.food.name}" ${serving.measurementDescription} = ${grams}g (too low)`);
            deletedPepperCount++;
        }
    }
    console.log(`✓ Cleared ${deletedPepperCount} suspicious pepper size servings`);

    // 4. Also clear FDC size servings for peppers with wrong weights
    const fdcPepperServings = await prisma.fdcServingCache.findMany({
        where: {
            food: {
                description: { contains: 'pepper', mode: 'insensitive' }
            },
            description: { in: ['small', 'medium', 'large'] }
        },
        include: { food: { select: { description: true } } }
    });

    let deletedFdcPepperCount = 0;
    for (const serving of fdcPepperServings) {
        // Whole peppers should be at least 50g
        if (serving.grams < 50) {
            await prisma.fdcServingCache.delete({ where: { id: serving.id } });
            console.log(`  ✗ Deleted FDC: "${serving.food.description}" ${serving.description} = ${serving.grams}g (too low)`);
            deletedFdcPepperCount++;
        }
    }
    console.log(`✓ Cleared ${deletedFdcPepperCount} FDC pepper size servings with wrong weights`);

    // 5. Clear ValidatedMapping entries that used the bad data
    const badMappings = await prisma.validatedMapping.deleteMany({
        where: {
            OR: [
                { foodId: `fdc_${redPeppersFdcId}` },
                { normalizedForm: { contains: 'red pepper' }, foodName: { contains: 'AHOLD' } }
            ]
        }
    });
    console.log(`✓ Cleared ${badMappings.count} validated mappings with bad data`);

    console.log('\n✅ Cleanup complete! Re-run pilot import to get fresh mappings.');

    await prisma.$disconnect();
}

main().catch(console.error);
