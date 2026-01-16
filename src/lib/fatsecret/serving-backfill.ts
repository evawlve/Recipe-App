/**
 * Serving Backfill Strategy
 * 
 * Ensures every hydrated food has:
 * 1. Weight-based serving (canonical) - REQUIRED
 * 2. Human-readable serving (volume OR count) - REQUIRED
 * 
 * Core principles:
 * - Weight-based (grams) is canonical truth for math
 * - Count-based is first-class for discrete items (tortilla, egg)
 * - Volume-based for liquids/powders (milk, flour)
 * - On-demand backfill for edge cases
 */

import type { FatSecretServingCache, FatSecretFoodCache } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import { insertAiServing } from './ai-backfill';

// ============================================================
// Discrete Item Detection
// ============================================================

/**
 * Items that are naturally measured by count, not volume.
 * These should get count-based servings, not volume.
 */
const DISCRETE_ITEMS = new Set([
    // Breads & wraps
    'tortilla', 'bread', 'bagel', 'roll', 'bun', 'muffin', 'croissant',
    'wrap', 'pita', 'flatbread', 'naan', 'biscuit', 'cracker', 'cookie',

    // Eggs
    'egg', 'eggs',

    // Produce
    'clove', 'stalk', 'leaf', 'sprig', 'wedge', 'slice', 'strip',

    // Proteins
    'patty', 'strip', 'piece', 'fillet', 'cutlet',

    // Other discrete items
    'chip', 'chip', 'wafer', 'sheet', 'nugget', 'stick',
]);

const DISCRETE_PATTERNS = [
    /tortilla/i,
    /bread/i,
    /bagel/i,
    /egg(?!plant)/i,  // egg but not eggplant
    /wrap/i,
    /muffin/i,
    /cookie/i,
    /cracker/i,
    /chip/i,
    /slice/i,
];

/**
 * Detect if an ingredient is discrete (count-based).
 */
export function isDiscreteItem(name: string): boolean {
    const lower = name.toLowerCase();

    // Check exact matches
    const tokens = lower.split(/\s+/);
    for (const token of tokens) {
        if (DISCRETE_ITEMS.has(token)) {
            return true;
        }
    }

    // Check patterns
    return DISCRETE_PATTERNS.some(pattern => pattern.test(lower));
}

// ============================================================
// Serving Detection
// ============================================================

/**
 * Check if a serving is weight-based (grams).
 */
export function isWeightServing(serving: Pick<FatSecretServingCache, 'metricServingUnit' | 'servingWeightGrams'>): boolean {
    const unit = serving.metricServingUnit?.toLowerCase();
    return (
        unit === 'g' ||
        unit === 'gram' ||
        unit === 'grams' ||
        unit === 'oz' ||
        unit === 'ounce' ||
        (serving.servingWeightGrams != null && serving.servingWeightGrams > 0)
    );
}

/**
 * Check if a serving is volume-based (cups, tbsp, ml).
 */
export function isVolumeServing(serving: Pick<FatSecretServingCache, 'metricServingUnit' | 'volumeMl'>): boolean {
    const unit = serving.metricServingUnit?.toLowerCase();
    const volumeUnits = ['ml', 'cup', 'cups', 'tbsp', 'tablespoon', 'tsp', 'teaspoon', 'fl oz', 'liter', 'l'];
    return (
        (unit && volumeUnits.some(v => unit.includes(v))) ||
        (serving.volumeMl != null && serving.volumeMl > 0)
    );
}

/**
 * Check if a serving is count-based (1 tortilla, 1 egg).
 */
export function isCountServing(serving: Pick<FatSecretServingCache, 'metricServingUnit' | 'measurementDescription'>): boolean {
    const unit = serving.metricServingUnit?.toLowerCase() || '';
    const desc = serving.measurementDescription?.toLowerCase() || '';

    const countIndicators = ['count', 'item', 'piece', 'each', 'whole', 'unit'];

    return (
        countIndicators.some(c => unit.includes(c) || desc.includes(c)) ||
        DISCRETE_PATTERNS.some(p => p.test(desc))
    );
}

/**
 * Check if a serving is human-readable (volume OR count).
 */
export function isHumanReadableServing(serving: Pick<FatSecretServingCache, 'metricServingUnit' | 'volumeMl' | 'measurementDescription'>): boolean {
    return isVolumeServing(serving) || isCountServing(serving);
}

