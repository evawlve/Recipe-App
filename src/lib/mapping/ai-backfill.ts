import crypto from 'node:crypto';
import { prisma } from '../db';
import { logger } from '../logger';
import { requestAiServing, type ServingGapType, type UnifiedFoodForAi } from '../ai/serving-estimator';
import {
    FATSECRET_CACHE_AI_MAX_DENSITY,
    FATSECRET_CACHE_AI_MIN_DENSITY,
} from './config';
import type { FdcFood, FdcServing, OffFood, OffServing, AiGeneratedFood, AiGeneratedServing, Prisma } from '@prisma/client';

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
    food: AiGeneratedFood & { servings: AiGeneratedServing[] }
): UnifiedFoodForAi {
    return {
        id: food.id,
        name: food.displayName,
        brandName: null,
        foodType: 'Generic',
        nutrientsPer100g: {
            calories: food.caloriesPer100g,
            protein: food.proteinPer100g,
            carbohydrate: food.carbsPer100g,
            fat: food.fatPer100g,
        },
        servings: food.servings.map(s => ({
            description: s.label,
            grams: s.grams,
            volumeMl: s.volumeMl,
        })),
        source: 'fatsecret',
    };
}

function adaptFdcToUnified(
    food: FdcFood & { servings: FdcServing[] }
): UnifiedFoodForAi {
    const nutrients = food.nutrientsPer100g as Record<string, unknown> | null;
    return {
        id: `fdc_${food.fdcId}`,
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
            volumeMl: null,
        })),
        source: 'fdc',
    };
}

