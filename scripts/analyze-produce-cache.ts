/**
 * Analyze produce items in cache that could benefit from proactive size backfill
 * 
 * This script checks:
 * 1. How many produce items exist in FatSecret and FDC caches
 * 2. How many already have small/medium/large servings
 * 3. How many could be backfilled
 */

process.env.DEBUG = '';

import { prisma } from '../src/lib/db';
import { isProduce } from '../src/lib/fatsecret/serving-backfill';

const SIZE_UNITS = ['small', 'medium', 'large'];

interface ProduceStats {
    foodId: string;
    foodName: string;
    source: 'fatsecret' | 'fdc';
    existingSizes: string[];
    missingSizes: string[];
    servingCount: number;
}

async function main() {
    console.log('=== Produce Cache Analysis ===\n');

    // 1. Analyze FatSecret cache
    const fatSecretFoods = await prisma.fatSecretFoodCache.findMany({
        select: {
            id: true,
            name: true,
            servings: {
                select: {
                    measurementDescription: true,
                    source: true,
                }
            }
        }
    });

    const fatSecretProduce: ProduceStats[] = [];

    for (const food of fatSecretFoods) {
        if (isProduce(food.name)) {
            const existingSizes = SIZE_UNITS.filter(size =>
                food.servings.some(s =>
                    s.measurementDescription?.toLowerCase().includes(size)
                )
            );
            const missingSizes = SIZE_UNITS.filter(s => !existingSizes.includes(s));

            fatSecretProduce.push({
                foodId: food.id,
                foodName: food.name,
                source: 'fatsecret',
                existingSizes,
                missingSizes,
                servingCount: food.servings.length,
            });
        }
    }

    // 2. Analyze FDC cache
    const fdcFoods = await prisma.fdcFoodCache.findMany({
        select: {
            id: true,
            description: true,
            servings: {
                select: {
                    description: true,
                }
            }
        }
    });

    const fdcProduce: ProduceStats[] = [];

    for (const food of fdcFoods) {
        if (isProduce(food.description)) {
            const existingSizes = SIZE_UNITS.filter(size =>
                food.servings.some(s =>
                    s.description?.toLowerCase().includes(size)
                )
            );
            const missingSizes = SIZE_UNITS.filter(s => !existingSizes.includes(s));

            fdcProduce.push({
                foodId: `fdc_${food.id}`,
                foodName: food.description,
                source: 'fdc',
                existingSizes,
                missingSizes,
                servingCount: food.servings.length,
            });
        }
    }

    // 3. Calculate stats
    const allProduce = [...fatSecretProduce, ...fdcProduce];

    const fullyBackfilled = allProduce.filter(p => p.missingSizes.length === 0);
    const partiallyBackfilled = allProduce.filter(p =>
        p.existingSizes.length > 0 && p.missingSizes.length > 0
    );
    const notBackfilled = allProduce.filter(p => p.existingSizes.length === 0);

    // Print summary
    console.log('--- Cache Summary ---\n');
    console.log(`Total foods in FatSecret cache: ${fatSecretFoods.length}`);
    console.log(`Total foods in FDC cache: ${fdcFoods.length}`);
    console.log(`\n--- Produce Items Detected ---\n`);
    console.log(`FatSecret produce items: ${fatSecretProduce.length}`);
    console.log(`FDC produce items: ${fdcProduce.length}`);
    console.log(`Total produce items: ${allProduce.length}`);

    console.log(`\n--- Size Serving Coverage ---\n`);
    console.log(`✅ Fully backfilled (all 3 sizes): ${fullyBackfilled.length}`);
    console.log(`⚠️  Partially backfilled: ${partiallyBackfilled.length}`);
    console.log(`❌ No size servings: ${notBackfilled.length}`);

    // Count total servings that could be created
    const totalMissing = allProduce.reduce((sum, p) => sum + p.missingSizes.length, 0);
    console.log(`\n📊 Potential AI backfill calls needed: ${totalMissing}`);

    // Show sample of items needing backfill
    if (notBackfilled.length > 0) {
        console.log(`\n--- Sample items needing full backfill (first 10) ---\n`);
        for (const item of notBackfilled.slice(0, 10)) {
            console.log(`  [${item.source}] ${item.foodName} (${item.servingCount} servings)`);
        }
    }

    if (partiallyBackfilled.length > 0) {
        console.log(`\n--- Sample items with partial coverage (first 10) ---\n`);
        for (const item of partiallyBackfilled.slice(0, 10)) {
            console.log(`  [${item.source}] ${item.foodName}`);
            console.log(`    Has: ${item.existingSizes.join(', ') || 'none'}`);
            console.log(`    Missing: ${item.missingSizes.join(', ')}`);
        }
    }

    await prisma.$disconnect();
}

main().catch(console.error);