// ============================================================
// Backfill Detection
// ============================================================

export interface ServingGaps {
    needsWeight: boolean;
    needsHumanReadable: boolean;
    suggestedType: 'volume' | 'count' | null;
}

/**
 * Analyze servings and determine what's missing.
 */
export function detectServingGaps(
    foodName: string,
    servings: Array<Pick<FatSecretServingCache, 'metricServingUnit' | 'servingWeightGrams' | 'volumeMl' | 'measurementDescription'>>
): ServingGaps {
    const hasWeight = servings.some(s => isWeightServing(s));
    const hasHumanReadable = servings.some(s => isHumanReadableServing(s));

    let suggestedType: 'volume' | 'count' | null = null;

    if (!hasHumanReadable) {
        // Determine what type of human-readable serving to create
        if (isDiscreteItem(foodName)) {
            suggestedType = 'count';
        } else {
            suggestedType = 'volume';
        }
    }

    return {
        needsWeight: !hasWeight,
        needsHumanReadable: !hasHumanReadable,
        suggestedType,
    };
}

// ============================================================
// Main Backfill Function
// ============================================================

export interface EnsureServingsResult {
    status: 'ok' | 'backfilled' | 'error';
    backfilledWeight?: boolean;
    backfilledHumanReadable?: boolean;
    error?: string;
}

/**
 * Ensure a food has both weight-based and human-readable servings.
 * Called during hydration to ensure cache entries are complete.
 */
export async function ensureServings(
    foodId: string,
    options: { skipAiBackfill?: boolean } = {}
): Promise<EnsureServingsResult> {
    // Fetch food with servings
    const food = await prisma.fatSecretFoodCache.findUnique({
        where: { id: foodId },
        include: { servings: true },
    });

    if (!food) {
        return { status: 'error', error: 'food_not_found' };
    }

    const gaps = detectServingGaps(food.name, food.servings);

    // If no gaps, we're done
    if (!gaps.needsWeight && !gaps.needsHumanReadable) {
        logger.debug('backfill.no_gaps', { foodId, name: food.name });
        return { status: 'ok' };
    }

    logger.info('backfill.gaps_detected', {
        foodId,
        name: food.name,
        needsWeight: gaps.needsWeight,
        needsHumanReadable: gaps.needsHumanReadable,
        suggestedType: gaps.suggestedType,
    });

    if (options.skipAiBackfill) {
        logger.debug('backfill.skipped', { foodId, reason: 'skipAiBackfill option' });
        return { status: 'ok' };
    }

    const result: EnsureServingsResult = { status: 'backfilled' };

    // Backfill weight if needed (rare, most foods have this)
    if (gaps.needsWeight) {
        const weightResult = await insertAiServing(foodId, 'weight');
        result.backfilledWeight = weightResult.success;

        if (!weightResult.success) {
            logger.warn('backfill.weight_failed', { foodId, reason: weightResult.reason });
        }
    }

    // Backfill human-readable if needed
    // Always use 'volume' - the AI prompt handles count-based servings for discrete items
    if (gaps.needsHumanReadable && gaps.suggestedType) {
        const humanResult = await insertAiServing(foodId, 'volume');
        result.backfilledHumanReadable = humanResult.success;

        if (!humanResult.success) {
            logger.warn('backfill.human_readable_failed', {
                foodId,
                suggestedType: gaps.suggestedType,
                reason: humanResult.reason
            });
        }
    }

    return result;
}

// ============================================================
// On-Demand Backfill
// ============================================================

/**
 * Backfill a specific serving type on-demand.
 * Used when user requests a format we don't have (e.g., "2 egg whites").
 */