export interface InsertAiServingOptions {
    dryRun?: boolean;
    promptDebug?: boolean;
    targetServingUnit?: string;
    prepModifier?: string;
    isOnDemandBackfill?: boolean;
    candidateData?: {
        id: string;
        name: string;
        brandName?: string | null;
        foodType?: string;
        source: 'fdc' | 'openfoodfacts' | 'ai_generated';
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

function adaptCandidateToUnified(candidate: InsertAiServingOptions['candidateData']): UnifiedFoodForAi | null {
    if (!candidate) return null;

    const source = candidate.source;
    if (source !== 'fdc' && source !== 'openfoodfacts' && source !== 'ai_generated') return null;

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
        source: source === 'fdc' ? 'fdc' : 'fatsecret',
    };
}

export async function insertAiServing(
    foodId: string,
    gapType: ServingGapType,
    options: InsertAiServingOptions = {}
): Promise<{ success: boolean; reason?: string }> {
    const isFdc = foodId.startsWith('fdc_');
    const isOff = foodId.startsWith('off_');
    let food: UnifiedFoodForAi | null = null;

    if (options.candidateData) {
        food = adaptCandidateToUnified(options.candidateData);
        if (food) {
            logger.debug('ai_backfill.using_candidate_data', { foodId, foodName: food.name });
        }
    }

    if (!food) {
        if (isFdc) {
            const fdcId = parseInt(foodId.replace('fdc_', ''), 10);
            const fdcFood = await prisma.fdcFood.findUnique({
                where: { fdcId },
                include: { servings: true },
            });
            if (fdcFood) {
                food = adaptFdcToUnified(fdcFood);
            }
        } else if (isOff) {
            const barcode = foodId.replace('off_', '');
            const offFood = await prisma.offFood.findUnique({
                where: { barcode },
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
                    source: 'fatsecret',
                };
            }
        } else {
            const fsFood = await prisma.aiGeneratedFood.findUnique({
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
        logger.info('AI prompt debug', { foodId, gapType, prompt: aiResult.prompt });
        logger.info('AI response debug', { foodId, gapType, raw: aiResult.raw, suggestion: aiResult.status === 'success' ? aiResult.suggestion : undefined });
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
        logger.warn('AI did not return a convertible volume', { foodId, serving: suggestion.servingLabel });
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
        logger.info('DRY RUN: would insert AI-derived serving', {
            foodId,
            gapType,
            servingId,
            label: suggestion.servingLabel,
            grams: suggestion.grams,
            volumeMl,
            confidence: suggestion.confidence,
        });
        return { success: true };
    }

    await prisma.$transaction(async (tx) => {
        if (isFdc) {
            const fdcId = parseInt(foodId.replace('fdc_', ''), 10);
            const fdcDensity = volumeMl && !countServing ? suggestion.grams / volumeMl : null;

            await tx.fdcServing.upsert({
                where: {
                    FdcServing_fdcId_description_key: {
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
                    confidence: suggestion.confidence,
                    note: suggestion.rationale,
                },
            });
        } else if (isOff) {
            const barcode = foodId.replace('off_', '');
            await tx.offServing.upsert({
                where: {
                    barcode_description: {
                        barcode,
                        description: suggestion.servingLabel,
                    },
                },
                create: {
                    barcode,
                    description: suggestion.servingLabel,
                    grams: suggestion.grams,
                    volumeMl: volumeMl,
                    derivedViaDensity: volumeMl != null && !countServing,
                    densityGml: density,
                    source: 'ai',
                    isAiEstimated: true,
                    confidence: suggestion.confidence,
                    note: suggestion.rationale,
                },
                update: {
                    grams: suggestion.grams,
                    volumeMl: volumeMl,
                    derivedViaDensity: volumeMl != null && !countServing,
                    densityGml: density,
                    confidence: suggestion.confidence,
                    note: suggestion.rationale,
                },
            });
        } else {
            let targetFoodId = foodId;
            const foodExists = await tx.aiGeneratedFood.findUnique({
                where: { id: foodId },
                select: { id: true },
            });

            if (!foodExists) {
                if (options.candidateData) {
                    const existingByName = await tx.aiGeneratedFood.findUnique({
                        where: { ingredientName: options.candidateData.name },
                        select: { id: true },
                    });

                    if (!existingByName) {
                        logger.info('ai_backfill.seeding_food_to_cache', { foodId });
                        await tx.aiGeneratedFood.create({
                            data: {
                                id: foodId,
                                ingredientName: options.candidateData.name,
                                displayName: options.candidateData.name,
                                caloriesPer100g: options.candidateData.nutrition?.kcal ?? 0,
                                proteinPer100g: options.candidateData.nutrition?.protein ?? 0,
                                carbsPer100g: options.candidateData.nutrition?.carbs ?? 0,
                                fatPer100g: options.candidateData.nutrition?.fat ?? 0,
                                aiConfidence: 0.95,
                                aiModel: 'google/gemini-2.0-flash',
                            }
                        });
                    } else {
                        targetFoodId = existingByName.id;
                    }
                } else {
                    logger.warn('ai_backfill.food_not_in_cache_no_data', { foodId });
                    return;
                }
            }

            await tx.aiGeneratedServing.upsert({
                where: {
                    foodId_label: {
                        foodId: targetFoodId,
                        label: suggestion.servingLabel,
                    },
                },
                create: {
                    foodId: targetFoodId,
                    label: suggestion.servingLabel,
                    grams: suggestion.grams,
                    volumeMl: volumeMl,
                    aiConfidence: suggestion.confidence ?? 0.9,
                    aiNotes: suggestion.rationale,
                },
                update: {
                    grams: suggestion.grams,
                    volumeMl: volumeMl,
                    aiConfidence: suggestion.confidence ?? 0.9,
                    aiNotes: suggestion.rationale,
                },
            });
        }
    });

    logger.info(
        `Inserted AI-derived ${isFdc ? 'FDC' : 'Generic'} serving`,
        { foodId, servingId, gapType, label: suggestion.servingLabel, source: isFdc ? 'fdc' : 'ai_generated' },
    );

    return { success: true };
}

export async function backfillWeightServing(
    foodId: string
): Promise<{ success: boolean; reason?: string }> {
    const food = await prisma.aiGeneratedFood.findUnique({
        where: { id: foodId },
        include: { servings: true },
    });

    if (!food) {
        logger.warn('backfillWeightServing: Food not found', { foodId });
        return { success: false, reason: 'food_not_found' };
    }

    const hasWeightServing = food.servings.some(s => {
        const unit = s.label.toLowerCase();
        return unit === 'g' || unit === 'gram' || unit === 'grams';
    });

    if (hasWeightServing) {
        logger.debug('backfillWeightServing: Already has weight serving', { foodId, name: food.displayName });
        return { success: true };
    }

    try {
        await prisma.aiGeneratedServing.upsert({
            where: {
                foodId_label: {
                    foodId,
                    label: 'g',
                },
            },
            create: {
                foodId,
                label: 'g',
                grams: 1,
                aiConfidence: 0.95,
                aiNotes: 'AI-backfilled weight serving for gram-based calculations',
            },
            update: {},
        });

        logger.info(
            'Inserted AI-derived weight (1g) serving',
            { foodId, name: food.displayName },
        );

        return { success: true };
    } catch (err) {
        logger.error('backfillWeightServing failed', { foodId, error: (err as Error).message });
        return { success: false, reason: 'db_error' };
    }
}
