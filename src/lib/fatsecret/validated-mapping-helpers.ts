/**
 * Helper functions for AI-validated ingredient mappings
 * 
 * This module provides database operations for:
 * - Saving AI-approved mappings to cache
 * - Creating aliases for successful AI corrections
 * - Tracking validation failures for analysis
 * - Retrieving validated mappings
 */

import { prisma } from '@/lib/db';
import type { FatsecretMappedIngredient } from './map-ingredient';
import type { AIValidationResult } from './ai-validation';
import { normalizeQuery } from '../search/normalize';
import { logger } from '../logger';

/**
 * Retrieve a validated mapping from cache by RAW ingredient line
 * @deprecated Use getValidatedMappingByNormalizedName for new code
 */
export async function getValidatedMapping(
    rawIngredient: string,
    source: 'fatsecret' | 'fdc' = 'fatsecret'
): Promise<FatsecretMappedIngredient | null> {
    try {
        const cached = await prisma.validatedMapping.findUnique({
            where: {
                rawIngredient_source: {
                    rawIngredient,
                    source,
                },
            },
        });

        if (!cached) {
            return null;
        }

        // Update usage stats
        await prisma.validatedMapping.update({
            where: { id: cached.id },
            data: {
                usedCount: { increment: 1 },
                lastUsedAt: new Date(),
            },
        });

        logger.debug('validated_mapping.cache_hit', { rawIngredient, source });

        // Convert cached data back to FatsecretMappedIngredient format
        return {
            foodId: cached.foodId,
            foodName: cached.foodName,
            brandName: cached.brandName,
            confidence: cached.aiConfidence,
            source: 'cache',
            // Note: We don't store full serving details in validated cache
            // This is just for quick lookups - actual serving selection happens after
        } as FatsecretMappedIngredient;
    } catch (error) {
        logger.error('validated_mapping.get_error', {
            error: (error as Error).message,
            rawIngredient,
        });
        return null;
    }
}

/**
 * Retrieve a validated mapping from cache by NORMALIZED ingredient name
 * This is the preferred lookup method as it eliminates selection drift
 * 
 * Uses a two-phase lookup:
 * 1. Exact match on normalizedForm
 * 2. Token-set fallback (handles word order variance)
 * 
 * @param normalizedName - The normalized ingredient name to look up
 * @param source - Data source ('fatsecret' or 'fdc')
 * @param rawLine - Optional raw ingredient line for cooking state/modifier validation
 */
export async function getValidatedMappingByNormalizedName(
    normalizedName: string,
    source: 'fatsecret' | 'fdc' = 'fatsecret',
    rawLine?: string
): Promise<FatsecretMappedIngredient | null> {
    try {
        // Phase 1: Exact match
        let cached = await prisma.validatedMapping.findUnique({
            where: {
                normalizedForm_source: {
                    normalizedForm: normalizedName,
                    source,
                },
            },
        });

        // Phase 2: Token-set fallback (handles word order variance)
        if (!cached) {
            cached = await findByTokenSet(normalizedName, source, rawLine);
            if (cached) {
                logger.debug('validated_mapping.token_set_hit', {
                    query: normalizedName,
                    matched: cached.normalizedForm
                });
            }
        }

        if (!cached) {
            return null;
        }

        // Validate cached mapping against current query context (cooking state, modifiers)
        if (rawLine) {
            const { isWrongCookingStateForGrain, hasCriticalModifierMismatch } =
                await import('./filter-candidates');

            if (isWrongCookingStateForGrain(rawLine, normalizedName, cached.foodName) ||
                hasCriticalModifierMismatch(rawLine, cached.foodName, 'cache')) {
                logger.debug('validated_mapping.cache_context_mismatch', {
                    query: normalizedName,
                    rawLine,
                    cachedFood: cached.foodName,
                });
                return null;  // Reject cache hit, force fresh search
            }
        }

        // Update usage stats
        await prisma.validatedMapping.update({
            where: { id: cached.id },
            data: {
                usedCount: { increment: 1 },
                lastUsedAt: new Date(),
            },
        });

        logger.debug('validated_mapping.normalized_cache_hit', { normalizedName, source });

        // Convert cached data back to FatsecretMappedIngredient format
        return {
            foodId: cached.foodId,
            foodName: cached.foodName,
            brandName: cached.brandName,
            confidence: cached.aiConfidence,
            source: 'cache',
        } as FatsecretMappedIngredient;
    } catch (error) {
        logger.error('validated_mapping.get_normalized_error', {
            error: (error as Error).message,
            normalizedName,
        });
        return null;
    }
}