export async function backfillOnDemand(
    foodId: string,
    requestedType: 'count' | 'volume',
    targetUnit?: string
): Promise<{ success: boolean; reason?: string }> {
    const food = await prisma.fatSecretFoodCache.findUnique({
        where: { id: foodId },
        include: { servings: true },
    });

    if (!food) {
        return { success: false, reason: 'food_not_found' };
    }

    // Check if we already have the SPECIFIC unit requested
    // e.g., if user asks for "packet", don't skip just because we have a generic "serving"
    if (targetUnit) {
        const targetLower = targetUnit.toLowerCase();
        const hasSpecificUnit = food.servings.some(s => {
            const desc = (s.measurementDescription || '').toLowerCase();
            const metricUnit = (s.metricServingUnit || '').toLowerCase();
            return desc.includes(targetLower) || metricUnit === targetLower;
        });

        if (hasSpecificUnit) {
            logger.debug('backfill.on_demand_skipped', {
                foodId,
                targetUnit,
                reason: 'specific_unit_exists'
            });
            return { success: true };
        }
    } else {
        // No specific unit - check if we have the general type
        const hasType = requestedType === 'count'
            ? food.servings.some(s => isCountServing(s))
            : food.servings.some(s => isVolumeServing(s));

        if (hasType) {
            logger.debug('backfill.on_demand_skipped', {
                foodId,
                requestedType,
                reason: 'type_already_exists'
            });
            return { success: true };
        }
    }

    logger.info('backfill.on_demand', { foodId, name: food.name, requestedType, targetUnit });

    // Use AI to generate the serving - always pass 'volume' as gapType
    // The AI is smart enough to return count-based servings for discrete items
    // (see serving-estimator.ts prompt which handles count units like 'clove', 'piece')
    // Use isOnDemandBackfill=true for lower confidence threshold (user can see/override grams)
    const result = await insertAiServing(foodId, 'volume', {
        targetServingUnit: targetUnit,
        isOnDemandBackfill: true,  // Lower confidence threshold - user can see and override
    });

    return { success: result.success, reason: result.reason };
}

// ============================================================
// Liquid Detection
// ============================================================

const LIQUID_PATTERNS = [
    /milk/i, /cream/i, /juice/i, /water/i, /broth/i, /stock/i,
    /oil/i, /sauce/i, /syrup/i, /vinegar/i, /wine/i, /beer/i,
    /whiskey/i, /vodka/i, /rum/i, /gin/i, /liqueur/i,
];

/**
 * Detect if an ingredient is a liquid (volume-based).
 */
export function isLiquid(name: string): boolean {
    return LIQUID_PATTERNS.some(p => p.test(name));
}

// ============================================================
// Common Servings Backfill
// ============================================================

/**
 * Backfill common serving options based on food type.
 * Called during deferred hydration to pre-populate serving alternatives.
 * 
 * @param foodId - The food cache ID
 * @param foodName - The food name (for type detection)
 * @param requestedUnit - Optional specific unit from user query
 */
export async function backfillCommonServings(
    foodId: string,
    foodName: string,
    requestedUnit?: string
): Promise<{ backfilled: string[]; skipped: string[] }> {
    const servingsToCreate: string[] = [];

    // 1. Always add the requested unit if provided
    if (requestedUnit) {
        servingsToCreate.push(requestedUnit);
    }

    // 2. Add type-specific common servings
    if (isDiscreteItem(foodName)) {
        // Discrete items: whole, medium, large, piece
        servingsToCreate.push('whole', 'medium', 'large', 'piece');
    } else if (isLiquid(foodName)) {
        // Liquids: tbsp, cup, ml
        servingsToCreate.push('tbsp', 'cup', 'ml');
    } else {
        // Default (powders, general): tsp, tbsp, cup
        servingsToCreate.push('tsp', 'tbsp', 'cup');
    }

    // Dedupe
    const unique = [...new Set(servingsToCreate)];

    logger.info('backfill.common_servings_start', {
        foodId,
        foodName,
        servingsToCreate: unique,
    });

    // Backfill each in parallel
    const results = await Promise.allSettled(
        unique.map(async (unit) => {
            const unitType = isCountUnit(unit) ? 'count' : 'volume';
            const res = await backfillOnDemand(foodId, unitType, unit);
            return { unit, success: res.success };
        })
    );

    const backfilled = results
        .filter((r): r is PromiseFulfilledResult<{ unit: string; success: boolean }> =>
            r.status === 'fulfilled' && r.value.success)
        .map(r => r.value.unit);

    const skipped = results
        .filter((r): r is PromiseFulfilledResult<{ unit: string; success: boolean }> =>
            r.status === 'fulfilled' && !r.value.success)
        .map(r => r.value.unit);

    logger.info('backfill.common_servings_complete', {
        foodId,
        backfilled,
        skipped,
    });

    return { backfilled, skipped };
}

/**
 * Check if a unit is count-based (for backfill type detection).
 */
function isCountUnit(unit: string): boolean {
    const countUnits = ['whole', 'medium', 'large', 'small', 'piece', 'slice', 'item'];
    return countUnits.includes(unit.toLowerCase());
}
