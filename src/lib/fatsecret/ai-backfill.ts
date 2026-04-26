import crypto from 'node:crypto';
import { prisma } from '../db';
import { logger } from '../logger';
import { requestAiServing, type ServingGapType, type UnifiedFoodForAi } from '../ai/serving-estimator';
import {
    FATSECRET_CACHE_AI_MAX_DENSITY,
    FATSECRET_CACHE_AI_MIN_DENSITY,
} from './config';
import type { FatSecretFoodCache, FatSecretServingCache, FdcFoodCache, FdcServingCache, Prisma } from '@prisma/client';

const VOLUME_UNIT_TO_ML: Record<string, number> = {
    ml: 1,
    milliliter: 1,
    milliliters: 1,
    millilitre: 1,
    millilitres: 1,
    l: 1000,
    liter: 1000,
    liters: 1000,
    litre: 1000,
    litres: 1000,
    cup: 240,
    cups: 240,
    tbsp: 15,
    tablespoon: 15,
    tablespoons: 15,
    tsp: 5,
    teaspoon: 5,
    teaspoons: 5,
    floz: 30,
    'fl oz': 30,
    'fluid ounce': 30,
    'fluid ounces': 30,
    // Small volume units
    dash: 0.625,       // 1 dash ≈ 1/8 tsp ≈ 0.625ml
    dashes: 0.625,
    pinch: 0.3,        // 1 pinch ≈ 1/16 tsp ≈ 0.3ml
    pinches: 0.3,
    // Micro-volume units
    drop: 0.05,        // 1 drop ≈ 0.05ml (medicine dropper / hot sauce)
    drops: 0.05,
    // Cooking spray duration
    second: 0.25,      // 1 second of spray ≈ 0.25ml oil
    seconds: 0.25,
};

// Count-based units - synced with unit-type.ts COUNT_UNITS
const COUNT_UNITS = new Set([
    'count', 'item', 'items', 'piece', 'pieces', 'pc', 'pcs',
    'each', 'ea', 'unit', 'units',
    // Food-specific counts
    'tortilla', 'tortillas', 'egg', 'eggs', 'bagel', 'bagels',
    'patty', 'patties', 'fillet', 'fillets', 'breast', 'breasts',
    'thigh', 'thighs', 'wing', 'wings', 'drumstick', 'drumsticks',
    'clove', 'cloves', 'stalk', 'stalks', 'leaf', 'leaves', 'sprig', 'sprigs',
    'strip', 'strips', 'wedge', 'wedges', 'cube', 'cubes', 'slice', 'slices',
    // Packages and containers
    'packet', 'packets', 'sachet', 'sachets', 'pouch', 'pouches',
    'scoop', 'scoops', 'stick', 'sticks', 'bar', 'bars',
    'envelope', 'envelopes', 'container', 'containers', 'can', 'cans',
    'bottle', 'bottles', 'serving', 'servings',
    // Baked goods
    'cookie', 'cookies', 'cracker', 'crackers', 'chip', 'chips',
    'muffin', 'muffins', 'roll', 'rolls', 'bun', 'buns',
    'wafer', 'wafers', 'sheet', 'sheets',
    // Size descriptors (for whole foods)
    'small', 'medium', 'large', 'whole',
]);

function convertVolumeToMl(unit: string, amount: number): number | null {
    if (!unit || !Number.isFinite(amount) || amount <= 0) return null;
    const normalized = unit.trim().toLowerCase();
    const scale = VOLUME_UNIT_TO_ML[normalized];
    if (!scale) return null;
    return amount * scale;
}

function buildServingId(foodId: string, label: string): string {
    const hash = crypto.createHash('sha1').update(`${foodId}:${label}`).digest('hex').slice(0, 12);
    return `ai_${hash}`;
}

// ============================================================
// Unified Food Adapters for AI Serving Estimation
// ============================================================

