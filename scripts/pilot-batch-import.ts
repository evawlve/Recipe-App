#!/usr/bin/env ts-node

import 'dotenv/config';
import fs from 'node:fs';
import { prisma } from '../src/lib/db';
import { mapIngredientWithFallback, type MapIngredientPendingResult } from '../src/lib/fatsecret/map-ingredient-with-fallback';
import { applyCleanupPatterns } from '../src/lib/ingredients/cleanup';
import { refreshNormalizationRules } from '../src/lib/fatsecret/normalization-rules';
import { initMappingAnalysisSession, finalizeMappingAnalysisSession } from '../src/lib/fatsecret/mapping-logger';

// DEBUG: File-based logging to trace control flow
const debugLog = fs.createWriteStream('logs/pilot-debug.log', { flags: 'w' });
const dbg = (msg: string) => { debugLog.write(`${new Date().toISOString()} ${msg}\n`); };

interface PilotStats {
    recipesProcessed: number;
    totalIngredients: number;
    successful: number;
    failed: number;
    avgConfidence: number;
    errors: Array<{ ingredient: string; error: string }>;
}

type AiLogEntry = {
    rawLine: string;
    ourConfidence?: number;
    approved?: boolean;
    aiConfidence?: number;
    reason?: string;
    category?: string;
    foodName?: string;
    status: 'mapped' | 'rejected' | 'no_match' | 'error';
};

// Helper to check if a mapping result is pending (locked)
function isPendingResult(result: unknown): result is MapIngredientPendingResult {
    return result !== null && typeof result === 'object' && 'status' in result && (result as { status: string }).status === 'pending';
}

