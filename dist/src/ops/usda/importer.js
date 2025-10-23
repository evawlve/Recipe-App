"use strict";
/**
 * USDA bulk importer
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.importUsdaGenerics = importUsdaGenerics;
exports.importFromFdcApi = importFromFdcApi;
const db_1 = require("@/lib/db");
const logger_1 = require("@/lib/logger");
const normalize_1 = require("./normalize");
const dedupe_1 = require("./dedupe");
/**
 * Import USDA generics from bulk data
 */
async function importUsdaGenerics(rows, options = {}) {
    const { dryRun = false, batchSize = 100, skipDuplicates = true } = options;
    const result = {
        created: 0,
        skipped: 0,
        errors: 0
    };
    logger_1.logger.info('usda_import_start', {
        feature: 'usda_import',
        step: 'start',
        totalRows: rows.length,
        dryRun,
        batchSize
    });
    // Process in batches
    for (let i = 0; i < rows.length; i += batchSize) {
        const batch = rows.slice(i, i + batchSize);
        const batchResult = await processBatch(batch, { dryRun, skipDuplicates });
        result.created += batchResult.created;
        result.skipped += batchResult.skipped;
        result.errors += batchResult.errors;
        // Log progress
        if (i % (batchSize * 10) === 0) {
            logger_1.logger.info('usda_import_progress', {
                feature: 'usda_import',
                step: 'progress',
                processed: i,
                total: rows.length,
                created: result.created,
                skipped: result.skipped,
                errors: result.errors
            });
        }
    }
    logger_1.logger.info('usda_import_complete', {
        feature: 'usda_import',
        step: 'complete',
        created: result.created,
        skipped: result.skipped,
        errors: result.errors
    });
    return result;
}
/**
 * Process a batch of rows
 */
async function processBatch(rows, options) {
    const result = { created: 0, skipped: 0, errors: 0 };
    for (const row of rows) {
        try {
            // Normalize the row
            const per100 = (0, normalize_1.normalizeUsdaRowToPer100g)(row);
            if (!per100) {
                result.skipped++;
                continue;
            }
            const name = (0, dedupe_1.canonicalizeName)(per100.name);
            if (!name) {
                result.skipped++;
                continue;
            }
            // Check for duplicates if enabled
            if (options.skipDuplicates) {
                const finger = (0, dedupe_1.macroFingerprint)(per100.kcal100, per100.protein100, per100.carbs100, per100.fat100);
                const dupe = await db_1.prisma.food.findFirst({
                    where: {
                        source: 'usda',
                        OR: [
                            { name: { equals: name, mode: 'insensitive' } },
                            { AND: [
                                    { kcal100: { gte: per100.kcal100 - 5, lte: per100.kcal100 + 5 } },
                                    { protein100: { gte: per100.protein100 - 2, lte: per100.protein100 + 2 } },
                                    { carbs100: { gte: per100.carbs100 - 2, lte: per100.carbs100 + 2 } },
                                    { fat100: { gte: per100.fat100 - 2, lte: per100.fat100 + 2 } },
                                ] },
                        ],
                    },
                });
                if (dupe) {
                    result.skipped++;
                    continue;
                }
            }
            if (!options.dryRun) {
                // Create the food
                const food = await db_1.prisma.food.create({
                    data: {
                        name: per100.name,
                        brand: per100.brand || null,
                        categoryId: per100.categoryId || null,
                        source: 'usda',
                        verification: 'verified',
                        densityGml: per100.densityGml || null,
                        kcal100: per100.kcal100,
                        protein100: per100.protein100,
                        carbs100: per100.carbs100,
                        fat100: per100.fat100,
                        fiber100: per100.fiber100 || null,
                        sugar100: per100.sugar100 || null,
                        popularity: 1,
                    },
                });
                // Generate and create aliases
                const aliases = (0, dedupe_1.generateAliases)(per100.name);
                for (const alias of aliases) {
                    try {
                        await db_1.prisma.foodAlias.create({
                            data: {
                                foodId: food.id,
                                alias: alias.toLowerCase(),
                            },
                        });
                    }
                    catch (error) {
                        // Ignore duplicate alias errors
                        if (!(error instanceof Error && error.message?.includes('Unique constraint'))) {
                            console.warn('Failed to create alias:', alias, error instanceof Error ? error.message : String(error));
                        }
                    }
                }
                // Add auto-units based on category
                await addAutoUnits(food.id, per100.categoryId);
            }
            result.created++;
        }
        catch (error) {
            logger_1.logger.warn('usda_import_row_error', {
                feature: 'usda_import',
                step: 'row_error',
                id: row.id,
                error: error?.message
            });
            result.errors++;
        }
    }
    return result;
}
/**
 * Add auto-units based on category
 */
async function addAutoUnits(foodId, categoryId) {
    if (!categoryId)
        return;
    const unitMappings = {
        oil: [
            { label: '1 tbsp', grams: 13.6 },
            { label: '1 tsp', grams: 4.5 },
        ],
        flour: [
            { label: '1 cup', grams: 120 },
            { label: '1 tbsp', grams: 8 },
        ],
        starch: [
            { label: '1 cup', grams: 120 },
            { label: '1 tbsp', grams: 8 },
        ],
        whey: [
            { label: '1 scoop', grams: 32 },
            { label: '1 tbsp', grams: 8 },
        ],
        liquid: [
            { label: '1 cup', grams: 240 },
            { label: '1 tbsp', grams: 15 },
        ],
        grain: [
            { label: '1 cup', grams: 185 },
            { label: '1 tbsp', grams: 12 },
        ],
        oats: [
            { label: '1 cup', grams: 90 },
            { label: '1 tbsp', grams: 6 },
        ],
        rice: [
            { label: '1 cup', grams: 185 },
            { label: '1 tbsp', grams: 12 },
        ],
        sugar: [
            { label: '1 tbsp', grams: 12.5 },
            { label: '1 tsp', grams: 4.2 },
        ],
    };
    const units = unitMappings[categoryId];
    if (!units)
        return;
    for (const unit of units) {
        try {
            await db_1.prisma.foodUnit.create({
                data: {
                    foodId,
                    label: unit.label,
                    grams: unit.grams,
                },
            });
        }
        catch (error) {
            // Ignore duplicate unit errors
            if (!(error instanceof Error && error.message?.includes('Unique constraint'))) {
                console.warn('Failed to create unit:', unit.label, error instanceof Error ? error.message : String(error));
            }
        }
    }
}
/**
 * Import from FDC API (alternative to bulk file)
 */
async function importFromFdcApi(queries, options = {}) {
    // This would implement API-based import
    // For now, return empty result
    logger_1.logger.info('usda_import_fdc_api_not_implemented', {
        feature: 'usda_import',
        step: 'fdc_api_not_implemented',
        queries: queries.length
    });
    return { created: 0, skipped: 0, errors: 0 };
}