/**
 * Token-set matching helper for cache lookup fallback.
 * Handles word order variance: "extra lean ground beef" matches "ground beef extra lean"
 * 
 * @param normalizedName - The normalized ingredient name
 * @param source - Data source
 * @param rawLine - Optional raw ingredient line for cooking state/modifier validation
 */
async function findByTokenSet(
    normalizedName: string,
    source: 'fatsecret' | 'fdc',
    rawLine?: string
) {
    const inputTokens = new Set(normalizedName.toLowerCase().split(/\s+/).filter(Boolean));
    if (inputTokens.size === 0) return null;

    // Use first and last token to limit candidates (performance optimization)
    const tokenArray = [...inputTokens];
    const firstToken = tokenArray[0];

    const candidates = await prisma.validatedMapping.findMany({
        where: {
            source,
            normalizedForm: { contains: firstToken }
        },
        take: 50,
        // Deterministic ordering: prefer most-used mappings, oldest as tiebreaker
        // This prevents non-determinism when multiple entries share the same token set
        orderBy: [
            { usedCount: 'desc' },
            { createdAt: 'asc' },
        ],
    });

    // Find exact token-set match with validation
    for (const candidate of candidates) {
        const candidateTokens = new Set(
            candidate.normalizedForm.toLowerCase().split(/\s+/).filter(Boolean)
        );
        if (setsEqual(inputTokens, candidateTokens)) {
            // Validate against cooking state and modifiers if rawLine provided
            if (rawLine) {
                const { isWrongCookingStateForGrain, hasCriticalModifierMismatch } =
                    await import('./filter-candidates');

                if (isWrongCookingStateForGrain(rawLine, normalizedName, candidate.foodName) ||
                    hasCriticalModifierMismatch(rawLine, candidate.foodName, 'cache')) {
                    // Skip this candidate, try next one
                    continue;
                }
            }
            return candidate;
        }
    }

    return null;
}

function setsEqual<T>(a: Set<T>, b: Set<T>): boolean {
    if (a.size !== b.size) return false;
    for (const item of a) {
        if (!b.has(item)) return false;
    }
    return true;
}

/**
 * Save an AI-approved mapping to the validated cache
 * Saves by normalizedForm as the primary lookup key
 */
export async function saveValidatedMapping(
    rawIngredient: string,
    mapping: FatsecretMappedIngredient,
    validation: AIValidationResult,
    options?: {
        isAlias?: boolean;
        canonicalRawIngredient?: string;
        normalizedForm?: string;  // If provided, uses this; otherwise normalizes rawIngredient
    }
): Promise<void> {
    const normalizedForm = options?.normalizedForm || normalizeQuery(rawIngredient);

    try {
        // Save by normalizedForm (primary lookup key)
        await prisma.validatedMapping.upsert({
            where: {
                normalizedForm_source: {
                    normalizedForm,
                    source: 'fatsecret',
                },
            },
            create: {
                id: `vm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                rawIngredient,  // Store for reference/debugging
                normalizedForm,
                foodId: mapping.foodId,
                foodName: mapping.foodName,
                brandName: mapping.brandName,
                source: 'fatsecret',
                aiConfidence: validation.confidence,
                validationReason: validation.reason,
                isAlias: options?.isAlias ?? false,
                canonicalRawIngredient: options?.canonicalRawIngredient,
                validatedBy: 'ai',
                usedCount: 1,
            },
            update: {
                // If mapping already exists, just increment usage
                usedCount: { increment: 1 },
                lastUsedAt: new Date(),
            },
        });

        logger.info('validated_mapping.saved', {
            rawIngredient,
            normalizedForm,
            foodName: mapping.foodName,
            isAlias: options?.isAlias ?? false,
            aiConfidence: validation.confidence,
        });
    } catch (error) {
        logger.error('validated_mapping.save_error', {
            error: (error as Error).message,
            rawIngredient,
            normalizedForm,
        });
    }
}

/**
 * Track a validation failure for analysis
 */
export async function trackValidationFailure(
    rawIngredient: string,
    attemptedMapping: FatsecretMappedIngredient,
    validation: AIValidationResult,
    retryResult?: {
        succeeded: boolean;
        suggestedQuery: string;
    }
): Promise<void> {
    try {
        const failureType = classifyFailureType(validation, retryResult);

        await prisma.mappingValidationFailure.create({
            data: {
                id: `mvf_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                rawIngredient,
                attemptedFoodId: attemptedMapping.foodId,
                attemptedFoodName: attemptedMapping.foodName,
                ourConfidence: attemptedMapping.confidence,
                aiConfidence: validation.confidence,
                aiRejectionReason: validation.reason,
                aiFailureCategory: validation.category || 'unknown',
                failureType,
                aiSuggestedAlternative: validation.suggestedAlternative,
                retrySucceeded: retryResult?.succeeded,
                scoringDetails: {
                    searchExpressions: (attemptedMapping as any).searchExpressions,
                    candidateCount: (attemptedMapping as any).candidateCount,
                },
            },
        });

        logger.warn('validated_mapping.failure_tracked', {
            rawIngredient,
            category: validation.category,
            failureType,
            retrySucceeded: retryResult?.succeeded,
        });
    } catch (error) {
        logger.error('validated_mapping.track_failure_error', {
            error: (error as Error).message,
            rawIngredient,
        });
    }
}

