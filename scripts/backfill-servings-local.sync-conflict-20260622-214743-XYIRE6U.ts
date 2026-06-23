/**
 * Batch Backfill Serving Options Using Local LLM
 * 
 * Scans FatSecret and FDC caches for foods missing serving options
 * and uses the local Ollama LLM to estimate them.
 * 
 * Usage:
 *   npx tsx scripts/backfill-servings-local.ts --dry-run           # Preview what would be backfilled
 *   npx tsx scripts/backfill-servings-local.ts --limit 100         # Process first 100 foods
 *   npx tsx scripts/backfill-servings-local.ts --cache fatsecret   # Only FatSecret cache
 *   npx tsx scripts/backfill-servings-local.ts --cache fdc         # Only FDC cache
 *   npx tsx scripts/backfill-servings-local.ts                     # Full backfill (both caches)
 * 
 * @since Jan 2026 - RTX 3090 Cost Reduction
 */

import 'dotenv/config';
import { prisma } from '../src/lib/db';
import { requestAiServing, type AiServingRequest } from '../src/lib/ai/serving-estimator';
import { detectServingGaps } from '../src/lib/fatsecret/serving-backfill';
import { getAiCallSummary, resetAiCallMetrics } from '../src/lib/ai/structured-client';

// ============================================================
// CLI Arguments
// ============================================================

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitArg = args.find(a => a.startsWith('--limit'));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1] || args[args.indexOf('--limit') + 1] || '0', 10) : 0;
const cacheArg = args.find(a => a.startsWith('--cache'));
const CACHE_FILTER = cacheArg ? (cacheArg.split('=')[1] || args[args.indexOf('--cache') + 1] || 'all') : 'all';

console.log('\n🔧 Backfill Configuration:');
console.log(`   Dry Run: ${DRY_RUN}`);
console.log(`   Limit: ${LIMIT || 'none (all)'}`);
console.log(`   Cache: ${CACHE_FILTER}`);
console.log('');

// ============================================================
// Types
// ============================================================

interface BackfillResult {
    foodId: string;
    foodName: string;
    source: 'fatsecret' | 'fdc';
    gapType: 'volume' | 'weight';
    status: 'success' | 'skipped' | 'error';
    servingLabel?: string;
    grams?: number;
    confidence?: number;
    error?: string;
}

interface BackfillStats {
    total: number;
    success: number;
    skipped: number;
    errors: number;
    byGapType: {
        volume: number;
        weight: number;
    };
}

// ============================================================
// FatSecret Cache Backfill
// ============================================================

async function findFatSecretFoodsNeedingBackfill(limit: number): Promise<Array<{
    id: string;
    name: string;
    servings: Array<{
        metricServingUnit: string | null;
        servingWeightGrams: number | null;
        volumeMl: number | null;
        measurementDescription: string | null;
    }>;
}>> {
    // Get foods with their servings - simple approach
    const foods = await prisma.fatSecretFoodCache.findMany({
        select: {
            id: true,
            name: true,
            servings: {
                select: {
                    metricServingUnit: true,
                    servingWeightGrams: true,
                    volumeMl: true,
                    measurementDescription: true,
                }
            }
        },
        take: limit > 0 ? limit * 3 : 1000, // Get extra to account for filtering
        orderBy: { createdAt: 'desc' },
    });

    // Filter to those with serving gaps
    const needsBackfill = foods.filter(food => {
        const gaps = detectServingGaps(food.name, food.servings);
        return gaps.needsWeight || gaps.needsHumanReadable;
    });

    console.log(`   (Scanned ${foods.length} foods, ${needsBackfill.length} need backfill)`);
    return limit > 0 ? needsBackfill.slice(0, limit) : needsBackfill;
}

async function backfillFatSecretFood(food: {
    id: string;
    name: string;
    servings: Array<{
        metricServingUnit: string | null;
        servingWeightGrams: number | null;
        volumeMl: number | null;
        measurementDescription: string | null;
    }>;
}): Promise<BackfillResult> {
    const gaps = detectServingGaps(food.name, food.servings);

    // Determine gap type to backfill
    const gapType: 'volume' | 'weight' = gaps.needsWeight ? 'weight' : 'volume';

    // Get full food with servings for AI request
    const fullFood = await prisma.fatSecretFoodCache.findUnique({
        where: { id: food.id },
        include: { servings: true }
    });

    if (!fullFood) {
        return {
            foodId: food.id,
            foodName: food.name,
            source: 'fatsecret',
            gapType,
            status: 'error',
            error: 'Food not found',
        };
    }

    // Request AI serving estimation
    const request: AiServingRequest = {
        gapType,
        food: fullFood,
        isOnDemandBackfill: true, // Use lower confidence threshold
    };

    const result = await requestAiServing(request);

    if (result.status === 'success') {
        // Save to cache if not dry run
        if (!DRY_RUN) {
            await prisma.fatSecretServingCache.create({
                data: {
                    foodId: food.id,
                    measurementDescription: result.suggestion.servingLabel,
                    servingWeightGrams: result.suggestion.grams,
                    volumeMl: result.suggestion.volumeAmount && result.suggestion.volumeUnit
                        ? toMilliliters(result.suggestion.volumeUnit, result.suggestion.volumeAmount)
                        : null,
                    metricServingUnit: result.suggestion.volumeUnit || 'g',
                    numberOfUnits: result.suggestion.volumeAmount || 1,
                    source: 'ai-local', // Mark as locally generated
                },
            });
        }

        return {
            foodId: food.id,
            foodName: food.name,
            source: 'fatsecret',
            gapType,
            status: 'success',
            servingLabel: result.suggestion.servingLabel,
            grams: result.suggestion.grams,
            confidence: result.suggestion.confidence,
        };
    }

    return {
        foodId: food.id,
        foodName: food.name,
        source: 'fatsecret',
        gapType,
        status: 'error',
        error: result.reason,
    };
}

