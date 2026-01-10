/**
 * Hydration Module
 * 
 * Hydrates ALL candidates to cache for faster manual mapping lookups.
 * This runs in background (non-blocking) after candidate gathering.
 * 
 * Benefits:
 * - Instant search results in manual mapping modal
 * - No API wait when user picks an alternative
 * - Cache grows organically with relevant foods
 */

import { prisma } from '../db';
import { logger } from '../logger';
import { FatSecretClient } from './client';
import { ensureFoodCached } from './cache';
import { fdcApi } from '../usda/fdc-api';
import type { UnifiedCandidate } from './gather-candidates';

const defaultClient = new FatSecretClient();

// ============================================================
// Single Candidate Hydration (for selected candidate only)
// ============================================================

/**
 * Hydrate a single candidate immediately.
 * Used for the selected/winning candidate during mapping.
 * Remaining candidates are queued for deferred hydration.
 */
export async function hydrateSingleCandidate(
    candidate: UnifiedCandidate,
    client: FatSecretClient = defaultClient
): Promise<boolean> {
    try {
        if (candidate.source === 'fdc') {
            const result = await hydrateFdcToCache(candidate);
            if (result === 'hydrated') {
                // Also ensure servings
                const { ensureServings } = await import('./serving-backfill');
                ensureServings(candidate.id, { skipAiBackfill: false }).catch(() => { });
                return true;
            }
        } else if (candidate.source === 'fatsecret') {
            const result = await hydrateFatSecretToCache(candidate.id, client);
            if (result === 'hydrated') {
                // Also ensure servings
                const { ensureServings } = await import('./serving-backfill');
                ensureServings(candidate.id, { skipAiBackfill: false }).catch(() => { });
                return true;
            }
        }
        // Cache source is already hydrated
        return candidate.source === 'cache';
    } catch (err) {
        logger.debug('hydration.single_failed', {
            id: candidate.id,
            source: candidate.source,
            error: (err as Error).message,
        });
        return false;
    }
}

// ============================================================
// Main Hydration Function
// ============================================================

/**
 * Hydrate all candidates to FatSecretFoodCache for fast manual mapping lookups.
 * This runs in background and doesn't block the main mapping flow.
 * 
 * @param candidates - All candidates gathered from FDC + FatSecret
 * @param client - FatSecret client for fetching full details
 */
export async function hydrateAllCandidates(
    candidates: UnifiedCandidate[],
    client: FatSecretClient = defaultClient
): Promise<{ hydrated: number; skipped: number; errors: number }> {
    const stats = { hydrated: 0, skipped: 0, errors: 0 };

    if (candidates.length === 0) {
        return stats;
    }

    logger.debug('hydration.start', { candidateCount: candidates.length });

    const promises = candidates.map(async (candidate) => {
        try {
            let hydrated = false;

            if (candidate.source === 'fdc') {
                const result = await hydrateFdcToCache(candidate);
                if (result === 'hydrated') {
                    stats.hydrated++;
                    hydrated = true;
                } else if (result === 'skipped') {
                    stats.skipped++;
                }
            } else if (candidate.source === 'fatsecret') {
                const result = await hydrateFatSecretToCache(candidate.id, client);
                if (result === 'hydrated') {
                    stats.hydrated++;
                    hydrated = true;
                } else if (result === 'skipped') {
                    stats.skipped++;
                }
            }

            // Phase 2: Ensure servings after hydration (non-blocking, best-effort)
            if (hydrated) {
                const { ensureServings } = await import('./serving-backfill');
                ensureServings(candidate.id, { skipAiBackfill: false }).catch(err => {
                    logger.debug('hydration.serving_backfill_failed', {
                        id: candidate.id,
                        error: (err as Error).message
                    });
                });
            }
        } catch (err) {
            stats.errors++;
            logger.debug('hydration.candidate_failed', {
                id: candidate.id,
                source: candidate.source,
                name: candidate.name,
                error: (err as Error).message
            });
        }
    });

    await Promise.allSettled(promises);

    logger.info('hydration.complete', stats);
    return stats;
}

// ============================================================
// FatSecret Hydration
// ============================================================

/**
 * Ensure a FatSecret food is fully cached with all details.
 * Uses existing ensureFoodCached function from cache.ts.
 */
async function hydrateFatSecretToCache(
    foodId: string,
    client: FatSecretClient
): Promise<'hydrated' | 'skipped'> {
    // Check if already cached
    const existing = await prisma.fatSecretFoodCache.findUnique({
        where: { id: foodId },
        select: { id: true }
    });

    if (existing) {
        return 'skipped';
    }

    // Use existing cache function to fetch and store
    const result = await ensureFoodCached(foodId, { client });

    if (result?.food) {
        logger.debug('hydration.fatsecret_cached', {
            foodId,
            name: result.food.name
        });
        return 'hydrated';
    }

    return 'skipped';
}