/**
 * Classify failure type based on retry results
 */
function classifyFailureType(
    validation: AIValidationResult,
    retryResult?: { succeeded: boolean; suggestedQuery: string }
): 'parsing_issue' | 'scoring_issue' {
    // If no retry attempted or retry info not available
    if (!retryResult) {
        return 'parsing_issue'; // Default assumption
    }

    // If retry succeeded → original was a parsing issue
    if (retryResult.succeeded) {
        return 'parsing_issue';
    }

    // If retry failed → likely a scoring/search issue
    // The AI's suggestion didn't help, meaning the problem isn't how we phrase it
    return 'scoring_issue';
}

/**
 * Get AI normalize result from cache or return null
 */
export async function getAiNormalizeCache(rawLine: string) {
    try {
        const cached = await prisma.aiNormalizeCache.findUnique({
            where: { rawLine },
        });

        if (!cached) {
            return null;
        }

        // Update usage stats
        await prisma.aiNormalizeCache.update({
            where: { rawLine },
            data: {
                useCount: { increment: 1 },
                lastUsedAt: new Date(),
            },
        });

        return {
            normalizedName: cached.normalizedName,
            synonyms: cached.synonyms as string[],
            prepPhrases: cached.prepPhrases as string[],
            sizePhrases: cached.sizePhrases as string[],
            cookingModifier: cached.cookingModifier ?? undefined,
            nutritionEstimate: cached.estimatedCaloriesPer100g != null ? {
                caloriesPer100g: cached.estimatedCaloriesPer100g,
                proteinPer100g: cached.estimatedProteinPer100g ?? 0,
                carbsPer100g: cached.estimatedCarbsPer100g ?? 0,
                fatPer100g: cached.estimatedFatPer100g ?? 0,
                confidence: cached.nutritionConfidence ?? 0.5,
            } : undefined,
        };
    } catch (error) {
        logger.error('ai_normalize_cache.get_error', {
            error: (error as Error).message,
            rawLine,
        });
        return null;
    }
}

/**
 * Save AI normalize result to cache
 */
export async function saveAiNormalizeCache(
    rawLine: string,
    result: {
        normalizedName: string;
        synonyms: string[];
        prepPhrases: string[];
        sizePhrases: string[];
        cookingModifier?: string;
        nutritionEstimate?: {
            caloriesPer100g: number;
            proteinPer100g: number;
            carbsPer100g: number;
            fatPer100g: number;
            confidence: number;
        };
    }
): Promise<void> {
    try {
        await prisma.aiNormalizeCache.upsert({
            where: { rawLine },
            create: {
                rawLine,
                normalizedName: result.normalizedName,
                synonyms: result.synonyms,
                prepPhrases: result.prepPhrases,
                sizePhrases: result.sizePhrases,
                cookingModifier: result.cookingModifier,
                estimatedCaloriesPer100g: result.nutritionEstimate?.caloriesPer100g,
                estimatedProteinPer100g: result.nutritionEstimate?.proteinPer100g,
                estimatedCarbsPer100g: result.nutritionEstimate?.carbsPer100g,
                estimatedFatPer100g: result.nutritionEstimate?.fatPer100g,
                nutritionConfidence: result.nutritionEstimate?.confidence,
                useCount: 1,
            },
            update: {
                useCount: { increment: 1 },
                lastUsedAt: new Date(),
            },
        });

        logger.debug('ai_normalize_cache.saved', { rawLine });
    } catch (error) {
        logger.error('ai_normalize_cache.save_error', {
            error: (error as Error).message,
            rawLine,
        });
    }
}