// ============================================================
// ML-to-grams conversion helper
// ============================================================

const VOLUME_UNIT_TO_ML: Record<string, number> = {
    cup: 240, cups: 240,
    tbsp: 15, tablespoon: 15, tablespoons: 15,
    tsp: 5, teaspoon: 5, teaspoons: 5,
    ml: 1, milliliter: 1, milliliters: 1,
    'fl oz': 30, floz: 30,
};

function toMilliliters(unit: string, amount: number): number | null {
    if (!unit || amount <= 0) return null;
    const scale = VOLUME_UNIT_TO_ML[unit.toLowerCase()];
    if (!scale) return null;
    return amount * scale;
}

// ============================================================
// Main Execution
// ============================================================

async function runBackfill(): Promise<void> {
    console.log('🚀 Starting Batch Serving Backfill\n');

    resetAiCallMetrics();

    const stats: BackfillStats = {
        total: 0,
        success: 0,
        skipped: 0,
        errors: 0,
        byGapType: { volume: 0, weight: 0 },
    };

    const results: BackfillResult[] = [];

    // FatSecret Backfill
    if (CACHE_FILTER === 'all' || CACHE_FILTER === 'fatsecret') {
        console.log('📦 Finding FatSecret foods needing backfill...');
        const fatSecretFoods = await findFatSecretFoodsNeedingBackfill(LIMIT);
        console.log(`   Found ${fatSecretFoods.length} foods with serving gaps\n`);

        for (let i = 0; i < fatSecretFoods.length; i++) {
            const food = fatSecretFoods[i];
            stats.total++;

            // Progress indicator
            if (i % 10 === 0 || i === fatSecretFoods.length - 1) {
                process.stdout.write(`\r   Processing: ${i + 1}/${fatSecretFoods.length}`);
            }

            try {
                const result = await backfillFatSecretFood(food);
                results.push(result);

                if (result.status === 'success') {
                    stats.success++;
                    stats.byGapType[result.gapType]++;
                } else if (result.status === 'skipped') {
                    stats.skipped++;
                } else {
                    stats.errors++;
                }
            } catch (err) {
                stats.errors++;
                results.push({
                    foodId: food.id,
                    foodName: food.name,
                    source: 'fatsecret',
                    gapType: 'volume',
                    status: 'error',
                    error: (err as Error).message,
                });
            }
        }
        console.log('\n');
    }

    // Print Results
    console.log('\n' + '='.repeat(60));
    console.log('BACKFILL RESULTS');
    console.log('='.repeat(60));

    console.log(`\n📊 Statistics:`);
    console.log(`   Total Processed: ${stats.total}`);
    console.log(`   ✅ Success: ${stats.success}`);
    console.log(`   ⏭️  Skipped: ${stats.skipped}`);
    console.log(`   ❌ Errors: ${stats.errors}`);
    console.log(`   Volume Backfills: ${stats.byGapType.volume}`);
    console.log(`   Weight Backfills: ${stats.byGapType.weight}`);

    if (DRY_RUN) {
        console.log('\n⚠️  DRY RUN - No changes were saved to the database');
    }

    // Sample of successful backfills
    const successResults = results.filter(r => r.status === 'success').slice(0, 10);
    if (successResults.length > 0) {
        console.log(`\n📝 Sample Successful Backfills (first ${successResults.length}):`);
        for (const r of successResults) {
            console.log(`   • ${r.foodName}: ${r.servingLabel} = ${r.grams}g (conf: ${r.confidence?.toFixed(2)})`);
        }
    }

    // Sample of errors
    const errorResults = results.filter(r => r.status === 'error').slice(0, 5);
    if (errorResults.length > 0) {
        console.log(`\n⚠️  Sample Errors (first ${errorResults.length}):`);
        for (const r of errorResults) {
            console.log(`   • ${r.foodName}: ${r.error}`);
        }
    }

    console.log('\n' + getAiCallSummary());

    await prisma.$disconnect();
}

runBackfill().catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
});