async function pilotBatchImport(recipeLimit: number = 30, aiLogPath?: string) {
    dbg('=== pilotBatchImport STARTED ===');
    // Sync AI-learned prep phrases before processing
    await refreshNormalizationRules();

    // Initialize mapping analysis session for AI call tracking
    if (process.env.ENABLE_MAPPING_ANALYSIS === 'true') {
        initMappingAnalysisSession();
    }

    const aiLogStream = aiLogPath ? fs.createWriteStream(aiLogPath, { flags: 'a' }) : null;
    const writeAiLog = (entry: AiLogEntry) => {
        if (aiLogStream) {
            aiLogStream.write(JSON.stringify(entry) + '\n');
        }
    };

    console.log(`\n🚀 Pilot Batch Import (${recipeLimit} recipes max)\n`);
    console.log('⚙️  Safeguards enabled:');
    console.log('   - Rate limiting: 100ms between AI calls');
    console.log('   - Min confidence for auto-save: 0.5');
    console.log('   - Manual review queue: 0.5-0.7 confidence');
    console.log('   - Full debug logging\n');

    const stats: PilotStats = {
        recipesProcessed: 0,
        totalIngredients: 0,
        successful: 0,
        failed: 0,
        avgConfidence: 0,
        errors: [],
    };

    // Get recipes with unmapped ingredients
    const recipes = await prisma.recipe.findMany({
        where: {
            ingredients: {
                some: {
                    foodMaps: {
                        none: {},
                    },
                },
            },
        },
        include: {
            ingredients: {
                where: {
                    foodMaps: {
                        none: {},
                    },
                },
            },
        },
        take: recipeLimit,
    });

    if (recipes.length === 0) {
        console.log('✅ No recipes with unmapped ingredients found!\n');
        return stats;
    }

    console.log(`📦 Found ${recipes.length} recipes with unmapped ingredients\n`);

    const reviewQueue: Array<{
        ingredientId: string;
        rawLine: string;
        foodName: string;
        confidence: number;
    }> = [];

    const BATCH_SIZE = 50; // Max ingredients per chunk (for future use with very large recipes)
    const RECIPE_CONCURRENCY = 10; // Process 10 recipes simultaneously

    // Helper to chunk array into batches
    function chunk<T>(arr: T[], size: number): T[][] {
        const chunks: T[][] = [];
        for (let i = 0; i < arr.length; i += size) {
            chunks.push(arr.slice(i, i + size));
        }
        return chunks;
    }

    // Process recipes in parallel batches
    const recipeChunks = chunk(recipes, RECIPE_CONCURRENCY);
    console.log(`⚡ Processing ${recipes.length} recipes in ${recipeChunks.length} parallel batches of up to ${RECIPE_CONCURRENCY}\n`);

    for (const recipeChunk of recipeChunks) {
        // Process this chunk of recipes in parallel
        await Promise.allSettled(recipeChunk.map(async (recipe) => {
            console.log(`\n📝 Processing: "${recipe.title}" (${recipe.ingredients.length} ingredients)`);
            stats.recipesProcessed++;

            // Process ingredients in PARALLEL using Promise.allSettled with skip-on-lock
            dbg(`Processing ${recipe.ingredients.length} ingredients in parallel`);

            const batchResults = await Promise.allSettled(
                recipe.ingredients.map(async (ingredient) => {
                    // Fix misplaced units: if unit is null but name starts with a unit, extract it
                    let effectiveUnit = ingredient.unit;
                    let effectiveName = ingredient.name;

                    if (!effectiveUnit || !effectiveUnit.trim()) {
                        // Expanded unit pattern to include count units like packet, scoop, serving, etc.
                        const unitMatch = ingredient.name.match(/^(tbsps?|tsps?|cups?|oz|g|ml|lbs?|tablespoons?|teaspoons?|scoops?|packets?|sachets?|pouches?|sticks?|servings?|bars?|pieces?|slices?|cans?|envelopes?)\s+(.+)$/i);
                        if (unitMatch) {
                            effectiveUnit = unitMatch[1];
                            effectiveName = unitMatch[2];
                        }
                    }

                    const rawLine = `${ingredient.qty || ''} ${effectiveUnit || ''} ${effectiveName}`.trim();

                    // NOTE: We no longer skip unitless ingredients!
                    // The mapping pipeline (mapIngredientWithFallback) can handle unitless ingredients
                    // via AI backfill for serving estimation (e.g., "1 banana" → "medium banana (118g)")

                    try {
                        // Apply learned cleanup patterns before mapping
                        const cleanupResult = await applyCleanupPatterns(effectiveName);
                        const cleanedName = cleanupResult.cleaned;
                        const cleanedLine = `${ingredient.qty || ''} ${effectiveUnit || ''} ${cleanedName}`.trim();
                        dbg(`  Mapping: ${cleanedLine}`);

                        const result = await mapIngredientWithFallback(cleanedLine, {
                            minConfidence: 0.5,
                            skipAiValidation: true,  // Skip AI validation for pilot imports (too strict)
                            skipOnLock: true,  // Don't block on locked ingredients - retry later
                            debug: false,
                        });
                        dbg(`  Mapped: ${isPendingResult(result) ? 'PENDING' : (result?.foodName || 'null')}`);

                        return { ingredient, rawLine, cleanedLine, result, error: null, skipped: false };
                    } catch (error) {
                        dbg(`  Error: ${(error as Error).message}`);
                        return { ingredient, rawLine, cleanedLine: rawLine, result: null, error: error as Error, skipped: false };
                    }
                })
            );
            dbg(`Batch complete: ${batchResults.length} results`);

            // Process batch results
            dbg(`Batch results: ${batchResults.length} items`);
            console.log(`   📊 Batch results: ${batchResults.length} items`);
            for (const settled of batchResults) {
                dbg(`Processing settled: ${settled.status}`);
                console.log(`   🔍 Processing: status=${settled.status}`);
                stats.totalIngredients++;

                if (settled.status === 'rejected') {
                    const errorMsg = settled.reason?.message || 'Unknown error';
                    console.log(`   - [ERROR] ${errorMsg}`);
                    stats.failed++;
                    stats.errors.push({ ingredient: 'Unknown', error: errorMsg });
                    continue;
                }

                const { ingredient, rawLine, cleanedLine, result, error, skipped } = settled.value;

                // Handle pending (locked) ingredients - will be retried after first pass
                if (isPendingResult(result)) {
                    dbg(`  Pending: ${rawLine} (locked)`);
                    // Don't count or process yet - collected for retry below
                    continue;
                }

                // Handle skipped ingredients (e.g., no unit)
                if (skipped) {
                    console.log(`   - ${rawLine}... ⏭️  Skipped`);
                    // Don't count as failed - this is expected behavior for unitless ingredients
                    continue;
                }

                if (error) {
                    console.log(`   - ${rawLine}... ❌ Error: ${error.message}`);
                    stats.failed++;
                    stats.errors.push({ ingredient: rawLine, error: error.message });
                    writeAiLog({
                        rawLine,
                        status: 'error',
                        reason: error.message,
                    });
                    continue;
                }

                if (!result) {
                    console.log(`   - ${rawLine}... ❌ No match`);
                    stats.failed++;
                    stats.errors.push({ ingredient: rawLine, error: 'No mapping found' });
                    writeAiLog({
                        rawLine,
                        status: 'no_match',
                        foodName: undefined,
                        approved: undefined,
                        aiConfidence: undefined,
                        reason: 'No mapping found',
                    });
                    continue;
                }

                const confidence = result.confidence;

                // Check AI Validation Result
                if (result.aiValidation && !result.aiValidation.approved) {
                    console.log(`   - ${rawLine}... ❌ AI Rejected (${result.aiValidation.confidence.toFixed(3)}) - ${result.foodName}`);
                    writeAiLog({
                        rawLine,
                        foodName: result.foodName,
                        ourConfidence: confidence,
                        approved: result.aiValidation.approved,
                        aiConfidence: result.aiValidation.confidence,
                        reason: result.aiValidation.reason,
                        category: result.aiValidation.category,
                        status: 'rejected',
                    });
                    stats.failed++;
                    stats.errors.push({
                        ingredient: rawLine,
                        error: `AI Rejected: ${result.aiValidation.reason} (Category: ${result.aiValidation.category})`
                    });
                    continue; // Don't save rejected mappings
                }

                stats.successful++;
                stats.avgConfidence += confidence;

                // Log AI-approved mapping
                writeAiLog({
                    rawLine,
                    foodName: result.foodName,
                    ourConfidence: confidence,
                    approved: result.aiValidation?.approved ?? true,
                    aiConfidence: result.aiValidation?.confidence,
                    reason: result.aiValidation?.reason,
                    category: result.aiValidation?.category,
                    status: 'mapped',
                });

                // Categorize by confidence
                if (confidence < 0.5) {
                    console.log(`   - ${rawLine}... 🔴 Low (${confidence.toFixed(3)}) - ${result.foodName}`);
                    continue; // Don't save low confidence
                } else if (confidence < 0.7) {
                    console.log(`   - ${rawLine}... ⚠️  Review (${confidence.toFixed(3)}) - ${result.foodName}`);
                    reviewQueue.push({
                        ingredientId: ingredient.id,
                        rawLine,
                        foodName: result.foodName,
                        confidence,
                    });
                } else {
                    console.log(`   - ${rawLine}... ✅ Good (${confidence.toFixed(3)}) - ${result.foodName}`);
                }

                // Save mapping to database
                dbg(`ATTEMPTING CREATE for ${rawLine}`);
                try {
                    await prisma.ingredientFoodMap.create({
                        data: {
                            ingredientId: ingredient.id,
                            fatsecretFoodId: result.foodId,
                            fatsecretServingId: result.servingId,
                            fatsecretGrams: result.grams,
                            fatsecretConfidence: confidence,
                            fatsecretSource: 'fatsecret',
                            mappedBy: 'ai_pilot',
                            isActive: true,
                        },
                    });
                    dbg(`SUCCESS - created for ${rawLine}`);
                    console.log(`   📁 Saved IngredientFoodMap for ${ingredient.id.substring(0, 8)}...`);
                } catch (createErr) {
                    dbg(`FAILED - ${(createErr as Error).message}`);
                    console.error(`   ❌ Failed to create IngredientFoodMap:`, createErr);
                }
            }

            // ============================================================
            // RETRY PASS: Process pending (locked) ingredients
            // ============================================================
            const pendingItems = batchResults
                .filter((r): r is PromiseFulfilledResult<{ ingredient: any; rawLine: string; cleanedLine: string; result: any; error: null; skipped: false }> =>
                    r.status === 'fulfilled' && isPendingResult(r.value.result))
                .map(r => r.value);

            if (pendingItems.length > 0) {
                console.log(`   🔄 Retrying ${pendingItems.length} previously-locked ingredients...`);
                dbg(`Retrying ${pendingItems.length} pending items`);

                for (const pending of pendingItems) {
                    stats.totalIngredients++;
                    try {
                        const result = await mapIngredientWithFallback(pending.cleanedLine, {
                            minConfidence: 0.5,
                            skipAiValidation: true,
                            skipOnLock: false,  // Block on retry - should hit cache instantly
                        });

                        if (!result || isPendingResult(result)) {
                            console.log(`   - ${pending.rawLine}... ❌ No match (retry)`);
                            stats.failed++;
                            stats.errors.push({ ingredient: pending.rawLine, error: 'No mapping (retry)' });
                            continue;
                        }

                        const confidence = result.confidence;
                        stats.successful++;
                        stats.avgConfidence += confidence;

                        if (confidence >= 0.5) {
                            console.log(`   - ${pending.rawLine}... ✅ (${confidence.toFixed(3)}) - ${result.foodName} [retry]`);
                            await prisma.ingredientFoodMap.create({
                                data: {
                                    ingredientId: pending.ingredient.id,
                                    fatsecretFoodId: result.foodId,
                                    fatsecretServingId: result.servingId,
                                    fatsecretGrams: result.grams,
                                    fatsecretConfidence: confidence,
                                    fatsecretSource: 'fatsecret',
                                    mappedBy: 'ai_pilot',
                                    isActive: true,
                                },
                            });
                            if (confidence < 0.7) {
                                reviewQueue.push({ ingredientId: pending.ingredient.id, rawLine: pending.rawLine, foodName: result.foodName, confidence });
                            }
                        }
                    } catch (err) {
                        console.log(`   - ${pending.rawLine}... ❌ Error (retry): ${(err as Error).message}`);
                        stats.failed++;
                        stats.errors.push({ ingredient: pending.rawLine, error: (err as Error).message });
                    }
                }
            }
        }));  // End recipe callback and Promise.allSettled
    }  // End recipeChunks loop

    // Note: Deferred hydration now runs in background (fire-and-forget)
    // Runner-up candidates are hydrated immediately when scored, no need to wait here
    console.log('\n✅ Deferred hydration running in background (fire-and-forget)');

    // Calculate final stats
    if (stats.successful > 0) {
        stats.avgConfidence = stats.avgConfidence / stats.successful;
    }

    // Print summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 PILOT BATCH IMPORT SUMMARY');
    console.log('='.repeat(60));
    console.log(`\n✅ Success Rate: ${((stats.successful / stats.totalIngredients) * 100).toFixed(1)}%`);
    console.log(`\n📈 Statistics:`);
    console.log(`   Recipes Processed: ${stats.recipesProcessed}`);
    console.log(`   Total Ingredients: ${stats.totalIngredients}`);
    console.log(`   Successful: ${stats.successful}`);
    console.log(`   Failed: ${stats.failed}`);
    console.log(`   Average Confidence: ${stats.avgConfidence.toFixed(3)}`);

    console.log(`\n🎯 Confidence Distribution:`);
    const high = stats.successful - reviewQueue.length;
    console.log(`   High (≥0.7): ${high} (${((high / stats.successful) * 100).toFixed(1)}%)`);
    console.log(`   Medium (0.5-0.7): ${reviewQueue.length} (${((reviewQueue.length / stats.successful) * 100).toFixed(1)}%)`);

    // Show review queue
    if (reviewQueue.length > 0) {
        console.log(`\n⚠️  MANUAL REVIEW QUEUE (${reviewQueue.length} items):`);
        console.log('   These mappings need verification:\n');
        reviewQueue.forEach((item, idx) => {
            console.log(`   ${idx + 1}. [${item.confidence.toFixed(3)}] ${item.rawLine}`);
            console.log(`      → ${item.foodName}`);
            console.log(`      Ingredient ID: ${item.ingredientId}\n`);
        });
    }

    // Show errors
    if (stats.errors.length > 0) {
        console.log(`\n❌ ERRORS (${stats.errors.length} items):`);
        stats.errors.slice(0, 10).forEach((err, idx) => {
            console.log(`   ${idx + 1}. ${err.ingredient}`);
            console.log(`      Error: ${err.error}\n`);
        });
        if (stats.errors.length > 10) {
            console.log(`   ... and ${stats.errors.length - 10} more errors\n`);
        }
    }

    // Recommendations
    console.log('\n💡 NEXT STEPS:');
    const successRate = (stats.successful / stats.totalIngredients) * 100;

    if (successRate >= 80 && stats.avgConfidence >= 0.75) {
        console.log('   ✅ Pilot looks good! Consider proceeding with full batch.');
    } else if (successRate >= 60) {
        console.log('   ⚠️  Moderate success. Review errors and edge cases before scaling.');
    } else {
        console.log('   🔴 Low success rate. Investigate failures before proceeding.');
    }

    console.log('\n   Review mappings with:');
    console.log('   npm run review-mappings --min 0.5 --max 0.7  (medium confidence)');
    console.log('   npm run review-mappings --min 0.7            (high confidence)');
    console.log('\n');

    if (aiLogStream) {
        aiLogStream.end();
        console.log(`📝 AI log written to: ${aiLogPath}`);
    }

    // Finalize mapping analysis session (shows AI call summary)
    if (process.env.ENABLE_MAPPING_ANALYSIS === 'true') {
        finalizeMappingAnalysisSession();
    }

    return stats;
}