// ============================================================
// FDC Hydration
// ============================================================

/**
 * Hydrate an FDC food to the FatSecretFoodCache for unified search.
 * Converts FDC format to match FatSecretFoodCache schema.
 */
async function hydrateFdcToCache(
    candidate: UnifiedCandidate
): Promise<'hydrated' | 'skipped'> {
    // FDC IDs are prefixed with 'fdc_' in candidates
    const fdcId = candidate.id.replace('fdc_', '');

    // Check if already cached (using legacyFoodId field)
    const existing = await prisma.fatSecretFoodCache.findFirst({
        where: {
            OR: [
                { id: candidate.id },
                { legacyFoodId: fdcId }
            ]
        },
        select: { id: true }
    });

    if (existing) {
        return 'skipped';
    }

    // Fetch full FDC details using getFoodDetails
    const fdcDetails = await fdcApi.getFoodDetails(parseInt(fdcId, 10));

    if (!fdcDetails) {
        logger.debug('hydration.fdc_not_found', { fdcId });
        return 'skipped';
    }

    // Convert FDC nutrients to per-100g format
    const nutrientsPer100g = extractFdcNutrients(fdcDetails);

    // Create cache entry with proper Prisma relations
    await prisma.fatSecretFoodCache.create({
        data: {
            id: candidate.id,  // fdc_123456 format
            legacyFoodId: fdcId,
            name: candidate.name,
            brandName: candidate.brandName || fdcDetails.brandName || null,
            foodType: fdcDetails.dataType || 'FDC',
            source: 'fdc',
            syncedAt: new Date(),
            hash: `fdc_${fdcId}_${Date.now()}`,
            nutrientsPer100g: nutrientsPer100g,
            // Create related servings
            servings: {
                create: buildFdcServings(fdcDetails, candidate.id),
            },
            // Create alias for the food name
            aliases: {
                create: [{
                    alias: candidate.name.toLowerCase(),
                    source: 'fdc',
                }],
            },
        }
    });

    logger.debug('hydration.fdc_cached', {
        fdcId,
        name: candidate.name,
        dataType: fdcDetails.dataType
    });

    return 'hydrated';
}

/**
 * Extract per-100g nutrients from FDC food details.
 */
function extractFdcNutrients(fdcDetails: any): object {
    const nutrients = fdcDetails.foodNutrients || [];

    const getNutrient = (id: number): number | null => {
        const n = nutrients.find((x: any) => x.nutrient?.id === id || x.nutrientId === id);
        return n?.amount ?? n?.value ?? null;
    };

    return {
        kcal: getNutrient(1008),
        protein: getNutrient(1003),
        carbs: getNutrient(1005),
        fat: getNutrient(1004),
        fiber: getNutrient(1079),
        sugar: getNutrient(2000),
        sodium: getNutrient(1093),
    };
}

/**
 * Build servings array from FDC food portions.
 * Returns array compatible with FatSecretServingCache.create
 */
function buildFdcServings(fdcDetails: any, foodId: string): Array<{
    id: string;
    measurementDescription: string;
    numberOfUnits: number;
    metricServingAmount: number;
    metricServingUnit: string;
    servingWeightGrams: number;
    isDefault: boolean;
    source: string;
}> {
    const servings: Array<{
        id: string;
        measurementDescription: string;
        numberOfUnits: number;
        metricServingAmount: number;
        metricServingUnit: string;
        servingWeightGrams: number;
        isDefault: boolean;
        source: string;
    }> = [];

    // Add per-100g serving (canonical)
    servings.push({
        id: `${foodId}_per_100g`,
        measurementDescription: '100g',
        numberOfUnits: 1,
        metricServingAmount: 100,
        metricServingUnit: 'g',
        servingWeightGrams: 100,
        isDefault: true,
        source: 'fdc',
    });

    // Add FDC portions if available
    const portions = fdcDetails.foodPortions || [];
    for (let i = 0; i < Math.min(portions.length, 5); i++) {  // Limit to 5 portions
        const portion = portions[i];
        if (portion.gramWeight && portion.portionDescription) {
            servings.push({
                id: `${foodId}_portion_${portion.id || i}`,
                measurementDescription: portion.portionDescription,
                numberOfUnits: portion.amount || 1,
                metricServingAmount: portion.gramWeight,
                metricServingUnit: 'g',
                servingWeightGrams: portion.gramWeight,
                isDefault: false,
                source: 'fdc',
            });
        }
    }

    return servings;
}