function adaptFatSecretToUnified(
    food: FatSecretFoodCache & { servings: FatSecretServingCache[] }
): UnifiedFoodForAi {
    const nutrients = food.nutrientsPer100g as Record<string, unknown> | null;
    return {
        id: food.id,
        name: food.name,
        brandName: food.brandName,
        foodType: food.foodType,
        nutrientsPer100g: {
            calories: typeof nutrients?.calories === 'number' ? nutrients.calories : undefined,
            protein: typeof nutrients?.protein === 'number' ? nutrients.protein : undefined,
            carbohydrate: typeof nutrients?.carbohydrate === 'number' ? nutrients.carbohydrate : undefined,
            fat: typeof nutrients?.fat === 'number' ? nutrients.fat : undefined,
            fiber: typeof nutrients?.fiber === 'number' ? nutrients.fiber : undefined,
        },
        servings: food.servings.map(s => ({
            description: s.measurementDescription ?? 'serving',
            grams: s.servingWeightGrams,
            volumeMl: s.volumeMl,
        })),
        source: 'fatsecret',
    };
}

function adaptFdcToUnified(
    food: FdcFoodCache & { servings: FdcServingCache[] }
): UnifiedFoodForAi {
    const nutrients = food.nutrients as Record<string, unknown> | null;
    return {
        id: `fdc_${food.id}`,
        name: food.description,
        brandName: food.brandName,
        foodType: food.dataType,
        nutrientsPer100g: {
            calories: typeof nutrients?.calories === 'number' ? nutrients.calories :
                typeof nutrients?.energy === 'number' ? nutrients.energy : undefined,
            protein: typeof nutrients?.protein === 'number' ? nutrients.protein : undefined,
            carbohydrate: typeof nutrients?.carbohydrate === 'number' ? nutrients.carbohydrate :
                typeof nutrients?.carbs === 'number' ? nutrients.carbs : undefined,
            fat: typeof nutrients?.fat === 'number' ? nutrients.fat :
                typeof nutrients?.totalFat === 'number' ? nutrients.totalFat : undefined,
            fiber: typeof nutrients?.fiber === 'number' ? nutrients.fiber : undefined,
        },
        servings: food.servings.map(s => ({
            description: s.description,
            grams: s.grams,
            volumeMl: null, // FDC servings don't track volumeMl separately
        })),
        source: 'fdc',
    };
}

export interface InsertAiServingOptions {
    dryRun?: boolean;
    promptDebug?: boolean;
    /** Specific unit to estimate (e.g., "packet", "scoop", "slice") */
    targetServingUnit?: string;
    /** Prep modifier to include in serving label (e.g., "cubed", "minced", "sliced") */
    prepModifier?: string;
    /** Use lower confidence threshold (for on-demand backfills where user can see/override) */
    isOnDemandBackfill?: boolean;
    /** 
     * Pass candidate data directly to avoid DB lookup race condition.
     * When food comes from API but hasn't been cached yet, this allows
     * backfill to work without requiring the food to be in the database.
     */
    candidateData?: {
        id: string;
        name: string;
        brandName?: string | null;
        foodType?: string;
        source: 'fatsecret' | 'fdc' | 'cache' | 'openfoodfacts';
        nutrition?: {
            kcal: number;
            protein: number;
            carbs: number;
            fat: number;
            per100g: boolean;
        };
        servings?: Array<{
            description: string;
            grams: number | null;
            isDefault?: boolean;
        }>;
    };
}

/**
 * Adapt a UnifiedCandidate (from gather-candidates) to UnifiedFoodForAi.
 * This allows backfill to work without requiring the food to be in the database.
 */
function adaptCandidateToUnified(candidate: InsertAiServingOptions['candidateData']): UnifiedFoodForAi | null {
    if (!candidate) return null;

    const source = candidate.source === 'cache' ? 'fatsecret' : candidate.source;
    if (source !== 'fatsecret' && source !== 'fdc') return null;

    return {
        id: candidate.id,
        name: candidate.name,
        brandName: candidate.brandName ?? null,
        foodType: candidate.foodType ?? null,
        nutrientsPer100g: candidate.nutrition ? {
            calories: candidate.nutrition.kcal,
            protein: candidate.nutrition.protein,
            carbohydrate: candidate.nutrition.carbs,
            fat: candidate.nutrition.fat,
        } : {},
        servings: (candidate.servings ?? []).map(s => ({
            description: s.description,
            grams: s.grams,
            volumeMl: null,
        })),
        source,
    };
}