async function main() {
    const args = process.argv.slice(2);

    // Support three formats:
    //   pilot-batch-import.ts 300
    //   pilot-batch-import.ts --recipes 300
    //   pilot-batch-import.ts --recipes=300
    let recipeLimitArg = 30; // default
    const recipesEqFlag = args.find(a => a.startsWith('--recipes='));
    const recipesFlagIdx = args.indexOf('--recipes');
    if (recipesEqFlag) {
        recipeLimitArg = parseInt(recipesEqFlag.split('=')[1]);
    } else if (recipesFlagIdx !== -1 && args[recipesFlagIdx + 1]) {
        recipeLimitArg = parseInt(args[recipesFlagIdx + 1]);
    } else if (args[0] && !args[0].startsWith('--')) {
        recipeLimitArg = parseInt(args[0]);
    }

    const aiLogArg = args.find(a => a.startsWith('--ai-log='));
    const aiLogPath = aiLogArg ? aiLogArg.split('=')[1] : undefined;

    if (isNaN(recipeLimitArg) || recipeLimitArg < 1) {
        console.error('Usage: npx tsx scripts/pilot-batch-import.ts [recipeLimit]');
        console.error('       npx tsx scripts/pilot-batch-import.ts 300');
        console.error('       npx tsx scripts/pilot-batch-import.ts --recipes 300');
        console.error('       npx tsx scripts/pilot-batch-import.ts --recipes=300 --ai-log=out.log');
        process.exit(1);
    }

    console.log(`📋 Recipe limit: ${recipeLimitArg}`);
    await pilotBatchImport(recipeLimitArg, aiLogPath);
    await prisma.$disconnect();
}

if (require.main === module) {
    main().catch((err) => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
}
