/**
 * Ambiguous Unit Backfill
 * 
 * Handles backfill for ambiguous units (container, scoop, bowl, etc.)
 * that require AI estimation to determine weight.
 * 
 * Saves to FatSecretServingCache for FatSecret foods (most common case)
 * or falls back to PortionOverride for legacy Food table entries.
 * Uses simpler AI prompt focused on package/portion size estimation.
 */

import { prisma } from '../db';
import { logger } from '../logger';
import {
    isAmbiguousUnit,
    estimateAmbiguousServing,
    AMBIGUOUS_UNITS,
} from '../ai/ambiguous-serving-estimator';

export { isAmbiguousUnit, AMBIGUOUS_UNITS };

export interface AmbiguousBackfillResult {
    status: 'success' | 'cached' | 'error';
    grams?: number;
    confidence?: number;
    error?: string;
}

/**
 * Get or create a PortionOverride for an ambiguous unit.
 * 
 * Flow:
 * 1. Check if UserPortionOverride exists (highest priority) - not done here, caller should check
 * 2. Check if PortionOverride exists (cached global default)
 * 3. If not, call AI to estimate and save to PortionOverride
 * 
 * @param foodId - The food ID (from legacy Food table)
 * @param foodName - The name of the food for AI context
 * @param unit - The ambiguous unit (e.g., "container", "scoop")
 * @param brandName - Optional brand name for better AI context
 */
export async function getOrCreateAmbiguousServing(
    foodId: string,
    foodName: string,
    unit: string,
    brandName?: string | null
): Promise<AmbiguousBackfillResult> {
    const normalizedUnit = unit.toLowerCase().trim();

    // Check if this is actually an ambiguous unit
    if (!isAmbiguousUnit(normalizedUnit)) {
        return { status: 'error', error: `"${unit}" is not an ambiguous unit` };
    }

    // Check for existing cached estimate in FatSecretServingCache
    const servingId = `ai_${foodId}_${normalizedUnit}`;
    const existingServing = await prisma.fatSecretServingCache.findUnique({
        where: { id: servingId },
    });

    if (existingServing?.servingWeightGrams) {
        logger.debug('ambiguous_backfill.cache_hit', {
            foodId,
            unit: normalizedUnit,
            grams: existingServing.servingWeightGrams,
            source: 'fatsecret_serving_cache',
        });
        return {
            status: 'cached',
            grams: existingServing.servingWeightGrams,
        };
    }

    // Also check legacy PortionOverride (for backward compatibility)
    try {
        const legacyOverride = await prisma.portionOverride.findUnique({
            where: { foodId_unit: { foodId, unit: normalizedUnit } },
        });
        if (legacyOverride) {
            logger.debug('ambiguous_backfill.cache_hit', {
                foodId,
                unit: normalizedUnit,
                grams: legacyOverride.grams,
                source: 'portion_override',
            });
            return { status: 'cached', grams: legacyOverride.grams };
        }
    } catch {
        // foodId might not exist in Food table - expected for FatSecret-only foods
    }

    // No cached value - call AI to estimate
    logger.info('ambiguous_backfill.estimating', { foodId, foodName, unit: normalizedUnit });

    const result = await estimateAmbiguousServing({
        foodName,
        brandName,
        unit: normalizedUnit,
    });

    if (result.status !== 'success' || !result.estimatedGrams) {
        logger.warn('ambiguous_backfill.ai_failed', {
            foodId,
            foodName,
            unit: normalizedUnit,
            error: result.error,
        });
        return { status: 'error', error: result.error ?? 'AI estimation failed' };
    }

    // Save to FatSecretServingCache (works for all FatSecret foods)
    try {
        await prisma.fatSecretServingCache.upsert({
            where: { id: servingId },
            create: {
                id: servingId,
                foodId,
                measurementDescription: normalizedUnit,
                servingWeightGrams: result.estimatedGrams,
                source: 'ai_ambiguous',
                confidence: result.confidence,
                note: result.reasoning?.slice(0, 200),
            },
            update: {
                servingWeightGrams: result.estimatedGrams,
                confidence: result.confidence,
                note: result.reasoning?.slice(0, 200),
            },
        });

        logger.info('ambiguous_backfill.saved', {
            foodId,
            foodName,
            unit: normalizedUnit,
            grams: result.estimatedGrams,
            confidence: result.confidence,
            source: 'fatsecret_serving_cache',
        });
    } catch (error) {
        // If FatSecretFoodCache doesn't exist, log and continue
        logger.warn('ambiguous_backfill.save_failed', {
            foodId,
            unit: normalizedUnit,
            error: (error as Error).message,
        });
    }

    return {
        status: 'success',
        grams: result.estimatedGrams,
        confidence: result.confidence,
    };
}

/**
 * Check for user-specific portion override first, then fall back to global.
 * 
 * @param userId - The user ID to check for overrides
 * @param foodId - The food ID
 * @param unit - The unit to look up
 * @returns The grams value if found, null otherwise
 */
export async function getUserOrGlobalPortionOverride(
    userId: string | null | undefined,
    foodId: string,
    unit: string
): Promise<{ grams: number; source: 'user' | 'global' } | null> {
    const normalizedUnit = unit.toLowerCase().trim();

    // 1. Check user-specific override first (highest priority)
    if (userId) {
        const userOverride = await prisma.userPortionOverride.findUnique({
            where: {
                userId_foodId_unit: { userId, foodId, unit: normalizedUnit },
            },
        });

        if (userOverride) {
            return { grams: userOverride.grams, source: 'user' };
        }
    }

    // 2. Check FatSecretServingCache for AI-estimated ambiguous units
    const servingId = `ai_${foodId}_${normalizedUnit}`;
    const aiServing = await prisma.fatSecretServingCache.findUnique({
        where: { id: servingId },
    });
    if (aiServing?.servingWeightGrams) {
        return { grams: aiServing.servingWeightGrams, source: 'global' };
    }

    // 3. Check legacy PortionOverride
    try {
        const globalOverride = await prisma.portionOverride.findUnique({
            where: { foodId_unit: { foodId, unit: normalizedUnit } },
        });
        if (globalOverride) {
            return { grams: globalOverride.grams, source: 'global' };
        }
    } catch {
        // Food might not exist in Food table
    }

    return null;
}