export async function insertAiServing(
    foodId: string,
    gapType: ServingGapType,
    options: InsertAiServingOptions = {}
): Promise<{ success: boolean; reason?: string }> {
    // Detect FDC vs FatSecret vs OpenFoodFacts based on ID prefix
    const isFdc = foodId.startsWith('fdc_');
    const isOff = foodId.startsWith('off_');
    let food: UnifiedFoodForAi | null = null;

    // PRIORITY 1: Use passed candidate data (avoids DB race condition)
    if (options.candidateData) {
        food = adaptCandidateToUnified(options.candidateData);
        if (food) {
            logger.debug('ai_backfill.using_candidate_data', { foodId, foodName: food.name });
        }
    }

    // PRIORITY 2: Fallback to database lookup
    if (!food) {
        if (isFdc) {
            const fdcId = parseInt(foodId.replace('fdc_', ''), 10);
            const fdcFood = await prisma.fdcFoodCache.findUnique({
                where: { id: fdcId },
                include: { servings: true },
            });
            if (fdcFood) {
                food = adaptFdcToUnified(fdcFood);
            }
        } else if (isOff) {
            // OpenFoodFacts: look up in OpenFoodFactsCache
            const offFood = await prisma.openFoodFactsCache.findUnique({
                where: { id: foodId },
                include: { servings: true },
            });
            if (offFood) {
                const nutrients = offFood.nutrientsPer100g as Record<string, number> | null;
                food = {
                    id: foodId,
                    name: offFood.name,
                    brandName: offFood.brandName,
                    foodType: 'Branded',
                    nutrientsPer100g: {
                        calories: nutrients?.kcal ?? nutrients?.calories ?? undefined,
                        protein: nutrients?.protein ?? undefined,
                        carbohydrate: nutrients?.carbs ?? nutrients?.carbohydrate ?? undefined,
                        fat: nutrients?.fat ?? undefined,
                    },
                    servings: offFood.servings.map(s => ({
                        description: s.description,
                        grams: s.grams,
                        volumeMl: s.volumeMl ?? null,
                    })),
                    source: 'fatsecret', // Adapter type — OFF uses FS serving schema
                };
            }
        } else {
            const fsFood = await prisma.fatSecretFoodCache.findUnique({
                where: { id: foodId },
                include: { servings: true },
            });
            if (fsFood) {
                food = adaptFatSecretToUnified(fsFood);
            }
        }
    }

    if (!food) {
        logger.warn('Food missing from cache for AI serving backfill', { foodId, isFdc, isOff, hasCandidateData: !!options.candidateData });
        return { success: false, reason: 'food_missing' };
    }


    const aiResult = await requestAiServing({
        gapType,
        food,
        targetServingUnit: options.targetServingUnit,
        prepModifier: options.prepModifier,
        isOnDemandBackfill: options.isOnDemandBackfill,
    });

    if (options.promptDebug) {
        logger.info(
            'AI prompt debug',
            { foodId, gapType, prompt: aiResult.prompt },
        );
        logger.info(
            'AI response debug',
            { foodId, gapType, raw: aiResult.raw, suggestion: aiResult.status === 'success' ? aiResult.suggestion : undefined },
        );
    }

    if (aiResult.status === 'error') {
        logger.warn('AI serving suggestion failed', { foodId, reason: aiResult.reason });
        return { success: false, reason: aiResult.reason };
    }

    const suggestion = aiResult.suggestion;
    let volumeMl =
        suggestion.volumeUnit && suggestion.volumeAmount
            ? convertVolumeToMl(suggestion.volumeUnit, suggestion.volumeAmount)
            : null;

    let countServing = false;
    let countUnit: string | undefined;

    if (gapType === 'volume' && !volumeMl) {
        const unit = suggestion.volumeUnit?.toLowerCase().trim();
        if (suggestion.volumeAmount && suggestion.volumeAmount > 0 && (unit ? COUNT_UNITS.has(unit) : true)) {
            countServing = true;
            countUnit = unit ?? 'count';
            volumeMl = suggestion.volumeAmount;
        } else if (unit && COUNT_UNITS.has(unit)) {
            countServing = true;
            countUnit = unit;
            volumeMl = suggestion.volumeAmount ?? 1;
        }
    }

    if (gapType === 'volume' && !volumeMl && !countServing) {
        logger.warn(
            'AI did not return a convertible volume',
            { foodId, serving: suggestion.servingLabel },
        );
        return { success: false, reason: 'missing_volume_unit' };
    }

    if (suggestion.grams <= 0) {
        logger.warn('AI returned invalid gram weight', { foodId });
        return { success: false, reason: 'invalid_grams' };
    }

    const density = volumeMl && !countServing ? suggestion.grams / volumeMl : null;
    if (
        density &&
        (density < FATSECRET_CACHE_AI_MIN_DENSITY || density > FATSECRET_CACHE_AI_MAX_DENSITY)
    ) {
        logger.warn('AI density outside bounds', { foodId, density });
        return { success: false, reason: 'density_outside_bounds' };
    }

    const servingId = buildServingId(foodId, suggestion.servingLabel);

    if (options.dryRun) {
        logger.info(
            'DRY RUN: would insert AI-derived serving',
            {
                foodId,
                gapType,
                servingId,
                label: suggestion.servingLabel,
                grams: suggestion.grams,
                volumeMl,
                confidence: suggestion.confidence,
            },
        );
        return { success: true };
    }

    let densityEstimateId: string | undefined;

    await prisma.$transaction(async (tx) => {
        if (isFdc) {
            // FDC: Now supports full volume/density tracking like FatSecret
            const fdcId = parseInt(foodId.replace('fdc_', ''), 10);

            // Calculate density if we have volume info
            const fdcDensity = volumeMl && !countServing ? suggestion.grams / volumeMl : null;

            // Upsert using the unique constraint on (fdcId, description)
            await tx.fdcServingCache.upsert({
                where: {
                    FdcServingCache_fdcId_description_key: {
                        fdcId,
                        description: suggestion.servingLabel,
                    },
                },
                create: {
                    fdcId,
                    description: suggestion.servingLabel,
                    grams: suggestion.grams,
                    volumeMl: volumeMl,
                    derivedViaDensity: volumeMl != null && !countServing,
                    densityGml: fdcDensity,
                    prepModifier: suggestion.prepModifier ?? options.prepModifier,
                    source: 'ai',
                    isAiEstimated: true,
                    confidence: suggestion.confidence,
                    note: suggestion.rationale,
                },
                update: {
                    grams: suggestion.grams,
                    volumeMl: volumeMl,
                    derivedViaDensity: volumeMl != null && !countServing,
                    densityGml: fdcDensity,
                    prepModifier: suggestion.prepModifier ?? options.prepModifier,
                    source: 'ai',
                    isAiEstimated: true,
                    confidence: suggestion.confidence,
                    note: suggestion.rationale,
                },
            });
        } else if (isOff) {
            // OpenFoodFacts: upsert into OpenFoodFactsServingCache
            // OFF products are already hydrated into OpenFoodFactsCache by hydrateOffCandidate,
            // so we only need to add the AI-derived serving entry here.
            await tx.openFoodFactsServingCache.upsert({
                where: {
                    offId_description: {
                        offId:       foodId,
                        description: suggestion.servingLabel,
                    },
                },
                create: {
                    offId:         foodId,
                    description:   suggestion.servingLabel,
                    grams:         suggestion.grams,
                    source:        'ai',
                    isAiEstimated: true,
                    confidence:    suggestion.confidence,
                    note:          suggestion.rationale,
                },
                update: {
                    grams:      suggestion.grams,
                    source:     'ai',
                    confidence: suggestion.confidence,
                    note:       suggestion.rationale,
                },
            });
        } else {
            // FatSecret: Full serving cache with density estimates
            // Check if the food exists in cache before FK-dependent inserts
            const foodExists = await tx.fatSecretFoodCache.findUnique({
                where: { id: foodId },
                select: { id: true },
            });

            if (!foodExists) {
                if (options.candidateData) {
                    logger.info('ai_backfill.seeding_food_to_cache', { foodId });
                    await tx.fatSecretFoodCache.create({
                        data: {
                            id: foodId,
                            name: options.candidateData.name,
                            brandName: options.candidateData.brandName ?? null,
                            foodType: options.candidateData.foodType ?? 'Generic',
                            source: options.candidateData.source,
                            confidence: 0.95,
                            hash: `seed_for_ai_${foodId}`,
                            syncedAt: new Date(),
                            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h
                        }
                    });
                } else {
                    logger.warn('ai_backfill.food_not_in_cache_no_data', { foodId });
                    return;
                }
            }

            if (density && volumeMl) {
                const densityRow = await tx.fatSecretDensityEstimate.create({
                    data: {
                        foodId,
                        densityGml: density,
                        source: 'ai',
                        confidence: suggestion.confidence,
                        notes: suggestion.rationale,
                    },
                });
                densityEstimateId = densityRow.id;
            }

            await tx.fatSecretServingCache.upsert({
                where: { id: servingId },
                create: {
                    id: servingId,
                    foodId,
                    measurementDescription: suggestion.servingLabel,
                    numberOfUnits: suggestion.volumeAmount ?? (countServing ? 1 : undefined),
                    metricServingAmount: volumeMl ?? suggestion.grams,
                    metricServingUnit: countServing ? (countUnit ?? suggestion.volumeUnit ?? 'count') : volumeMl ? 'ml' : 'g',
                    servingWeightGrams: suggestion.grams,
                    volumeMl,
                    isVolume: gapType === 'volume',
                    isDefault: false,
                    derivedViaDensity: volumeMl != null && !countServing,
                    densityEstimateId,
                    source: 'ai',
                    confidence: suggestion.confidence,
                    note: suggestion.rationale,
                },
                update: {
                    measurementDescription: suggestion.servingLabel,
                    numberOfUnits: suggestion.volumeAmount ?? (countServing ? 1 : undefined),
                    metricServingAmount: volumeMl ?? suggestion.grams,
                    metricServingUnit: countServing ? (countUnit ?? suggestion.volumeUnit ?? 'count') : volumeMl ? 'ml' : 'g',
                    servingWeightGrams: suggestion.grams,
                    volumeMl,
                    isVolume: gapType === 'volume',
                    derivedViaDensity: volumeMl != null && !countServing,
                    densityEstimateId,
                    source: 'ai',
                    confidence: suggestion.confidence,
                    note: suggestion.rationale,
                },
            });
        }
    });

    logger.info(
        `Inserted AI-derived ${isFdc ? 'FDC' : 'FatSecret'} serving`,
        { foodId, servingId, gapType, label: suggestion.servingLabel, source: isFdc ? 'fdc' : 'fatsecret' },
    );

    return { success: true };
}

