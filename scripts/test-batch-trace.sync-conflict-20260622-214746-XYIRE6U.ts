/**
 * Diagnostic test that mirrors pilot-batch-import.ts but with explicit file logging
 */
import 'dotenv/config';
import fs from 'fs';
import { prisma } from '../src/lib/db';
import { mapIngredientWithFallback } from '../src/lib/fatsecret/map-ingredient-with-fallback';

const logFile = fs.createWriteStream('logs/diagnostic-trace.log', { flags: 'w' });
const log = (msg: string) => {
    const line = `${new Date().toISOString()} ${msg}`;
    logFile.write(line + '\n');
    console.log(line);
};

async function main() {
    log('=== DIAGNOSTIC: Batch Import Trace ===');

    // Replicate pilot-batch-import.ts query
    log('Querying recipes...');
    const recipes = await prisma.recipe.findMany({
        where: {
            ingredients: {
                some: {
                    foodMaps: { none: {} },
                },
            },
        },
        include: {
            ingredients: {
                where: { foodMaps: { none: {} } },
            },
        },
        take: 2,
    });

    log(`Found ${recipes.length} recipes`);

    if (recipes.length === 0) {
        log('No recipes found, exiting');
        return;
    }

    for (const recipe of recipes) {
        log(`Processing recipe: "${recipe.title}" (${recipe.ingredients.length} unmapped)`);

        const batch = recipe.ingredients.slice(0, 3); // Just 3 per recipe
        log(`  Batch size: ${batch.length}`);

        // Replicate Promise.allSettled pattern
        const batchResults = await Promise.allSettled(
            batch.map(async (ingredient) => {
                const rawLine = `${ingredient.qty || ''} ${ingredient.unit || ''} ${ingredient.name}`.trim();
                log(`    Mapping: "${rawLine}"`);

                try {
                    const result = await mapIngredientWithFallback(rawLine, {
                        minConfidence: 0.5,
                        skipAiValidation: true,
                        debug: false,
                    });
                    return { ingredient, rawLine, result, error: null };
                } catch (error) {
                    return { ingredient, rawLine, result: null, error: error as Error };
                }
            })
        );

        log(`  Batch results: ${batchResults.length} items`);

        // Process batch results - this is where pilot-batch-import.ts seems to fail
        for (const settled of batchResults) {
            log(`    Processing settled: status=${settled.status}`);

            if (settled.status === 'rejected') {
                log(`      REJECTED: ${settled.reason}`);
                continue;
            }

            const { ingredient, rawLine, result, error } = settled.value;

            if (error) {
                log(`      ERROR: ${error.message}`);
                continue;
            }

            if (!result) {
                log(`      NO RESULT for "${rawLine}"`);
                continue;
            }

            const confidence = result.confidence;
            log(`      RESULT: "${rawLine}" -> "${result.foodName}" (${confidence.toFixed(2)})`);

            // Check confidence
            if (confidence < 0.5) {
                log(`      SKIP: Low confidence`);
                continue;
            }

            // This is THE CRITICAL PART - try to create IngredientFoodMap
            log(`      Creating IngredientFoodMap...`);
            try {
                const created = await prisma.ingredientFoodMap.create({
                    data: {
                        ingredientId: ingredient.id,
                        fatsecretFoodId: result.foodId,
                        fatsecretServingId: result.servingId || null,
                        fatsecretGrams: result.grams,
                        fatsecretConfidence: confidence,
                        fatsecretSource: 'fatsecret',
                        mappedBy: 'diagnostic',
                        isActive: true,
                    },
                });
                log(`      CREATED: ${created.id}`);
            } catch (err: unknown) {
                const error = err as Error;
                log(`      CREATE FAILED: ${error.message}`);
            }
        }
    }

    // Final counts
    const mapCount = await prisma.ingredientFoodMap.count();
    const validatedCount = await prisma.validatedMapping.count();
    log(`Final: IngredientFoodMap=${mapCount}, ValidatedMapping=${validatedCount}`);

    logFile.end();
    await prisma.$disconnect();
}

main().catch(err => {
    log(`FATAL: ${err.message}`);
    logFile.end();
    process.exit(1);
});
