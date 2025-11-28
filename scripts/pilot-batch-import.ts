#!/usr/bin/env ts-node

import 'dotenv/config';
import fs from 'node:fs';
import { prisma } from '../src/lib/db';
import { mapIngredientWithFatsecret } from '../src/lib/fatsecret/map-ingredient';
import { FatSecretClient } from '../src/lib/fatsecret/client';

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

async function pilotBatchImport(recipeLimit: number = 30, aiLogPath?: string) {
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

    const client = new FatSecretClient();
    const reviewQueue: Array<{
        ingredientId: string;
        rawLine: string;
        foodName: string;
        confidence: number;
    }> = [];

    for (const recipe of recipes) {
        console.log(`\n📝 Processing: "${recipe.title}" (${recipe.ingredients.length} ingredients)`);
        stats.recipesProcessed++;

        for (const ingredient of recipe.ingredients) {
            stats.totalIngredients++;
            const rawLine = `${ingredient.qty || ''} ${ingredient.unit || ''} ${ingredient.name}`.trim();

            process.stdout.write(`   - ${rawLine}... `);

            try {
                // Add rate limiting delay
                await new Promise(resolve => setTimeout(resolve, 100));

                const result = await mapIngredientWithFatsecret(rawLine, {
                    client,
                    minConfidence: 0.5,
                    debug: false,
                });

                if (!result) {
                    console.log('❌ No match');
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
                    console.log(`❌ AI Rejected (${result.aiValidation.confidence.toFixed(3)}) - ${result.foodName}`);
                    console.log(`   Reason: ${result.aiValidation.reason}`);
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
                    console.log(`🔴 Low (${confidence.toFixed(3)}) - ${result.foodName}`);
                    continue; // Don't save low confidence
                } else if (confidence < 0.7) {
                    console.log(`⚠️  Review (${confidence.toFixed(3)}) - ${result.foodName}`);
                    reviewQueue.push({
                        ingredientId: ingredient.id,
                        rawLine,
                        foodName: result.foodName,
                        confidence,
                    });
                } else {
                    console.log(`✅ Good (${confidence.toFixed(3)}) - ${result.foodName}`);
                }

                // Save mapping to database
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

            } catch (error) {
                console.log(`❌ Error`);
                stats.failed++;
                writeAiLog({
                    rawLine,
                    foodName: undefined,
                    status: 'error',
                    reason: error instanceof Error ? error.message : String(error),
                });
                stats.errors.push({
                    ingredient: rawLine,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
    }

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

    return stats;
}

async function main() {
    const args = process.argv.slice(2);
    const recipeLimitArg = args[0] && !args[0].startsWith('--') ? parseInt(args[0]) : 30;
    const aiLogArg = args.find(a => a.startsWith('--ai-log='));
    const aiLogPath = aiLogArg ? aiLogArg.split('=')[1] : undefined;

    if (isNaN(recipeLimitArg) || recipeLimitArg < 1) {
        console.error('Usage: npm run pilot-import [recipeLimit]');
        console.error('       npm run pilot-import 5 --ai-log=pilot-ai.log');
        console.error('Example: npm run pilot-import 50');
        process.exit(1);
    }

    await pilotBatchImport(recipeLimitArg, aiLogPath);
    await prisma.$disconnect();
}

if (require.main === module) {
    main().catch((err) => {
        console.error('Fatal error:', err);
        process.exit(1);
    });
}