// ============================================================
// Weight Serving Backfill
// ============================================================

/**
 * Backfill a weight-based (grams) serving for foods that lack one.
 * Creates a standard "100 g" serving using nutrientsPer100g data.
 * 
 * This is called when:
 * 1. Winner candidate has better score but lacks weight serving
 * 2. User requested a weight unit (oz, g, lb, etc.)
 * 3. Hydration failed because selectServing found no gram-based serving
 * 
 * @param foodId - FatSecret food ID
 * @returns Success status and reason if failed
 */
export async function backfillWeightServing(
    foodId: string
): Promise<{ success: boolean; reason?: string }> {
    const food = await prisma.fatSecretFoodCache.findUnique({
        where: { id: foodId },
        include: { servings: true },
    });

    if (!food) {
        logger.warn('backfillWeightServing: Food not found', { foodId });
        return { success: false, reason: 'food_not_found' };
    }

    // Check if we already have a weight-based serving
    const hasWeightServing = food.servings.some(s => {
        const unit = s.metricServingUnit?.toLowerCase();
        return unit === 'g' || unit === 'gram' || unit === 'grams' ||
            (s.servingWeightGrams != null && s.servingWeightGrams > 0 && s.measurementDescription?.toLowerCase() === 'g');
    });

    if (hasWeightServing) {
        logger.debug('backfillWeightServing: Already has weight serving', { foodId, name: food.name });
        return { success: true };
    }

    // Create a 100g serving using the nutrientsPer100g data
    // This is the canonical reference point for all calculations
    const servingId = buildServingId(foodId, '100 g');

    try {
        await prisma.fatSecretServingCache.upsert({
            where: { id: servingId },
            create: {
                id: servingId,
                foodId,
                measurementDescription: 'g',
                numberOfUnits: 100,
                metricServingAmount: 100,
                metricServingUnit: 'g',
                servingWeightGrams: 100,
                volumeMl: null,
                isVolume: false,
                isDefault: false,
                derivedViaDensity: false,
                source: 'ai',
                confidence: 0.95,  // High confidence - this is just a reference unit
                note: 'AI-backfilled weight serving for gram-based calculations',
            },
            update: {
                // Already exists, no update needed
            },
        });

        logger.info(
            'Inserted AI-derived weight (100g) serving',
            { foodId, name: food.name, servingId },
        );

        return { success: true };
    } catch (err) {
        logger.error('backfillWeightServing failed', { foodId, error: (err as Error).message });
        return { success: false, reason: 'db_error' };
    }
}
