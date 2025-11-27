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
 * Retrieve a validated mapping from cache
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
 * Save an AI-approved mapping to the validated cache
 */
export async function saveValidatedMapping(
    rawIngredient: string,
    mapping: FatsecretMappedIngredient,
    validation: AIValidationResult,
    options?: {
        isAlias?: boolean;
        canonicalRawIngredient?: string;
    }
): Promise<void> {
    try {
        await prisma.validatedMapping.upsert({
            where: {
                rawIngredient_source: {
                    rawIngredient,
                    source: 'fatsecret',
                },
            },
            create: {
                id: `vm_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                rawIngredient,
                normalizedForm: normalizeQuery(rawIngredient),
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
                // If it already exists, just increment usage
                usedCount: { increment: 1 },
                lastUsedAt: new Date(),
            },
        });

        logger.info('validated_mapping.saved', {
            rawIngredient,
            foodName: mapping.foodName,
            isAlias: options?.isAlias ?? false,
            aiConfidence: validation.confidence,
        });
    } catch (error) {
        logger.error('validated_mapping.save_error', {
            error: (error as Error).message,
            rawIngredient,
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
