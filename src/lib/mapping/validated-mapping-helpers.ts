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
import type { FatsecretMappedIngredient } from './map-ingredient-with-fallback';
import type { AIValidationResult } from './ai-validation';
import { normalizeQuery } from '../search/normalize';
import { logger } from '../logger';
import { hasCoreTokenMismatch } from './filter-candidates';
import { assessSaveTimePlausibility } from './macro-plausibility';
import type { MacroPlausibilityInput, ExpectedNutritionPer100g } from './macro-plausibility';
import { detectBrandInQuery } from './brand-detector';
import { parseIngredientLine } from '../parse/ingredient-line';
import { normalizeIngredientName, canonicalizeCacheKey } from './normalization-rules';

/**
 * Retrieve a validated mapping from cache by RAW ingredient line
 * @deprecated Use getValidatedMappingByNormalizedName for new code
 */
export async function getValidatedMapping(
    rawIngredient: string,
    source: 'fatsecret' | 'fdc' = 'fatsecret'
): Promise<FatsecretMappedIngredient | null> {
    const rawForm = normalizeQuery(rawIngredient);
    const normalizedForm = canonicalizeCacheKey(rawForm);
    return getValidatedMappingByNormalizedName(normalizedForm, source === 'fdc' ? 'fdc' : 'openfoodfacts', rawIngredient);
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
 * @param source - Data source ('fatsecret' or 'fdc' or 'openfoodfacts')
 * @param rawLine - Optional raw ingredient line for cooking state/modifier validation
 */
export async function getValidatedMappingByNormalizedName(
    normalizedName: string,
    source: 'fatsecret' | 'fdc' | 'openfoodfacts' = 'fatsecret',
    rawLine?: string
): Promise<FatsecretMappedIngredient | null> {
    try {
        // Canonicalize the lookup key (lowercase + singularize + sort tokens)
        const canonicalKey = canonicalizeCacheKey(normalizedName);

        let cached = await prisma.foodMapping.findUnique({
            where: { normalizedForm: canonicalKey },
        });

        // Phase 2: Legacy fallback — try the raw normalizedName
        if (!cached) {
            cached = await prisma.foodMapping.findUnique({
                where: { normalizedForm: normalizedName },
            });
        }

        // Phase 3: Token-set fallback
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

        // Validate cached mapping against current query context (cooking state, modifiers, core tokens)
        const { isWrongCookingStateForGrain, hasCriticalModifierMismatch, hasCoreTokenMismatch } =
            await import('./filter-candidates');

        // Always check core token coverage (Jan 2026)
        if (hasCoreTokenMismatch(normalizedName, cached.foodName, cached.brandName)) {
            logger.debug('validated_mapping.cache_core_token_mismatch', {
                query: normalizedName,
                cachedFood: cached.foodName,
            });
            return null;  // Reject cache hit, force fresh search
        }

        // Defense-in-depth: Reject cache hits where the cached food has nutritional modifiers NOT present in the query
        const NUTRITIONAL_MODIFIERS = [
            'powdered', 'reduced fat', 'low fat', 'fat free', 'fat-free',
            'sugar free', 'sugar-free', 'lite', 'light', 'diet',
            'unsweetened', 'sweetened', 'whole wheat', 'whole grain',
            'skim', 'nonfat', 'non-fat', '2%', '1%',
        ];
        const queryLower = normalizedName.toLowerCase();
        const foodLower = cached.foodName.toLowerCase();
        for (const mod of NUTRITIONAL_MODIFIERS) {
            if (foodLower.includes(mod) && !queryLower.includes(mod)) {
                logger.debug('validated_mapping.cache_nutritional_modifier_mismatch', {
                    query: normalizedName,
                    cachedFood: cached.foodName,
                    modifier: mod,
                });
                return null;  // Reject cache hit, force fresh search
            }
        }

        if (rawLine) {
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
        await prisma.foodMapping.update({
            where: { normalizedForm: cached.normalizedForm },
            data: {
                usedCount: { increment: 1 },
                lastUsedAt: new Date(),
            },
        });

        logger.debug('validated_mapping.normalized_cache_hit', { normalizedName, source });

        // Build mapping food ID correctly from FDC ID, OFF barcode, or AI generated food
        let foodId = '';
        if (cached.fdcId) {
            foodId = `fdc_${cached.fdcId}`;
        } else if (cached.offBarcode) {
            foodId = `off_${cached.offBarcode}`;
        } else {
            const aiFood = await prisma.aiGeneratedFood.findFirst({
                where: {
                    OR: [
                        { ingredientName: cached.normalizedForm },
                        { displayName: cached.foodName }
                    ]
                },
                select: { id: true }
            });
            if (aiFood) {
                foodId = aiFood.id;
            } else {
                foodId = cached.normalizedForm;
            }
        }

        return {
            foodId,
            foodName: cached.foodName,
            brandName: cached.brandName,
            confidence: Math.max(0, Math.min(1, cached.aiConfidence)),
            source: cached.source === 'openfoodfacts' ? 'openfoodfacts'
                    : cached.source === 'fdc' ? 'fdc'
                    : 'ai_generated',
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
    source: 'fatsecret' | 'fdc' | 'openfoodfacts',
    rawLine?: string
) {
    const inputTokens = new Set(normalizedName.toLowerCase().split(/\s+/).filter(Boolean));
    if (inputTokens.size === 0) return null;

    // Use first and last token to limit candidates (performance optimization)
    const tokenArray = [...inputTokens];
    const firstToken = tokenArray[0];

    const mappingSource = source === 'fatsecret' ? 'ai_generated' : source;

    const candidates = await prisma.foodMapping.findMany({
        where: {
            source: mappingSource,
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
    const { isWrongCookingStateForGrain, hasCriticalModifierMismatch, hasCoreTokenMismatch } =
        await import('./filter-candidates');

    for (const candidate of candidates) {
        const candidateTokens = new Set(
            candidate.normalizedForm.toLowerCase().split(/\s+/).filter(Boolean)
        );
        if (setsEqual(inputTokens, candidateTokens)) {
            // Always validate core token coverage (Jan 2026)
            if (hasCoreTokenMismatch(normalizedName, candidate.foodName, candidate.brandName)) {
                // Skip this candidate, try next one
                continue;
            }

            // Validate against cooking state and modifiers if rawLine provided
            if (rawLine) {
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
        canonicalBase?: string;   // AI-derived base form for cache key consolidation (highest priority)
        nutrientsPer100g?: MacroPlausibilityInput | null;      // Pick's per-100g macros for the save-time gate
        expectedNutrition?: ExpectedNutritionPer100g | null;   // AI normalize estimate to cross-check against
    }
): Promise<void> {
    // Priority: canonicalBase > normalizedForm > computed from rawIngredient
    const rawForm = options?.canonicalBase || options?.normalizedForm || normalizeQuery(rawIngredient);
    // Canonicalize: lowercase + singularize + sort tokens
    const normalizedForm = canonicalizeCacheKey(rawForm);

    // Pre-save validation: Reject mappings where core tokens from normalizedForm are missing from foodName
    if (hasCoreTokenMismatch(normalizedForm, mapping.foodName, mapping.brandName)) {
        // Brand rescue (mirrors the runtime core-token brand rescue): when the
        // query names a brand and the mapped food carries it — in its brand
        // field or embedded in its name — the "missing" core token is usually
        // a flavor the brand spells differently ("cinnamon" vs "Cinnabon").
        // Rejecting the save forces a full re-resolution on every request.
        const rescueBrand = detectBrandInQuery(rawIngredient).matchedBrand?.toLowerCase().trim();
        const carriesBrand = !!rescueBrand && (
            mapping.brandName?.toLowerCase().includes(rescueBrand) ||
            new RegExp(`\\b${rescueBrand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(mapping.foodName.toLowerCase())
        );
        if (!carriesBrand) {
            logger.warn('validated_mapping.save_rejected_core_token_mismatch', {
                rawIngredient,
                normalizedForm,
                foodName: mapping.foodName,
                brandName: mapping.brandName,
            });
            return; // Don't save this invalid mapping
        }
        logger.info('validated_mapping.save_core_token_brand_rescued', {
            rawIngredient,
            normalizedForm,
            foodName: mapping.foodName,
            brandName: mapping.brandName,
        });
    }

    // Save-time macro-plausibility gate (PR D, Jul 2026): picks that survive
    // ranking can still carry corrupt nutrition — the 2026-07-20 parity sweep
    // cached "granulated sugar" at 16 kcal/100g and "blueberry" at 8.7 g
    // protein — and a bad row then poisons every request until the next sweep.
    // When the caller provides the pick's per-100g macros, block the write
    // instead; the mapping still serves THIS request, it just isn't cached.
    if (options?.nutrientsPer100g) {
        const gate = assessSaveTimePlausibility(
            normalizedForm,
            mapping.foodName,
            options.nutrientsPer100g,
            options.expectedNutrition ?? null,
        );
        if (!gate.save) {
            logger.warn('validated_mapping.save_rejected_implausible_macros', {
                rawIngredient,
                normalizedForm,
                foodName: mapping.foodName,
                brandName: mapping.brandName,
                reasons: gate.reasons,
            });
            return;
        }
    }

    try {
        let fdcId: number | null = null;
        let offBarcode: string | null = null;

        if (mapping.foodId.startsWith('fdc_')) {
            fdcId = parseInt(mapping.foodId.replace('fdc_', ''), 10);
        } else if (mapping.foodId.startsWith('off_')) {
            offBarcode = mapping.foodId.replace('off_', '');
        }

        const mappingSource = offBarcode ? 'openfoodfacts' : fdcId ? 'fdc' : 'ai_generated';
        const clampedConfidence = Math.max(0, Math.min(1, validation.confidence));

        await prisma.foodMapping.upsert({
            where: {
                normalizedForm,
            },
            create: {
                normalizedForm,
                foodName: mapping.foodName,
                brandName: mapping.brandName,
                source: mappingSource,
                offBarcode,
                fdcId,
                aiConfidence: clampedConfidence,
                validatedBy: 'ai',
                usedCount: 1,
            },
            update: {
                // Store the newly resolved food, not just usage: the cache
                // escapes (count-label, brand-guard, cooked-grain) exist to
                // supersede a stale cached food with a re-resolution, and an
                // increment-only update kept the stale row forever — every
                // subsequent request paid the full re-resolution cost.
                foodName: mapping.foodName,
                brandName: mapping.brandName,
                source: mappingSource,
                offBarcode,
                fdcId,
                aiConfidence: clampedConfidence,
                validatedBy: 'ai',
                usedCount: { increment: 1 },
                lastUsedAt: new Date(),
            },
        });

        logger.info('validated_mapping.saved', {
            rawIngredient,
            normalizedForm,
            foodName: mapping.foodName,
            isAlias: options?.isAlias ?? false,
            aiConfidence: clampedConfidence,
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
    // No-op since MappingValidationFailure table was dropped in the new schema
    logger.warn('validated_mapping.failure_detected', {
        rawIngredient,
        category: validation.category,
        aiRejectionReason: validation.reason,
    });
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
 * Compute a normalized cache key from a raw ingredient line.
 * This ensures consistent lookups regardless of quantities/units.
 */
function computeNormalizedKey(rawLine: string): string {
    const parsed = parseIngredientLine(rawLine.trim());
    const baseName = parsed?.name?.trim() || rawLine.trim();
    const normalized = normalizeIngredientName(baseName).cleaned || baseName;
    // Lowercase for consistent matching
    return normalized.toLowerCase().trim();
}

/**
 * Get AI normalize result from cache or return null
 * Uses normalized key (not raw line) for lookup
 */
export async function getAiNormalizeCache(rawLine: string) {
    try {
        const normalizedKey = computeNormalizedKey(rawLine);
        const cached = await prisma.aiNormalizeCache.findUnique({
            where: { normalizedKey },
        });

        if (!cached) {
            return null;
        }

        // Update usage stats
        await prisma.aiNormalizeCache.update({
            where: { normalizedKey },
            data: {
                useCount: { increment: 1 },
                lastUsedAt: new Date(),
            },
        });

        return {
            normalizedName: cached.normalizedName,
            canonicalBase: cached.canonicalBase ?? cached.normalizedName,  // Fallback for backward compatibility
            synonyms: cached.synonyms as string[],
            prepPhrases: cached.prepPhrases as string[],
            sizePhrases: cached.sizePhrases as string[],
            cookingModifier: cached.cookingModifier ?? undefined,
            isBranded: cached.isBranded ?? false,
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
 * Uses normalized key (not raw line) as the primary key
 */
export async function saveAiNormalizeCache(
    rawLine: string,
    result: {
        normalizedName: string;
        canonicalBase?: string;  // Base ingredient for cache key
        synonyms: string[];
        prepPhrases: string[];
        sizePhrases: string[];
        cookingModifier?: string;
        isBranded?: boolean;  // Whether AI identified this as a branded product query
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
        const normalizedKey = computeNormalizedKey(rawLine);
        await prisma.aiNormalizeCache.upsert({
            where: { normalizedKey },
            create: {
                normalizedKey,
                rawLine,  // Keep for reference/debugging
                normalizedName: result.normalizedName,
                canonicalBase: result.canonicalBase,
                synonyms: result.synonyms,
                prepPhrases: result.prepPhrases,
                sizePhrases: result.sizePhrases,
                cookingModifier: result.cookingModifier,
                isBranded: result.isBranded ?? false,
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

        logger.debug('ai_normalize_cache.saved', { normalizedKey, rawLine });
    } catch (error) {
        logger.error('ai_normalize_cache.save_error', {
            error: (error as Error).message,
            rawLine,
        });
    }
}

