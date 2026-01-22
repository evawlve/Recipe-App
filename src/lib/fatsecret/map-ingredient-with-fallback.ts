/**
 * Unified Ingredient Mapping Pipeline
 * 
 * New architecture that:
 * 1. Gathers candidates from Cache + FatSecret API + FDC in parallel
 * 2. Applies unified must-have token filtering
 * 3. Uses simple token-based reranking to select the best candidate
 * 4. Handles serving selection and backfill
 */

import { parseIngredientLine, type ParsedIngredient } from '../parse/ingredient-line';
import { normalizeIngredientName } from './normalization-rules';
import { gatherCandidates, confidenceGate, type UnifiedCandidate, type GatherOptions } from './gather-candidates';
import {
    filterCandidatesByTokens,
    hasCriticalModifierMismatch,
    isCategoryMismatch,
    isMultiIngredientMismatch,
    isReplacementMismatch,
    validateAliasMapping,
} from './filter-candidates';
import { simpleRerank, toRerankCandidate, extractLeanPercentage, isGenericGroundMeatQuery } from './simple-rerank';
import { getValidatedMapping, getValidatedMappingByNormalizedName, saveValidatedMapping } from './validated-mapping-helpers';
import { logMappingAnalysis } from './mapping-logger';
import { logger } from '../logger';
import { FatSecretClient, type FatSecretFoodDetails, type FatSecretServing } from './client';

// Create a default client instance
const defaultClient = new FatSecretClient();
import { getCachedFoodWithRelations, cacheFoodToDetails } from './cache-search';
import { ensureFoodCached } from './cache';
import { insertAiServing, backfillWeightServing } from './ai-backfill';
import { aiNormalizeIngredient } from './ai-normalize';
import { aiParseIngredient } from './ai-parse';
import { hydrateSingleCandidate } from './hydrate-cache';
import { queueForDeferredHydration, proactiveProduceBackfill } from './deferred-hydration';
import { findCanonicalName, getKnownSynonyms, saveSynonyms } from './ai-synonym-generator';
import { backfillOnDemand } from './serving-backfill';
import { classifyUnit } from './unit-type';
import { isAmbiguousUnit, getOrCreateAmbiguousServing } from './ambiguous-unit-backfill';
import { shouldNormalizeLlm } from './normalize-gate';
import { extractModifierConstraints } from './modifier-constraints';
import { incrementSkippedByGate, incrementCacheHit } from '../ai/structured-client';

// ============================================================
// In-Flight Lock (Prevents race conditions in parallel processing)
// ============================================================
// When multiple threads try to map the same ingredient simultaneously,
// only the first one runs the full pipeline. Others wait for its result.
const inFlightLocks = new Map<string, Promise<FatsecretMappedIngredient | null>>();

function getLockKey(name: string): string {
    return name.toLowerCase().trim();
}

/**
 * Annotate ground meat food name with lean percentage when query didn't specify one.
 * This ensures users can see what lean % they're getting when they just typed "ground beef".
 * 
 * Example: Query "ground beef" → Winner "Organic 85% Lean Ground Beef"
 *          Returns: "Ground Beef (85% Lean)" for clearer display
 * 
 * @param foodName - The original food name from the API
 * @param query - The search query (normalized ingredient name)
 * @returns The food name, potentially with lean % annotation
 */
function annotateGroundMeatName(foodName: string, query: string): string {
    // Only annotate if this was a generic ground meat query (no lean % specified)
    if (!isGenericGroundMeatQuery(query)) {
        return foodName;  // User specified lean %, no annotation needed
    }

    // Extract lean % from the food name
    const leanPercent = extractLeanPercentage(foodName);
    if (!leanPercent) {
        return foodName;  // Food name doesn't have lean %, nothing to annotate
    }

    // Check if the lean % is already clearly visible in a short name
    // e.g., "Ground Beef (85% Lean)" doesn't need annotation
    const hasExplicitLean = foodName.toLowerCase().includes('% lean');
    if (hasExplicitLean && foodName.length < 40) {
        return foodName;  // Already clear
    }

    // For long branded names, simplify to generic + lean %
    // e.g., "Organic 85% Lean Ground Beef (Organic Prairie)" → "Ground Beef (85% Lean)"
    const genericName = query.charAt(0).toUpperCase() + query.slice(1);  // Capitalize first letter
    return `${genericName} (${leanPercent})`;
}

// ============================================================
// Types
// ============================================================

export type FatsecretMappedIngredient = {
    source: 'fatsecret' | 'fdc' | 'cache';
    foodId: string;
    foodName: string;
    brandName?: string | null;
    servingId?: string | null;
    servingDescription?: string | null;
    grams: number;
    kcal: number;
    protein: number;
    carbs: number;
    fat: number;
    confidence: number;
    quality: 'high' | 'medium' | 'low';
    rawLine: string;
    aiValidation?: {
        approved: boolean;
        confidence: number;
        reason: string;
        category?: string;
        detectedIssues?: string[];
    };
};

/**
 * Returned when skipOnLock is true and the ingredient is currently locked.
 * The caller should retry this ingredient after other ingredients are processed.
 */
export type MapIngredientPendingResult = {
    status: 'pending';
    lockKey: string;
    rawLine: string;
};

export interface MapIngredientOptions {
    client?: FatSecretClient;
    minConfidence?: number;
    allowLiveFallback?: boolean;
    debug?: boolean;
    skipAiValidation?: boolean;
    skipCache?: boolean;
    skipFdc?: boolean;
    /** Internal flag - skip in-flight lock for recursive fallback calls */
    _skipInFlightLock?: boolean;
    /** Internal flag - skip fallback to prevent infinite recursion */
    _skipFallback?: boolean;
    /** If true, return 'pending' immediately when lock is held instead of blocking */
    skipOnLock?: boolean;
}

const ENABLE_MAPPING_ANALYSIS = process.env.ENABLE_MAPPING_ANALYSIS === 'true';

// ============================================================
// Main Entry Point
// ============================================================

export async function mapIngredientWithFallback(
    rawLine: string,
    options: MapIngredientOptions = {}
): Promise<FatsecretMappedIngredient | MapIngredientPendingResult | null> {
    const {
        client = defaultClient,
        minConfidence = 0,
        debug = false,
        skipCache = false,
        skipFdc = false,
        allowLiveFallback = true,
        _skipInFlightLock = false,
        _skipFallback = false,
        skipOnLock = false,
    } = options;

    const trimmed = rawLine.trim();
    if (!trimmed) return null;

    // Step 0a: Check if this is a known synonym, use canonical name if so
    const canonicalName = await findCanonicalName(trimmed);
    const effectiveQuery = canonicalName || trimmed;

    if (canonicalName) {
        logger.debug('mapping.synonym_found', { rawLine: trimmed, canonicalName });
    }

    // Step 0b: Check validated cache for instant return
    const cached = await getValidatedMapping(effectiveQuery);
    if (cached) {
        logger.info('mapping.validated_cache_hit', { rawLine: trimmed, effectiveQuery });

        // Step 0b-1: Validate cached mapping against current filters
        // Cached mappings from before filter improvements may have bad mappings
        const parsedCheck = parseIngredientLine(trimmed);
        const normalizedCheck = normalizeIngredientName(parsedCheck?.name || trimmed).cleaned || trimmed;

        if (isCategoryMismatch(normalizedCheck, cached.foodName, cached.brandName) ||
            isMultiIngredientMismatch(normalizedCheck, cached.foodName) ||
            hasCriticalModifierMismatch(trimmed, cached.foodName, 'cache') ||
            isReplacementMismatch(trimmed, cached.foodName, cached.brandName)) {
            logger.warn('mapping.cache_filter_mismatch', {
                rawLine: trimmed,
                cachedFood: cached.foodName,
                normalized: normalizedCheck,
            });
            // Fall through to normal search - don't use stale cached mapping
        } else {
            // ValidatedMapping only stores food info, not serving details
            // If the cached result already has serving info (servingId), return directly
            if (cached.servingId) {
                return cached;
            }

            // Otherwise, we need to hydrate serving info for this food
            // Parse the input to get quantity/unit for serving selection
            const parsedForServing = parseIngredientLine(trimmed);

            // Create a synthetic candidate from the cached result
            // Always use 'cache' source so it goes through the proper serving selection path
            // (FDC foods in cache don't have nutrition in the candidate, so buildFdcResult would fail)
            const cachedCandidate: UnifiedCandidate = {
                id: cached.foodId,
                name: cached.foodName,
                brandName: cached.brandName || undefined,
                source: 'cache',  // Always cache, even for fdc_ IDs
                score: cached.confidence,
                foodType: 'generic',
                rawData: {},
            };

            const hydratedResult = await hydrateAndSelectServing(
                cachedCandidate,
                parsedForServing,
                cached.confidence,
                rawLine,
                client
            );

            if (hydratedResult) {
                // Track cache hit for metrics
                incrementCacheHit();

                // Log the cache hit for summary tracking
                logMappingAnalysis({
                    rawIngredient: trimmed,
                    parsed: {
                        amount: parsedForServing?.qty,
                        unit: parsedForServing?.unit,
                        ingredient: parsedForServing?.name,
                    },
                    topCandidates: [],  // No candidate search was performed
                    selectedCandidate: {
                        foodId: cached.foodId,
                        foodName: cached.foodName,
                        brandName: cached.brandName || '',
                        confidence: cached.confidence,
                        selectionReason: 'early_cache_hit',
                    },
                    selectedNutrition: {
                        calories: hydratedResult.kcal,
                        protein: hydratedResult.protein,
                        carbs: hydratedResult.carbs,
                        fat: hydratedResult.fat,
                        perGrams: hydratedResult.grams,
                    },
                    servingSelection: {
                        servingDescription: hydratedResult.servingDescription || 'N/A',
                        grams: hydratedResult.grams,
                        backfillUsed: false,
                    },
                    finalResult: 'success',
                    source: 'early_cache',
                    aiCalls: undefined,  // No AI calls for cache hits
                });
                return hydratedResult;
            }
            // If hydration fails, fall through to normal search
            logger.warn('mapping.cache_hydration_failed', { rawLine: trimmed, foodId: cached.foodId });
        }
    }

    // Step 1: Parse and normalize
    let parsed = parseIngredientLine(trimmed);
    let baseName = parsed?.name?.trim() || trimmed;

    // Step 1-AI-FALLBACK: If regex parser didn't detect a unit but input looks complex,
    // try AI to extract qty/unit/name. This handles edge cases like "1 5 floz serving red wine"
    // where the parser gets confused by the leading "1" serving count.
    const looksLikeHasUnit = /\d+\s*(floz|fl\s*oz|oz|cup|tbsp|tsp|ml|g|lb|lbs|serving)\b/i.test(trimmed);
    if (!parsed?.unit && looksLikeHasUnit && !_skipFallback) {
        logger.info('mapping.ai_parse_fallback_attempt', { rawLine: trimmed });
        const aiParsed = await aiParseIngredient(trimmed);
        if (aiParsed.status === 'success' && aiParsed.name) {
            // Update parsed with AI results
            parsed = {
                qty: aiParsed.qty ?? 1,
                multiplier: 1,
                unit: aiParsed.unit,
                rawUnit: aiParsed.unit,
                name: aiParsed.name,
                notes: aiParsed.notes ?? null,
                qualifiers: undefined,
                unitHint: null,
            };
            baseName = aiParsed.name;
            logger.info('mapping.ai_parse_fallback_success', {
                rawLine: trimmed,
                qty: parsed.qty,
                unit: parsed.unit,
                name: parsed.name,
            });
        }
    }

    // Step 1-VALIDATION: Reject lines with no actual food name (only qty/unit)
    // e.g., "4 1/2 oz" has no food name - should not map to anything
    const UNIT_ONLY_PATTERN = /^\s*(\d[\d\s\/\.]*\s*)?(oz|ounce|ounces|lb|lbs|pound|pounds|g|gram|grams|kg|ml|cup|cups|tbsp|tsp|quart|gallon)?\s*$/i;
    if (!baseName || UNIT_ONLY_PATTERN.test(baseName.trim())) {
        logger.warn('mapping.no_food_name', { rawLine: trimmed, baseName });
        return null;
    }

    // ============================================================
    // Step 1-WATER: Early exit for ice/water - always zero calories
    // ============================================================
    // These ingredients have no nutritional value and should never map to food
    // Note: "liquid" added to handle ambiguous inputs like "100% liquid" that normalize to just "liquid"
    const ZERO_CALORIE_INGREDIENTS = ['ice', 'ice cubes', 'crushed ice', 'shaved ice', 'water', 'tap water', 'cold water', 'hot water', 'ice water', 'liquid'];
    const baseNameLowerForWaterCheck = baseName.toLowerCase().trim();
    // Also extract the last word to handle "100% liquid" → "liquid"
    const lastWordForWaterCheck = baseNameLowerForWaterCheck.split(/\s+/).pop() || '';
    if (ZERO_CALORIE_INGREDIENTS.some(term =>
        baseNameLowerForWaterCheck === term ||
        baseNameLowerForWaterCheck.endsWith(' ' + term) ||
        lastWordForWaterCheck === term  // <-- NEW: Handles "100% liquid"
    )) {
        logger.info('mapping.zero_calorie_default', { rawLine: trimmed, baseName });

        // Calculate grams from parsed quantity using standard conversions
        const WATER_UNIT_GRAMS: Record<string, number> = {
            'cup': 237, 'cups': 237,
            'ml': 1, 'milliliter': 1, 'milliliters': 1,
            'l': 1000, 'liter': 1000, 'liters': 1000,
            'oz': 29.57, 'ounce': 29.57, 'ounces': 29.57,
            'fl oz': 29.57, 'floz': 29.57, 'fluid ounce': 29.57,
            'tbsp': 14.79, 'tablespoon': 14.79,
            'tsp': 4.93, 'teaspoon': 4.93,
            'g': 1, 'gram': 1, 'grams': 1,
        };
        const unitLower = parsed?.unit?.toLowerCase() || 'cup';
        const gramsPerUnit = WATER_UNIT_GRAMS[unitLower] || 237;  // Default to 1 cup
        const qty = parsed ? parsed.qty * parsed.multiplier : 1;
        const totalGrams = gramsPerUnit * qty;

        return {
            source: 'cache',
            foodId: 'water_default',
            foodName: 'Water',
            brandName: null,
            servingId: null,
            servingDescription: `${qty} ${parsed?.unit || 'cup'}`,
            grams: totalGrams,
            kcal: 0,
            protein: 0,
            carbs: 0,
            fat: 0,
            confidence: 1.0,
            quality: 'high',
            rawLine,
        };
    }

    // ============================================================
    // IN-FLIGHT LOCK: Prevent parallel processing of identical ingredients
    // ============================================================
    // CRITICAL: Use baseName (before AI normalization) as the lock key.
    // AI normalization is non-deterministic and can return different values
    // for the same input. Using baseName ensures ALL threads for the same
    // parsed ingredient wait for the first one to finish.
    const lockKey = getLockKey(baseName);
    const existingLock = inFlightLocks.get(lockKey);

    // Skip lock check if this is a recursive fallback call (to prevent self-deadlock)
    if (existingLock && !_skipInFlightLock) {
        // If skipOnLock is enabled, return pending immediately instead of blocking
        if (skipOnLock) {
            logger.debug('mapping.skip_on_lock', { baseName, lockKey });
            return { status: 'pending', lockKey, rawLine: trimmed };
        }

        logger.debug('mapping.waiting_for_lock', { baseName, lockKey });
        await existingLock;  // Wait for the other thread to finish

        // After lock released, check cache - the first thread should have saved
        const normalizedForCache = normalizeIngredientName(baseName).cleaned || baseName;
        const cachedAfterLock = await getValidatedMappingByNormalizedName(normalizedForCache, 'fatsecret', trimmed);
        if (cachedAfterLock) {
            logger.debug('mapping.cache_hit_after_lock', { baseName, foodName: cachedAfterLock.foodName });
            const cachedCandidate: UnifiedCandidate = {
                id: cachedAfterLock.foodId,
                name: cachedAfterLock.foodName,
                brandName: cachedAfterLock.brandName || undefined,
                source: 'cache',
                score: cachedAfterLock.confidence,
                foodType: 'generic',
                rawData: {},
            };
            const hydratedResult = await hydrateAndSelectServing(
                cachedCandidate, parsed, cachedAfterLock.confidence, rawLine, client
            );
            if (hydratedResult) {
                // Track and log cache hit
                incrementCacheHit();
                if (ENABLE_MAPPING_ANALYSIS) {
                    logMappingAnalysis({
                        rawIngredient: trimmed,
                        parsed: {
                            amount: parsed?.qty,
                            unit: parsed?.unit,
                            ingredient: parsed?.name,
                        },
                        topCandidates: [],
                        selectedCandidate: {
                            foodId: cachedAfterLock.foodId,
                            foodName: cachedAfterLock.foodName,
                            brandName: cachedAfterLock.brandName || '',
                            confidence: cachedAfterLock.confidence,
                            selectionReason: 'cache_hit_after_lock',
                        },
                        selectedNutrition: {
                            calories: hydratedResult.kcal,
                            protein: hydratedResult.protein,
                            carbs: hydratedResult.carbs,
                            fat: hydratedResult.fat,
                            perGrams: hydratedResult.grams,
                        },
                        servingSelection: {
                            servingDescription: hydratedResult.servingDescription || 'N/A',
                            grams: hydratedResult.grams,
                            backfillUsed: false,
                        },
                        finalResult: 'success',
                        source: 'early_cache',
                        aiCalls: undefined,
                    });
                }
                return hydratedResult;
            }
        }
        logger.warn('mapping.lock_released_but_no_cache', { baseName });
    }

    // Register lock - this thread will process this ingredient
    let resolveLock: (result: FatsecretMappedIngredient | null) => void;
    const lockPromise = new Promise<FatsecretMappedIngredient | null>((resolve) => {
        resolveLock = resolve;
    });
    inFlightLocks.set(lockKey, lockPromise);

    try {

        // Step 1a: Expand overly generic single-word ingredients to sensible defaults
        // This prevents failures on terms like "oil", "liquid" that are too vague
        const GENERIC_FALLBACKS: Record<string, string> = {
            'oil': 'vegetable oil',
            'liquid': 'water',
            'fat': 'vegetable oil',
            'shortening': 'vegetable shortening',
            'broth': 'chicken broth',
            'stock': 'chicken stock',
            'vinegar': 'white vinegar',
            'wine': 'white wine',
            'cheese': 'cheddar cheese',
            'flour': 'all purpose flour',
            'sugar': 'granulated sugar',
            'syrup': 'maple syrup',
            'cream': 'heavy cream',
            'extract': 'vanilla extract',
        };

        const baseNameLower = baseName.toLowerCase().trim();
        let usedGenericFallback = false;
        if (GENERIC_FALLBACKS[baseNameLower]) {
            logger.info('mapping.generic_fallback', {
                original: baseName,
                fallback: GENERIC_FALLBACKS[baseNameLower]
            });
            baseName = GENERIC_FALLBACKS[baseNameLower];
            usedGenericFallback = true;
        }

        let normalizedName = normalizeIngredientName(baseName).cleaned || baseName;

        // ============================================================
        // EARLY CACHE CHECK - Skip AI if we've seen this ingredient before
        // ============================================================
        // Check ValidatedMapping for normalized name BEFORE calling AI
        // This is the key optimization: "1 cup chopped onion" → normalized "onion" → cache hit!
        const earlyCacheHit = await getValidatedMapping(normalizedName);
        if (earlyCacheHit) {
            logger.info('mapping.early_cache_hit', { rawLine: trimmed, normalizedName, foodName: earlyCacheHit.foodName });

            // Validate cached mapping against current filters
            // Cached mappings from before filter improvements may have bad mappings
            if (isCategoryMismatch(normalizedName, earlyCacheHit.foodName, earlyCacheHit.brandName) ||
                isMultiIngredientMismatch(normalizedName, earlyCacheHit.foodName) ||
                hasCriticalModifierMismatch(trimmed, earlyCacheHit.foodName, 'cache') ||
                isReplacementMismatch(trimmed, earlyCacheHit.foodName, earlyCacheHit.brandName)) {
                logger.warn('mapping.early_cache_filter_mismatch', {
                    rawLine: trimmed,
                    cachedFood: earlyCacheHit.foodName,
                    normalized: normalizedName,
                });
                // Fall through to normal search - don't use stale cached mapping
            } else {
                // Create synthetic candidate from cached result
                const cachedCandidate: UnifiedCandidate = {
                    id: earlyCacheHit.foodId,
                    name: earlyCacheHit.foodName,
                    brandName: earlyCacheHit.brandName || undefined,
                    source: 'cache',
                    score: earlyCacheHit.confidence,
                    foodType: 'generic',
                    rawData: {},
                };

                // Hydrate with current request's quantity/unit
                const hydratedResult = await hydrateAndSelectServing(
                    cachedCandidate,
                    parsed,
                    earlyCacheHit.confidence,
                    trimmed,
                    client
                );

                if (hydratedResult) {
                    // Track cache hit for metrics
                    incrementCacheHit();

                    // Log the early cache hit
                    if (ENABLE_MAPPING_ANALYSIS) {
                        logMappingAnalysis({
                            rawIngredient: trimmed,
                            parsed: {
                                amount: parsed?.qty,
                                unit: parsed?.unit,
                                ingredient: parsed?.name,
                            },
                            topCandidates: [],
                            selectedCandidate: {
                                foodId: earlyCacheHit.foodId,
                                foodName: earlyCacheHit.foodName,
                                brandName: earlyCacheHit.brandName || '',
                                confidence: earlyCacheHit.confidence,
                                selectionReason: 'early_cache_hit_after_normalize',
                            },
                            selectedNutrition: {
                                calories: hydratedResult.kcal,
                                protein: hydratedResult.protein,
                                carbs: hydratedResult.carbs,
                                fat: hydratedResult.fat,
                                perGrams: hydratedResult.grams,
                            },
                            servingSelection: {
                                servingDescription: hydratedResult.servingDescription || 'N/A',
                                grams: hydratedResult.grams,
                                backfillUsed: false,
                            },
                            finalResult: 'success',
                            source: 'early_cache',
                            aiCalls: undefined,  // No AI calls for cache hits
                        });
                    }
                    return hydratedResult;
                }
                // If hydration fails, continue with normal flow
                logger.warn('mapping.early_cache_hydration_failed', { rawLine: trimmed, foodId: earlyCacheHit.foodId });
            }
        }

        // Step 1b: Check for learned synonyms BEFORE calling AI
        const { getLearnedSynonyms, extractTermsFromIngredient } = await import('./learned-synonyms');
        const ingredientTerms = extractTermsFromIngredient(normalizedName);
        let learnedSynonyms: string[] = [];

        for (const term of ingredientTerms.slice(0, 3)) { // Check top 3 terms
            const synonyms = await getLearnedSynonyms(term);
            if (synonyms.length > 0) {
                learnedSynonyms.push(...synonyms);
            }
        }

        // Try AI normalization for better search terms
        // SKIP if we already applied a generic fallback (to avoid AI changing "vegetable oil" to "cooking oil")
        // ============================================================
        // STEP 5: NORMALIZE GATE - Skip LLM if heuristics are sufficient
        // ============================================================
        let aiSynonyms: string[] = [];
        let aiNutritionEstimate: { caloriesPer100g: number; proteinPer100g: number; carbsPer100g: number; fatPer100g: number; confidence: number } | undefined;
        let aiCanonicalBase: string | undefined;  // For cache key consolidation
        let skippedLlmNormalize = false;

        if (!usedGenericFallback) {
            // First gather candidates to check if LLM is needed
            const quickGatherOptions: GatherOptions = {
                client,
                skipCache,
                skipLiveApi: !allowLiveFallback,
                skipFdc,
                aiSynonyms: learnedSynonyms,  // Use only learned synonyms for quick check
            };

            const quickCandidates = await gatherCandidates(rawLine, parsed, normalizedName, quickGatherOptions);
            const modConstraints = extractModifierConstraints(trimmed);
            const gateDecision = shouldNormalizeLlm(trimmed, quickCandidates, modConstraints);

            if (gateDecision.shouldCallLlm) {
                logger.info('normalize_gate.calling_llm', {
                    rawLine: trimmed,
                    reason: gateDecision.reason,
                    candidateCount: quickCandidates.length
                });

                const aiHint = await aiNormalizeIngredient(rawLine, normalizedName);
                if (aiHint.status === 'success') {
                    if (aiHint.normalizedName) {
                        normalizedName = aiHint.normalizedName;
                    }
                    aiCanonicalBase = aiHint.canonicalBase;
                    aiSynonyms = aiHint.synonyms || [];
                    if (aiSynonyms.length > 0) {
                        logger.info('mapping.ai_synonyms', { rawLine: trimmed, synonyms: aiSynonyms });
                    }
                    aiNutritionEstimate = aiHint.nutritionEstimate;
                }
            } else {
                logger.info('normalize_gate.skipped_llm', {
                    rawLine: trimmed,
                    reason: gateDecision.reason,
                    confidence: gateDecision.confidence.toFixed(2),
                    candidateCount: quickCandidates.length
                });
                skippedLlmNormalize = true;
                incrementSkippedByGate();  // Track for metrics
            }
        }

        // Combine learned + AI synonyms (deduplicated)
        const allSynonyms = [...new Set([...learnedSynonyms, ...aiSynonyms])];
        if (learnedSynonyms.length > 0) {
            logger.info('mapping.learned_synonyms_used', {
                rawLine: trimmed,
                learnedCount: learnedSynonyms.length,
                aiCount: aiSynonyms.length
            });
        }

        // Variables for selection (unified across Cache / Search / Fallback)
        // Variables for selection (unified across Cache / Search / Fallback)
        let winner: UnifiedCandidate | null = null;
        let confidence = 0;
        let selectionReason = '';
        let filtered: UnifiedCandidate[] = [];

        // Step 1c: Check validated cache for normalized name (User Optimization)
        // "1 cup chopped onion" -> normalized "onion" -> checks cache for "onion"
        if (!winner) {
            const normalizedCache = await getValidatedMapping(normalizedName);
            if (normalizedCache) {
                logger.info('mapping.normalized_cache_hit', { rawLine: trimmed, normalizedName });
                if (isCategoryMismatch(normalizedName, normalizedCache.foodName, normalizedCache.brandName) ||
                    isMultiIngredientMismatch(normalizedName, normalizedCache.foodName) ||
                    hasCriticalModifierMismatch(trimmed, normalizedCache.foodName, 'cache') ||
                    isReplacementMismatch(trimmed, normalizedCache.foodName, normalizedCache.brandName)) {
                    logger.warn('mapping.normalized_cache_filter_mismatch', {
                        rawLine: trimmed,
                        cachedFood: normalizedCache.foodName,
                        normalized: normalizedName,
                    });
                } else {
                    winner = {
                        id: normalizedCache.foodId,
                        name: normalizedCache.foodName,
                        brandName: normalizedCache.brandName || undefined,
                        source: 'cache',
                        score: normalizedCache.confidence,
                        foodType: 'generic', // Assumption
                        rawData: {},
                    };
                    confidence = normalizedCache.confidence;
                    selectionReason = 'normalized_cache_hit';
                }
            }
        }

        let allCandidates: UnifiedCandidate[] = [];

        // Step 2: Gather all candidates (If not found in cache)
        if (!winner) {
            const gatherOptions: GatherOptions = {
                client,
                skipCache,
                skipLiveApi: !allowLiveFallback,
                skipFdc,
                aiSynonyms: allSynonyms,
            };

            allCandidates = await gatherCandidates(rawLine, parsed, normalizedName, gatherOptions);

            if (allCandidates.length === 0) {
                logger.warn('mapping.no_candidates', { rawLine: trimmed, normalizedName });
                // Fall through to Fallback Step
            } else {
                // Step 3: Apply must-have token filter
                const filterResult = filterCandidatesByTokens(
                    allCandidates,
                    normalizedName,
                    { debug, rawLine: trimmed }
                );
                filtered = filterResult.filtered;
                const removedCount = filterResult.removedCount;

                if (filtered.length === 0) {
                    logger.warn('mapping.all_filtered', { rawLine: trimmed, removedCount });
                    // Fall through to Fallback
                } else {
                    // Step 3a: Confidence Gate
                    // IMPORTANT: Sort by score with tiebreaker preferring FDC for basic produce
                    const searchQuery = parsed?.name || normalizedName;
                    const BASIC_PRODUCE = ['potato', 'potatoes', 'lentil', 'lentils', 'beans', 'chickpea', 'chickpeas', 'spinach', 'broccoli', 'carrot', 'carrots'];
                    const isBasicProduce = BASIC_PRODUCE.some(p => normalizedName.toLowerCase().includes(p));


                    const sortedFiltered = [...filtered].sort((a, b) => {
                        // Primary: sort by score descending
                        const scoreDiff = b.score - a.score;
                        if (Math.abs(scoreDiff) > 0.001) return scoreDiff;

                        // Tiebreaker for basic produce: prefer FDC (USDA data) over FatSecret
                        // BUT only if FDC candidate name EXACTLY matches the ingredient (not "potato bread")
                        if (isBasicProduce) {
                            const aNameLower = a.name.toLowerCase();
                            const bNameLower = b.name.toLowerCase();
                            const ingredientLower = normalizedName.toLowerCase();

                            // Helper to singularize words (handles -oes → -o, -es → empty, -s → empty)
                            const singularize = (word: string): string => {
                                if (word.endsWith('oes')) return word.slice(0, -2);  // potatoes → potato
                                if (word.endsWith('es')) return word.slice(0, -2);   // tomatoes → tomato (also handles -ches, etc.)
                                if (word.endsWith('s')) return word.slice(0, -1);    // carrots → carrot
                                return word;
                            };
                            // Helper to pluralize words (handles -o → -oes, others → -s)
                            const pluralize = (word: string): string => {
                                if (word.endsWith('o')) return word + 'es';  // potato → potatoes
                                return word + 's';
                            };

                            const ingredientSingular = singularize(ingredientLower);
                            const ingredientPlural = pluralize(ingredientSingular);
                            const aNameSingular = singularize(aNameLower);
                            const bNameSingular = singularize(bNameLower);

                            // Check for EXACT match (considering singular/plural variants)
                            // e.g., "potato" matches "potatoes", "potatoes" matches "potato"
                            const aIsExactMatch = aNameLower === ingredientLower ||
                                aNameLower === ingredientSingular ||
                                aNameLower === ingredientPlural ||
                                aNameSingular === ingredientLower ||
                                aNameSingular === ingredientSingular;
                            const bIsExactMatch = bNameLower === ingredientLower ||
                                bNameLower === ingredientSingular ||
                                bNameLower === ingredientPlural ||
                                bNameSingular === ingredientLower ||
                                bNameSingular === ingredientSingular;

                            // Prefer FDC only when it's an exact name match
                            if (aIsExactMatch && a.source === 'fdc' && (!bIsExactMatch || b.source !== 'fdc')) return -1;
                            if (bIsExactMatch && b.source === 'fdc' && (!aIsExactMatch || a.source !== 'fdc')) return 1;
                        }

                        return 0;
                    });

                    const gateResult = confidenceGate(searchQuery, sortedFiltered);

                    if (gateResult.skipAiRerank && gateResult.selected) {
                        winner = gateResult.selected;
                        confidence = gateResult.confidence;
                        selectionReason = gateResult.reason || 'confidence_gate';
                    } else {
                        // Step 4: Simple rerank (Token-based)
                        // Use filtered (not sortedFiltered) to ensure high-overlap candidates aren't pushed out
                        // simpleRerank will do its own scoring based on token overlap + other factors
                        const rerankCandidates = filtered.slice(0, 10).map(c => toRerankCandidate({
                            id: c.id,
                            name: c.name,
                            brandName: c.brandName,
                            foodType: c.foodType,
                            score: c.score,
                            source: c.source,
                            nutrition: c.nutrition,  // Include for Route C macro sanity check
                        }));

                        const rerankResult = simpleRerank(searchQuery, rerankCandidates, aiNutritionEstimate, trimmed);

                        if (rerankResult) {
                            const selected = filtered.find(c => c.id === rerankResult.winner.id);
                            if (selected) {
                                winner = selected;
                                confidence = rerankResult.confidence;
                                selectionReason = rerankResult.reason;
                            }
                        }

                        if (!winner && filtered.length > 0) {
                            // Fallback to top scorer ONLY if above minimum threshold
                            const MIN_FALLBACK_CONFIDENCE = 0.80;
                            if (filtered[0].score >= MIN_FALLBACK_CONFIDENCE) {
                                winner = filtered[0];
                                confidence = winner.score;
                                selectionReason = 'scored_by_confidence';
                            } else {
                                // Below threshold - let fallback step handle it
                                logger.info('mapping.fallback_rejected', {
                                    rawLine: trimmed,
                                    topCandidate: filtered[0].name,
                                    score: filtered[0].score,
                                    threshold: MIN_FALLBACK_CONFIDENCE,
                                });
                            }
                        }
                    }
                }
            }
        }

        // ===== PROACTIVE SIZE ESTIMATION FOR FDC PRODUCE =====
        // If we selected FDC for produce with a size qualifier (small/medium/large),
        // proactively fetch AI size estimates so they're cached for serving selection
        if (winner && winner.source === 'fdc' && parsed?.unit) {
            const SIZE_QUALIFIERS = ['small', 'medium', 'large', 'extra large', 'extra-large'];
            const unitLower = parsed.unit.toLowerCase();
            if (SIZE_QUALIFIERS.some(sq => unitLower.includes(sq))) {
                const { requestSizeEstimates } = await import('../ai/serving-estimator');
                const { prisma } = await import('../db');

                // Check if we already have size servings cached (use FDC table, not FatSecret!)
                const fdcIdNumber = parseInt(winner.id, 10);
                if (!isNaN(fdcIdNumber)) {
                    const existingSizes = await prisma.fdcServingCache.findFirst({
                        where: {
                            fdcId: fdcIdNumber,
                            description: { contains: 'medium', mode: 'insensitive' },
                            isAiEstimated: true,
                        },
                    });

                    if (!existingSizes) {
                        logger.info('proactive_size_estimation.starting', {
                            food: winner.name,
                            unit: parsed.unit,
                        });

                        const sizeResult = await requestSizeEstimates(winner.name, 'fdc');

                        if (sizeResult.status === 'success') {
                            // Cache the size estimates in FdcServingCache
                            const sizes = sizeResult.sizes;
                            const sizeServings = [
                                { desc: 'small', grams: sizes.small },
                                { desc: 'medium', grams: sizes.medium },
                                { desc: 'large', grams: sizes.large },
                            ];

                            // Create size servings in FdcServingCache (skip if already exists)
                            for (const { desc, grams } of sizeServings) {
                                const existingServing = await prisma.fdcServingCache.findFirst({
                                    where: {
                                        fdcId: fdcIdNumber,
                                        description: desc,
                                    },
                                });

                                if (!existingServing) {
                                    // First ensure the FDC food exists in FdcFoodCache
                                    const fdcFoodExists = await prisma.fdcFoodCache.findUnique({
                                        where: { id: fdcIdNumber },
                                    });

                                    if (fdcFoodExists) {
                                        await prisma.fdcServingCache.create({
                                            data: {
                                                fdcId: fdcIdNumber,
                                                description: desc,
                                                grams: grams,
                                                source: 'ai',
                                                isAiEstimated: true,
                                            },
                                        });
                                    } else {
                                        logger.warn('proactive_size_estimation.fdc_food_not_cached', {
                                            fdcId: fdcIdNumber,
                                            food: winner.name,
                                        });
                                    }
                                }
                            }

                            logger.info('proactive_size_estimation.complete', {
                                food: winner.name,
                                small: sizes.small,
                                medium: sizes.medium,
                                large: sizes.large,
                            });
                        } else {
                            logger.warn('proactive_size_estimation.failed', {
                                food: winner.name,
                                reason: sizeResult.reason,
                            });
                        }
                    }
                }
            }
        }

        // Step 2b: Semantic Fallback (If still no winner)
        // Handle complex lines like "buttermilk pancake mix light" -> "Pancake Mix"
        // Skip if this is already a recursive fallback call to prevent infinite loops
        if (!winner && !_skipFallback) {
            logger.info('mapping.attempting_fallback', { rawLine: trimmed });

            // LLM-based simplification for complex ingredient names
            const { aiSimplifyIngredient } = await import('./ai-simplify');

            try {
                const result = await aiSimplifyIngredient(trimmed);

                if (result && result.simplified && result.simplified !== normalizedName) {
                    logger.info('mapping.fallback_simplification', { original: trimmed, simplified: result.simplified });

                    // Recursively try to map the simplifed name
                    // We use a lower minConfidence to accept matches
                    // IMPORTANT: Pass _skipInFlightLock to prevent deadlock if simplified name
                    // normalizes to the same lock key as the original
                    const fallbackResult = await mapIngredientWithFallback(result.simplified, {
                        ...options,
                        minConfidence: 0.1, // Accept imperfect matches for fallback
                        _skipInFlightLock: true, // Prevent recursive deadlock
                        _skipFallback: true, // Prevent infinite fallback recursion
                    });

                    if (fallbackResult) {
                        // Fallback found a food, but its serving data was computed without our original qty/unit
                        // Re-hydrate using the ORIGINAL parsed input for correct serving selection
                        const fallbackCandidate: UnifiedCandidate = {
                            id: fallbackResult.foodId,
                            name: fallbackResult.foodName,
                            brandName: fallbackResult.brandName || undefined,
                            source: 'cache',  // Use cache path for proper serving selection
                            score: fallbackResult.confidence * 0.85,
                            foodType: 'generic',
                            rawData: {},
                        };

                        // Re-hydrate with ORIGINAL parsed input to get correct serving for "0.25 cup"
                        const rehydratedResult = await hydrateAndSelectServing(
                            fallbackCandidate,
                            parsed,  // Use original parsed input with qty/unit!
                            fallbackCandidate.score,
                            rawLine,
                            client
                        );

                        if (rehydratedResult) {
                            // Successfully re-hydrated with correct serving
                            logger.info('mapping.fallback_success', {
                                original: trimmed,
                                mappedTo: fallbackResult.foodName,
                                serving: rehydratedResult.servingDescription,
                                grams: rehydratedResult.grams,
                            });
                            return rehydratedResult;
                        }

                        // If re-hydration failed, still create winner for fallback processing
                        winner = fallbackCandidate;
                        confidence = winner.score;
                        selectionReason = `fallback_simplified: ${result.rationale}`;

                        logger.info('mapping.fallback_partial', {
                            original: trimmed,
                            mappedTo: fallbackResult.foodName,
                            note: 'rehydration_failed_continuing'
                        });
                    }
                }
            } catch (err) {
                logger.error('mapping.fallback_error', { error: (err as Error).message });
            }
        }

        if (!winner) {
            if (ENABLE_MAPPING_ANALYSIS) {
                logMappingAnalysis({
                    rawIngredient: trimmed,
                    parsed: {
                        amount: parsed?.qty,
                        unit: parsed?.unit,
                        ingredient: parsed?.name,
                    },
                    topCandidates: [],
                    selectedCandidate: {
                        foodId: '',
                        foodName: '',
                        brandName: '',
                        confidence: 0,
                        selectionReason: 'no_candidates_after_fallback',
                    },
                    finalResult: 'failed',
                    failureReason: 'no_candidates_found',
                });
            }
            return null; // Return null if truly failed
        }

        // Step 4a: Hydrate ONLY the selected candidate immediately
        // Queue remaining candidates for deferred hydration after all mappings complete
        hydrateSingleCandidate(winner, client).catch(err => {
            logger.debug('mapping.winner_hydration_failed', { error: (err as Error).message });
        });
        queueForDeferredHydration(allCandidates, winner.id, parsed?.unit ? {
            unit: parsed.unit,
            unitType: classifyUnit(parsed.unit),
        } : undefined);

        // Step 4b: Reject if confidence is too low (avoid garbage matches)
        const MIN_ACCEPTABLE_CONFIDENCE = 0.3;
        if (confidence < MIN_ACCEPTABLE_CONFIDENCE) {
            if (ENABLE_MAPPING_ANALYSIS) {
                logMappingAnalysis({
                    rawIngredient: trimmed,
                    parsed: {
                        amount: parsed?.qty,
                        unit: parsed?.unit,
                        ingredient: parsed?.name,
                    },
                    topCandidates: filtered.slice(0, 5).map((c, i) => ({
                        rank: i + 1,
                        foodId: c.id,
                        foodName: c.name,
                        brandName: c.brandName || null,
                        score: c.score,
                        source: c.source,
                    })),
                    selectedCandidate: {
                        foodId: winner.id,
                        foodName: winner.name,
                        brandName: winner.brandName || '',
                        confidence,
                        selectionReason,
                    },
                    finalResult: 'failed',
                    failureReason: `confidence_too_low (${confidence.toFixed(3)} < ${MIN_ACCEPTABLE_CONFIDENCE})`,
                });
            }
            return null;
        }

        // Step 5: Hydrate and select serving with fallback to next candidates
        let result = await hydrateAndSelectServing(winner, parsed, confidence, rawLine, client);

        // Step 5a: If hydration failed and user requested a weight unit (oz, g, lb),
        // try AI backfill for weight serving on the winner BEFORE falling back to other candidates.
        // This prevents falling back to lower-ranked candidates just because they have gram servings.
        const isWeightUnit = parsed?.unit && /^(g|gram|grams|oz|ounce|ounces|lb|lbs|pound|pounds|kg|kilogram|kilograms)$/i.test(parsed.unit);

        if (!result && isWeightUnit && winner.source === 'fatsecret') {
            logger.info('mapping.weight_backfill_attempt', {
                foodId: winner.id,
                foodName: winner.name,
                unit: parsed.unit,
            });

            const backfillResult = await backfillWeightServing(winner.id);

            if (backfillResult.success) {
                // Retry hydration now that we have a weight serving
                result = await hydrateAndSelectServing(winner, parsed, confidence, rawLine, client);

                if (result) {
                    logger.info('mapping.weight_backfill_success', {
                        foodId: winner.id,
                        foodName: winner.name,
                        unit: parsed.unit,
                        grams: result.grams,
                    });
                    selectionReason = 'weight_backfill_success';
                }
            } else {
                logger.warn('mapping.weight_backfill_failed', {
                    foodId: winner.id,
                    reason: backfillResult.reason,
                });
            }
        }

        // If first choice fails (e.g., branded item without serving weights), try next candidates
        // Note: filtered may be empty if winner came from cache hit - skip fallback in that case
        if (!result && filtered.length > 0) {
            logger.info('mapping.hydration_failed_retrying', {
                failedId: winner.id,
                failedName: winner.name,
                remainingCandidates: filtered.length - 1
            });

            // Try next 3 candidates as fallbacks
            const fallbackCandidates = filtered
                .filter(c => c.id !== winner.id)
                .slice(0, 3);

            for (const fallback of fallbackCandidates) {
                const fallbackResult = await hydrateAndSelectServing(
                    fallback, parsed, confidence * 0.95, rawLine, client
                );
                if (fallbackResult) {
                    logger.info('mapping.fallback_success', {
                        originalId: winner.id,
                        fallbackId: fallback.id,
                        fallbackName: fallback.name,
                    });
                    result = fallbackResult;
                    selectionReason = 'fallback_after_serving_failure';
                    break;
                }
            }
        }

        // Step 5b: If winner came from cache and serving selection failed, try full search
        // This handles cases where cached food has missing serving data
        if (!result && filtered.length === 0 && selectionReason === 'normalized_cache_hit') {
            logger.info('mapping.cache_serving_failed_retrying_search', {
                failedId: winner.id,
                failedName: winner.name,
            });

            // Run full search to find candidates with working servings
            const searchGatherOptions: GatherOptions = {
                client,
                skipCache,
                skipLiveApi: !allowLiveFallback,
                skipFdc,
                aiSynonyms: allSynonyms,
            };

            const searchCandidates = await gatherCandidates(rawLine, parsed, normalizedName, searchGatherOptions);

            if (searchCandidates.length > 0) {
                const searchFilterResult = filterCandidatesByTokens(searchCandidates, normalizedName, { debug, rawLine: trimmed });

                // Sort with FDC tiebreaker for basic produce (same logic as main selection)
                const BASIC_PRODUCE = ['potato', 'potatoes', 'lentil', 'lentils', 'beans', 'chickpea', 'chickpeas', 'spinach', 'broccoli', 'carrot', 'carrots'];
                const isBasicProduce = BASIC_PRODUCE.some(p => normalizedName.toLowerCase().includes(p));

                const sortedFallbackCandidates = [...searchFilterResult.filtered].sort((a, b) => {
                    const scoreDiff = b.score - a.score;
                    if (Math.abs(scoreDiff) > 0.001) return scoreDiff;

                    if (isBasicProduce) {
                        const aNameLower = a.name.toLowerCase();
                        const bNameLower = b.name.toLowerCase();
                        const ingredientLower = normalizedName.toLowerCase();
                        const ingredientSingular = ingredientLower.replace(/s$/, '');

                        // Check for EXACT match only (potatoes = potatoes, or potato = potato)
                        const aIsExactMatch = aNameLower === ingredientLower || aNameLower === ingredientSingular;
                        const bIsExactMatch = bNameLower === ingredientLower || bNameLower === ingredientSingular;

                        if (aIsExactMatch && a.source === 'fdc' && (!bIsExactMatch || b.source !== 'fdc')) return -1;
                        if (bIsExactMatch && b.source === 'fdc' && (!aIsExactMatch || a.source !== 'fdc')) return 1;
                    }
                    return 0;
                });

                // Try each candidate until one works
                for (const candidate of sortedFallbackCandidates.slice(0, 5)) {
                    const retryResult = await hydrateAndSelectServing(candidate, parsed, confidence * 0.9, rawLine, client);
                    if (retryResult) {
                        logger.info('mapping.cache_fallback_search_success', {
                            originalId: winner.id,
                            fallbackId: candidate.id,
                            fallbackName: candidate.name,
                        });
                        result = retryResult;
                        selectionReason = 'fallback_search_after_cache_failure';
                        break;
                    }
                }
            }
        }

        if (!result) {
            if (ENABLE_MAPPING_ANALYSIS) {
                logMappingAnalysis({
                    rawIngredient: trimmed,
                    parsed: {
                        amount: parsed?.qty,
                        unit: parsed?.unit,
                        ingredient: parsed?.name,
                    },
                    topCandidates: filtered.slice(0, 5).map((c, i) => ({
                        rank: i + 1,
                        foodId: c.id,
                        foodName: c.name,
                        brandName: c.brandName || null,
                        score: c.score,
                        source: c.source,
                    })),
                    selectedCandidate: {
                        foodId: winner.id,
                        foodName: winner.name,
                        brandName: winner.brandName || '',
                        confidence,
                        selectionReason,
                    },
                    finalResult: 'failed',
                    failureReason: 'no_suitable_serving_found',
                });
            }

            return null;
        }

        // Step 6: Save to validated cache if high confidence
        if (confidence >= 0.85) {
            await saveValidatedMapping(rawLine, result, {
                approved: true,
                confidence,
                reason: selectionReason,
            }, {
                canonicalBase: aiCanonicalBase,  // Use AI-derived base for cache consolidation
            });

            // Also save AI synonyms as aliases to enable future cache hits
            // e.g., if "fresh raspberries" maps to Raspberries, also save "raspberries" as alias
            // NEW: Validate each alias before saving to prevent cascade poisoning
            for (const synonym of allSynonyms) {
                const synLower = synonym.toLowerCase().trim();
                const rawLower = trimmed.toLowerCase().trim();

                // Skip if same as original or too short
                if (synLower === rawLower || synLower.length < 3) continue;

                // Validate alias before saving - prevent cascade poisoning
                const aliasNutrients = result.grams > 0 ? {
                    kcal: (result.kcal / result.grams) * 100,
                    protein: (result.protein / result.grams) * 100,
                    carbs: (result.carbs / result.grams) * 100,
                    fat: (result.fat / result.grams) * 100,
                } : undefined;

                const validation = validateAliasMapping(synonym, result.foodName, aliasNutrients);
                if (!validation.valid) {
                    logger.warn('mapping.alias_validation_failed', {
                        synonym,
                        foodName: result.foodName,
                        reason: validation.reason,
                    });
                    continue; // Skip this invalid alias
                }

                // Save validated synonym as alias pointing to the same food
                await saveValidatedMapping(synonym, result, {
                    approved: true,
                    confidence: confidence * 0.9,  // Slightly lower confidence for aliases
                    reason: 'alias_from_ai_normalize',
                }, {
                    isAlias: true,
                    canonicalRawIngredient: trimmed,
                    canonicalBase: aiCanonicalBase,  // Use AI-derived base for cache consolidation
                }).catch(() => { }); // Best effort, ignore duplicates
            }
        }

        // Log success
        if (ENABLE_MAPPING_ANALYSIS) {
            logMappingAnalysis({
                rawIngredient: trimmed,
                parsed: {
                    amount: parsed?.qty,
                    unit: parsed?.unit,
                    ingredient: parsed?.name,
                },
                topCandidates: filtered.slice(0, 5).map((c, i) => ({
                    rank: i + 1,
                    foodId: c.id,
                    foodName: c.name,
                    brandName: c.brandName || null,
                    score: c.score,
                    source: c.source,
                    // Include nutrition if available (from FDC candidates)
                    nutrition: c.nutrition ? {
                        calories: c.nutrition.kcal,
                        protein: c.nutrition.protein,
                        fat: c.nutrition.fat,
                        carbs: c.nutrition.carbs,
                    } : undefined,
                })),
                selectedCandidate: {
                    foodId: result.foodId,
                    foodName: result.foodName,
                    brandName: result.brandName || '',
                    confidence,
                    selectionReason,
                },
                // Add nutrition for easy false positive detection
                selectedNutrition: {
                    calories: result.kcal,
                    protein: result.protein,
                    carbs: result.carbs,
                    fat: result.fat,
                    perGrams: result.grams,
                },
                servingSelection: {
                    servingDescription: result.servingDescription || 'N/A',
                    grams: result.grams,
                    backfillUsed: false,
                },
                finalResult: 'success',
                source: selectionReason === 'normalized_cache_hit' ? 'normalized_cache' : 'full_pipeline',
                // Track AI calls made during this mapping
                aiCalls: {
                    normalize: {
                        called: !skippedLlmNormalize && !usedGenericFallback,
                        skipped: skippedLlmNormalize,
                        reason: skippedLlmNormalize ? 'gate_skipped' : undefined,
                    },
                },
            });
        }

        // Phase 3: Save known British/American synonyms (non-blocking, no AI call)
        // We use the known synonym mappings instead of calling AI again
        const knownSyns = getKnownSynonyms(result.foodName);
        if (knownSyns && knownSyns.length > 0) {
            saveSynonyms(result.foodName, knownSyns, 'known').catch(err => {
                logger.debug('mapping.synonym_save_failed', { error: (err as Error).message });
            });
        }

        // Phase 4: Proactive produce backfill (fire-and-forget)
        // For produce items, pre-populate small/medium/large servings so future
        // size-based queries (e.g., "1 large avocado") hit cached servings
        proactiveProduceBackfill(result.foodId, result.foodName);

        return result;
    } finally {
        // Release the in-flight lock and resolve waiting threads
        inFlightLocks.delete(lockKey);
        resolveLock!(null);  // Resolve with null - waiting threads will re-fetch from cache
    }
}

// ============================================================
// Hydration & Serving Selection
// ============================================================

async function hydrateAndSelectServing(
    candidate: UnifiedCandidate,
    parsed: ParsedIngredient | null,
    confidence: number,
    rawLine: string,
    client: FatSecretClient
): Promise<FatsecretMappedIngredient | null> {
    // Handle FDC candidates (already have nutrition data)
    // Also check for fdc_ prefix in ID - cached ValidatedMappings may have source='cache' but FDC IDs
    const isFdcFood = candidate.source === 'fdc' || candidate.id.startsWith('fdc_');
    if (isFdcFood) {
        return await buildFdcResult(candidate, parsed, confidence, rawLine);
    }

    // For cache/fatsecret candidates, get full details with servings
    let details: FatSecretFoodDetails | null = null;

    // Try cache first
    const cached = await getCachedFoodWithRelations(candidate.id);
    if (cached) {
        details = cacheFoodToDetails(cached);

        // Check if cache has incomplete data (no nutrition)
        const hasNutrition = details.nutrientsPer100g && (
            details.nutrientsPer100g.calories !== null ||
            details.nutrientsPer100g.protein !== null
        );

        if (!hasNutrition) {
            logger.info('hydrate.cache_incomplete', { foodId: candidate.id, name: cached.name });
            // Cache has food but no nutrition - try fresh API call
            const freshDetails = await client.getFoodDetails(candidate.id);
            if (freshDetails && freshDetails.servings?.some(s => s.calories != null)) {
                details = freshDetails;
                // Also update the cache with fresh data
                await ensureFoodCached(candidate.id, { client });
            }
        }
    }

    // Fall back to live API if not in cache at all
    if (!details) {
        await ensureFoodCached(candidate.id, { client });
        const refreshed = await getCachedFoodWithRelations(candidate.id);
        if (refreshed) {
            details = cacheFoodToDetails(refreshed);
        } else {
            details = await client.getFoodDetails(candidate.id);
        }
    }

    // Helper to check if any serving has usable weight
    // Note: Per-serving calories may be null for cached servings - we use food's nutrientsPer100g instead
    const hasUsableServing = (servings: FatSecretServing[] | undefined) =>
        Boolean(
            servings?.some(s => {
                const grams = gramsForServing(s);
                return grams != null && grams > 0;
            })
        );

    if (!details || !details.servings?.length || !hasUsableServing(details.servings)) {
        logger.warn('hydrate.no_usable_servings', { foodId: candidate.id, hasDetails: !!details, servingsCount: details?.servings?.length || 0 });

        // Try AI backfill for weight-based serving
        const backfillResult = await insertAiServing(candidate.id, 'weight');
        if (backfillResult.success) {
            const refreshed = await getCachedFoodWithRelations(candidate.id);
            if (refreshed) {
                details = cacheFoodToDetails(refreshed);
            }
        }

        // If still no usable servings, try volume backfill
        if (!details || !hasUsableServing(details.servings)) {
            const volumeBackfill = await insertAiServing(candidate.id, 'volume');
            if (volumeBackfill.success) {
                const refreshed = await getCachedFoodWithRelations(candidate.id);
                if (refreshed) {
                    details = cacheFoodToDetails(refreshed);
                }
            }
        }

        // Final check
        if (!details?.servings?.length || !hasUsableServing(details.servings)) {
            return null;
        }
    }

    // Select best serving
    let servingResult = selectServing(parsed, details.servings);

    // If selection failed and we have a specific unit, try on-demand backfill
    // BUT skip for ambiguous units (egg, packet, etc.) - those need AI estimation
    if (!servingResult && parsed?.unit && !isAmbiguousUnit(parsed.unit)) {
        const unitType = classifyUnit(parsed.unit);

        // Only attempt backfill for count/volume types (mass is usually handled or canonical)
        if (unitType === 'count' || unitType === 'volume') {
            logger.info('hydrate.attempting_on_demand_backfill', {
                foodId: candidate.id,
                unit: parsed.unit,
                type: unitType
            });

            const backfillRes = await backfillOnDemand(
                candidate.id,
                unitType as 'count' | 'volume',
                parsed.unit
            );

            if (backfillRes.success) {
                // Refresh details from DB to get the new serving
                const freshData = await getCachedFoodWithRelations(candidate.id);
                if (freshData) {
                    details = cacheFoodToDetails(freshData);
                    // Retry selection with new servings
                    servingResult = selectServing(parsed, details.servings);

                    if (servingResult) {
                        logger.info('hydrate.backfill_recovery_success', {
                            foodId: candidate.id,
                            unit: parsed.unit,
                            serving: servingResult.serving.measurementDescription || servingResult.serving.description
                        });
                    }
                }
            } else {
                logger.warn('hydrate.backfill_failed', {
                    foodId: candidate.id,
                    reason: backfillRes.reason
                });
            }
        }
    }

    // If selection failed for UNITLESS ingredient (no unit), try count backfill
    // e.g., "1 cucumber" needs a "medium" serving (~300g), not "slice" (7g)
    // Use 'medium' as target to get proper whole-item weight
    if (!servingResult && parsed && !parsed.unit) {
        logger.info('hydrate.attempting_unitless_backfill', {
            foodId: candidate.id,
            ingredientName: parsed.name,
        });

        // For unitless produce, request a 'medium' or 'whole' serving
        const backfillRes = await backfillOnDemand(
            candidate.id,
            'count',
            'medium'  // Request medium/whole serving for proper gram weight
        );

        if (backfillRes.success) {
            const freshData = await getCachedFoodWithRelations(candidate.id);
            if (freshData) {
                details = cacheFoodToDetails(freshData);
                servingResult = selectServing(parsed, details.servings);

                if (servingResult) {
                    logger.info('hydrate.unitless_backfill_success', {
                        foodId: candidate.id,
                        serving: servingResult.serving.measurementDescription || servingResult.serving.description
                    });
                }
            }
        } else {
            logger.warn('hydrate.unitless_backfill_failed', {
                foodId: candidate.id,
                reason: backfillRes.reason
            });
        }

        // If still no serving result for unitless produce, use AI to estimate "1 medium {food}" weight
        // This handles FDC entries that don't have medium/whole servings
        if (!servingResult && parsed) {
            logger.info('hydrate.attempting_unitless_ai_estimate', {
                foodId: candidate.id,
                foodName: candidate.name,
            });

            const ambiguousResult = await getOrCreateAmbiguousServing(
                candidate.id,
                candidate.name,
                'medium',  // Ask AI: "what does 1 medium {foodName} weigh?"
                candidate.brandName
            );

            if (ambiguousResult.status === 'success' || ambiguousResult.status === 'cached') {
                const estimatedGrams = ambiguousResult.grams!;
                const qty = parsed.qty * parsed.multiplier;
                const totalGrams = estimatedGrams * qty;

                // Find ANY gram-based serving to calculate nutrition
                const gramServing = details.servings.find(s =>
                    s.metricServingUnit === 'g' ||
                    s.measurementDescription?.toLowerCase().includes('gram') ||
                    gramsForServing(s) != null
                );

                if (gramServing) {
                    servingResult = {
                        serving: gramServing,
                        matchScore: 0.85,
                        gramsPerUnit: estimatedGrams,
                        unitsPerServing: 1,
                        baseGrams: totalGrams,
                        matchType: 'fallback' as const,
                        warning: `AI-estimated: 1 medium ${candidate.name} ≈ ${estimatedGrams}g`,
                    };

                    logger.info('hydrate.unitless_ai_estimate_success', {
                        foodId: candidate.id,
                        foodName: candidate.name,
                        estimatedGrams,
                        totalGrams,
                    });
                }
            } else {
                logger.warn('hydrate.unitless_ai_estimate_failed', {
                    foodId: candidate.id,
                    error: ambiguousResult.error,
                });
            }
        }
    }

    // If selection failed and unit is AMBIGUOUS (container, scoop, etc.), try AI estimation
    if (!servingResult && parsed?.unit && isAmbiguousUnit(parsed.unit)) {
        logger.info('hydrate.attempting_ambiguous_unit_backfill', {
            foodId: candidate.id,
            foodName: candidate.name,
            unit: parsed.unit,
        });

        const ambiguousResult = await getOrCreateAmbiguousServing(
            candidate.id,
            candidate.name,
            parsed.unit,
            candidate.brandName
        );

        if (ambiguousResult.status === 'success' || ambiguousResult.status === 'cached') {
            const estimatedGrams = ambiguousResult.grams!;
            const qty = parsed.qty * parsed.multiplier;
            const totalGrams = estimatedGrams * qty;

            // Find ANY gram-based serving to calculate nutrition
            const gramServing = details.servings.find(s =>
                s.metricServingUnit === 'g' ||
                s.measurementDescription?.toLowerCase().includes('gram') ||
                gramsForServing(s) != null
            );

            if (gramServing) {
                servingResult = {
                    serving: gramServing,
                    matchScore: 0.85,
                    gramsPerUnit: estimatedGrams,
                    unitsPerServing: 1,
                    baseGrams: totalGrams,
                    matchType: 'fallback' as const,
                    warning: `AI-estimated: 1 ${parsed.unit} ≈ ${estimatedGrams}g`,
                };

                logger.info('hydrate.ambiguous_unit_success', {
                    foodId: candidate.id,
                    unit: parsed.unit,
                    estimatedGrams,
                    totalGrams,
                });
            }
        } else {
            logger.warn('hydrate.ambiguous_unit_failed', {
                foodId: candidate.id,
                unit: parsed.unit,
                error: ambiguousResult.error,
            });
        }
    }

    if (!servingResult) {
        logger.warn('hydrate.no_serving_match', { foodId: candidate.id });
        return null;
    }

    const { serving, gramsPerUnit, unitsPerServing, baseGrams } = servingResult;
    const unitGrams = gramsPerUnit || baseGrams;
    const qty = parsed ? parsed.qty * parsed.multiplier : 1;

    // Detect gram-based units (g, gram, grams, oz, lb, kg) - these specify weight directly
    const isWeightUnit = parsed?.unit && /^(g|gram|grams|oz|ounce|ounces|lb|lbs|pound|pounds|kg|kilogram)$/i.test(parsed.unit);

    // For weight-based units, qty IS the weight in that unit
    // e.g., "150 g tofu" means exactly 150 grams, not "150 servings"
    let targetGrams: number | null = null;
    let effectiveQty = qty;

    if (isWeightUnit && baseGrams) {
        // Convert qty from weight unit to grams
        const weightToGrams: Record<string, number> = {
            'g': 1, 'gram': 1, 'grams': 1,
            'oz': 28.35, 'ounce': 28.35, 'ounces': 28.35,
            'lb': 453.6, 'lbs': 453.6, 'pound': 453.6, 'pounds': 453.6,
            'kg': 1000, 'kilogram': 1000,
        };
        const conversionFactor = weightToGrams[parsed!.unit!.toLowerCase()] || 1;
        targetGrams = qty * conversionFactor;
        // For weight units, we DON'T multiply by qty again in computeMacros
        // Instead, we set effectiveQty to 1 and let the gram scaling handle it
        effectiveQty = 1;

        logger.debug('hydrate.weight_unit_conversion', {
            unit: parsed?.unit,
            qty,
            conversionFactor,
            targetGrams,
        });
    }

    // Compute macros - first try from serving, then fallback to nutrientsPer100g
    // Pass targetGrams for weight units, baseGrams otherwise
    let macros = computeMacros(serving, effectiveQty, unitsPerServing, targetGrams || unitGrams);

    // If serving doesn't have macros but we have nutrientsPer100g and baseGrams, compute directly
    if (!macros && (targetGrams || baseGrams) && details.nutrientsPer100g) {
        const finalGrams = targetGrams || (baseGrams! * qty);
        const factor = finalGrams / 100;
        const nutrients = details.nutrientsPer100g;
        if (nutrients.calories != null && nutrients.protein != null && nutrients.carbs != null && nutrients.fat != null) {
            macros = {
                kcal: nutrients.calories * factor,
                protein: nutrients.protein * factor,
                carbs: nutrients.carbs * factor,
                fat: nutrients.fat * factor,
            };
            logger.debug('hydrate.computed_from_100g', { foodId: candidate.id, finalGrams, factor });
        }
    }

    if (!macros) {
        logger.warn('hydrate.no_macros', { foodId: candidate.id });
        return null;
    }

    // Calculate final grams for the result
    const finalGrams = targetGrams || ((unitGrams || gramsForServing(serving, candidate.name) || 100) * qty);

    // Determine the correct serving description
    // For ambiguous unit fallbacks, use the parsed unit with gram weight (e.g., "package (227g)")
    // instead of the anchor serving's description (e.g., "cup")
    let finalServingDescription = serving.measurementDescription || serving.description;
    if (servingResult.matchType === 'fallback' && parsed?.unit && servingResult.gramsPerUnit) {
        finalServingDescription = `${parsed.unit} (${Math.round(servingResult.gramsPerUnit)}g)`;
    }

    // Annotate food name for ground meat (so users see lean % when they just typed "ground beef")
    const queryForAnnotation = parsed?.name?.toLowerCase() || rawLine.toLowerCase();
    const annotatedFoodName = annotateGroundMeatName(candidate.name, queryForAnnotation);

    return {
        source: candidate.source === 'cache' ? 'cache' : 'fatsecret',
        foodId: candidate.id,
        foodName: annotatedFoodName,
        brandName: candidate.brandName,
        servingId: serving.id,
        servingDescription: finalServingDescription,
        grams: finalGrams,
        kcal: macros.kcal,
        protein: macros.protein,
        carbs: macros.carbs,
        fat: macros.fat,
        confidence,
        quality: confidence >= 0.8 ? 'high' : confidence >= 0.6 ? 'medium' : 'low',
        rawLine,
    };
}

// ============================================================
// FDC Result Builder
// ============================================================

import { isSizeQualifier, getOrCreateFdcSizeServings } from '../usda/fdc-ai-backfill';

async function buildFdcResult(
    candidate: UnifiedCandidate,
    parsed: ParsedIngredient | null,
    confidence: number,
    rawLine: string
): Promise<FatsecretMappedIngredient | null> {
    if (!candidate.nutrition) return null;

    const qty = parsed ? parsed.qty * parsed.multiplier : 1;
    const unit = parsed?.unit?.toLowerCase();

    // Handle weight units - convert qty in that unit to grams
    const weightToGrams: Record<string, number> = {
        'g': 1, 'gram': 1, 'grams': 1,
        'oz': 28.35, 'ounce': 28.35, 'ounces': 28.35,
        'lb': 453.6, 'lbs': 453.6, 'pound': 453.6, 'pounds': 453.6,
        'kg': 1000, 'kilogram': 1000,
    };

    // Handle volume units - estimate grams based on typical density
    // Note: This is an approximation. Actual density varies by food.
    const volumeToGrams: Record<string, number> = {
        'cup': 120,      // 1 cup ≈ 240ml × 0.5 g/ml ≈ 120g (for granular solids)
        'tbsp': 7.5,     // 1 tbsp ≈ 15ml × 0.5 g/ml ≈ 7.5g
        'tsp': 2.5,      // 1 tsp ≈ 5ml × 0.5 g/ml ≈ 2.5g
        'ml': 1,         // 1 ml ≈ 1g (for water-like liquids)
        'floz': 30,      // 1 fl oz ≈ 30ml
    };

    let grams: number;
    let servingDescription: string;

    if (unit && weightToGrams[unit]) {
        // Unit is a weight unit - convert qty to grams
        // e.g., "16 oz" → 16 * 28.35 = 453.6g
        grams = qty * weightToGrams[unit];
        servingDescription = `${grams.toFixed(1)}g`;
    } else if (unit && volumeToGrams[unit]) {
        // Unit is a volume unit - estimate grams using approximate density
        // e.g., "2 tbsp" → 2 * 7.5g = 15g
        grams = qty * volumeToGrams[unit];
        servingDescription = `${qty} ${unit}`;
    } else if (isSizeQualifier(unit)) {
        // Unit is a size qualifier (small/medium/large)
        // Get AI-estimated weight for this size, caching for future use
        const fdcId = parseInt(candidate.id.replace('fdc_', ''), 10);
        const sizes = await getOrCreateFdcSizeServings(fdcId, candidate.name);

        if (sizes) {
            const gramsPerUnit = sizes[unit];
            grams = qty * gramsPerUnit;
            servingDescription = `${qty} ${unit} (${gramsPerUnit}g each)`;
            logger.info('fdc.size_qualifier_resolved', {
                foodName: candidate.name,
                size: unit,
                gramsPerUnit,
                totalGrams: grams,
            });
        } else {
            // Fallback to 100g if AI estimation fails
            grams = 100 * qty;
            servingDescription = `${grams.toFixed(1)}g (estimated)`;
            logger.warn('fdc.size_qualifier_fallback', {
                foodName: candidate.name,
                size: unit,
                fallbackGrams: grams,
            });
        }
    } else if (!unit) {
        // UNITLESS PRODUCE: "1 cucumber", "2 avocados" - use AI to estimate "medium" weight
        // This ensures proper gram calculation instead of 100g fallback
        const fdcId = parseInt(candidate.id.replace('fdc_', ''), 10);
        const sizes = await getOrCreateFdcSizeServings(fdcId, candidate.name);

        if (sizes && sizes['medium']) {
            const gramsPerUnit = sizes['medium'];
            grams = qty * gramsPerUnit;
            servingDescription = `${qty} medium (${gramsPerUnit}g each)`;
            logger.info('fdc.unitless_medium_resolved', {
                foodName: candidate.name,
                gramsPerUnit,
                totalGrams: grams,
            });
        } else {
            // Fallback to 100g if AI estimation fails
            grams = 100 * qty;
            servingDescription = `${grams.toFixed(1)}g`;
            logger.warn('fdc.unitless_fallback', {
                foodName: candidate.name,
                fallbackGrams: grams,
            });
        }
    } else if (unit && isAmbiguousUnit(unit)) {
        // AMBIGUOUS UNITS (egg, packet, container, etc.) - use AI estimation
        const ambiguousResult = await getOrCreateAmbiguousServing(
            candidate.id,
            candidate.name,
            unit,
            candidate.brandName
        );

        if (ambiguousResult.status === 'success' || ambiguousResult.status === 'cached') {
            const gramsPerUnit = ambiguousResult.grams!;
            grams = qty * gramsPerUnit;
            servingDescription = `${qty} ${unit} (${gramsPerUnit}g each)`;
            logger.info('fdc.ambiguous_unit_resolved', {
                foodName: candidate.name,
                unit,
                gramsPerUnit,
                totalGrams: grams,
            });
        } else {
            // Fallback to 100g if AI estimation fails
            grams = 100 * qty;
            servingDescription = `${grams.toFixed(1)}g (estimated)`;
            logger.warn('fdc.ambiguous_unit_fallback', {
                foodName: candidate.name,
                unit,
                fallbackGrams: grams,
            });
        }
    } else {
        // Unknown units (slices, pieces, etc.) - use 100g default
        grams = 100 * qty;
        servingDescription = `${grams.toFixed(1)}g`;
    }

    const factor = grams / 100;

    // Annotate food name for ground meat (so users see lean % when they just typed "ground beef")
    const queryForAnnotation = parsed?.name?.toLowerCase() || rawLine.toLowerCase();
    const annotatedFoodName = annotateGroundMeatName(candidate.name, queryForAnnotation);

    return {
        source: 'fdc',
        foodId: candidate.id,
        foodName: annotatedFoodName,
        brandName: candidate.brandName,
        servingId: null,
        servingDescription,
        grams,
        kcal: candidate.nutrition.kcal * factor,
        protein: candidate.nutrition.protein * factor,
        carbs: candidate.nutrition.carbs * factor,
        fat: candidate.nutrition.fat * factor,
        confidence,
        quality: confidence >= 0.8 ? 'high' : confidence >= 0.6 ? 'medium' : 'low',
        rawLine,
    };
}


// ============================================================
// Serving Selection (simplified from map-ingredient.ts)
// ============================================================

function selectServing(
    parsed: ParsedIngredient | null,
    servings: FatSecretServing[]
): {
    serving: FatSecretServing;
    matchScore: number;
    gramsPerUnit: number | null;
    unitsPerServing: number;
    baseGrams: number | null;
    matchType?: 'exact' | 'same_type' | 'fallback' | 'no_match';
    warning?: string;
} | null {
    if (!servings.length) return null;

    const qty = parsed ? parsed.qty * parsed.multiplier : 1;
    const unit = parsed?.unit?.toLowerCase() ?? null;

    // AMBIGUOUS UNITS: Skip normal serving selection and force AI backfill
    // Units like "packet", "container", "scoop", "medium" get wildly incorrect grams
    // from API-provided servings (e.g., "1 packet" matching to "serving = 100g").
    // These require AI estimation to get accurate weights.
    if (unit && isAmbiguousUnit(unit)) {
        logger.debug('selectServing.ambiguous_unit_skip', {
            unit,
            ingredientName: parsed?.name,
            reason: 'Forcing AI backfill for ambiguous unit',
        });
        return null; // Trigger AI backfill path
    }

    // Debug: Log available servings to help diagnose unit matching issues
    logger.debug('selectServing.start', {
        requestedQty: qty,
        requestedUnit: unit,
        ingredientName: parsed?.name,
        availableServings: servings.slice(0, 10).map(s => ({
            desc: s.measurementDescription || s.description,
            grams: gramsForServing(s),
        })),
    });

    // Import unit type classification
    const { classifyUnit, isGenericServing } = require('./unit-type');

    // If no unit was parsed but ingredient name starts with a volume unit,
    // extract it (handles cases like "fl oz red wine" where parser missed the unit)
    let effectiveUnit = unit;
    if (!unit && parsed?.name) {
        const nameLower = parsed.name.toLowerCase();
        // Check for volume units at start of ingredient name
        const volumeUnitPrefixes = [
            { pattern: /^fl\.?\s*oz\b/i, unit: 'fl oz' },
            { pattern: /^fluid\s*oz(ounce)?s?\b/i, unit: 'fl oz' },
        ];
        for (const { pattern, unit: extractedUnit } of volumeUnitPrefixes) {
            if (pattern.test(nameLower)) {
                effectiveUnit = extractedUnit;
                logger.debug('selectServing.extracted_unit_from_name', {
                    originalName: parsed.name,
                    extractedUnit,
                });
                break;
            }
        }
    }
    const requestedUnitType = classifyUnit(effectiveUnit);

    // Common unit mappings
    const unitMappings: Record<string, string[]> = {
        'cup': ['cup', 'c', 'cups'],
        'tbsp': ['tbsp', 'tablespoon', 'tablespoons', 'tbs'],
        'tsp': ['tsp', 'teaspoon', 'teaspoons'],
        'oz': ['oz', 'ounce', 'ounces'],
        'g': ['g', 'gram', 'grams'],
        'ml': ['ml', 'milliliter', 'milliliters'],
        'floz': ['floz', 'fl oz', 'fl. oz', 'fluid oz', 'fluid ounce', 'fluid ounces'],
        'slice': ['slice', 'slices', 'sliced'],
        'piece': ['piece', 'pieces', 'pc', 'pcs'],
        'item': ['item', 'items', 'each', 'ea'],
    };

    // Volume unit conversions (all relative to ml)
    const volumeToMl: Record<string, number> = {
        'ml': 1,
        'tsp': 5,
        'tbsp': 15,
        'cup': 240,
        'c': 240,
        'floz': 30,
        'fl oz': 30,  // Common parsed output
        'fl. oz': 30,
    };
    const MIN_VOLUME_DENSITY_G_PER_ML = 0.02;

    // Get all unit aliases
    const getUnitAliases = (u: string | null): string[] => {
        if (!u) return [];
        const lower = u.toLowerCase();
        for (const [key, aliases] of Object.entries(unitMappings)) {
            if (key === lower || aliases.includes(lower)) {
                return [key, ...aliases];
            }
        }
        return [lower];
    };

    // Get canonical volume unit
    const getCanonicalVolumeUnit = (u: string | null): string | null => {
        if (!u) return null;
        const lower = u.toLowerCase();
        for (const [key, aliases] of Object.entries(unitMappings)) {
            if ((key === lower || aliases.includes(lower)) && volumeToMl[key]) {
                return key;
            }
        }
        return volumeToMl[lower] ? lower : null;
    };

    // Extract volume unit from serving description
    const extractServingVolumeUnit = (description: string): { unit: string; amount: number } | null => {
        const desc = description.toLowerCase();
        // Match patterns like "2 tbsp", "1 cup", "100 ml", "4 fl oz"
        const match = desc.match(/(\d+(?:\.\d+)?)\s*(cup|cups|c|tbsp|tablespoon|tablespoons|tbs|tsp|teaspoon|teaspoons|ml|fl\.?\s*oz|floz|fluid\s*ounce?s?)/i);
        if (match) {
            let amount = parseFloat(match[1]);
            let rawUnit = match[2].toLowerCase().replace(/\s+/g, ' ').trim();
            // Normalize fl oz variants to 'floz' for lookup
            if (rawUnit.includes('fl') && rawUnit.includes('oz')) rawUnit = 'floz';
            if (rawUnit.includes('fluid') && rawUnit.includes('ounce')) rawUnit = 'floz';
            const canonical = getCanonicalVolumeUnit(rawUnit);
            if (canonical) {
                return { unit: canonical, amount };
            }
        }
        // Also handle servings that are just the unit without number prefix (e.g., "fl oz")
        // In this case, use numberOfUnits from the serving object
        return null;
    };

    // Check if serving matches count type
    const isCountServing = (desc: string): boolean => {
        const countPatterns = [
            /\b(slice|slices|piece|pieces|item|items|each)\b/i,
            /^1?\s*(tortilla|egg|bagel|patty|strip|wedge)/i,
            /^\d+\s+(tortilla|slice|piece|egg|item)/i,
            // "1 serving" can act as a count unit when no specific count exists
            /^1\s+serving$/i,
        ];
        return countPatterns.some(p => p.test(desc));
    };

    const unitAliases = getUnitAliases(effectiveUnit);
    const requestedVolumeUnit = getCanonicalVolumeUnit(effectiveUnit);
    const minVolumeGrams = requestedVolumeUnit ? volumeToMl[requestedVolumeUnit] * MIN_VOLUME_DENSITY_G_PER_ML : null;

    // Track best matches by type
    let exactMatch: { serving: FatSecretServing; score: number; factor: number } | null = null;
    let sameTypeMatch: { serving: FatSecretServing; score: number; factor: number } | null = null;
    let fallbackMatch: { serving: FatSecretServing; score: number; factor: number } | null = null;

    for (const serving of servings) {
        const description = (serving.measurementDescription || serving.description || '').toLowerCase();
        const grams = gramsForServing(serving);
        const unitsPerServing = serving.numberOfUnits && serving.numberOfUnits > 0 ? serving.numberOfUnits : 1;
        let score = 0;
        let conversionFactor = 1;

        // Must have valid grams
        if (grams == null || grams <= 0) continue;

        // Award base score for having grams
        score += 0.5;

        // Exact unit match with stricter word boundary checking
        if (effectiveUnit && unitAliases.length > 0) {
            // Check for exact match with word boundaries to avoid partial matches
            // e.g., "tbsp" should not match "tsp", "cup" should not match "cucumber"
            const hasExactMatch = unitAliases.some(alias => {
                // Escape special regex characters and create word boundary regex
                const escapedAlias = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                const regex = new RegExp(`\\b${escapedAlias}\\b`, 'i');
                return regex.test(description);
            });

            if (hasExactMatch) {
                if (minVolumeGrams && requestedVolumeUnit) {
                    const perUnitGrams = grams / unitsPerServing;
                    if (perUnitGrams < minVolumeGrams) {
                        continue;
                    }
                }
                score += 3;

                // BONUS: Prefer SIMPLE unit servings (just the unit) over complex descriptions
                // "fl oz" should win over "1 cup (8 fl oz)" for fl oz requests
                const isSimpleUnitServing = unitAliases.some(alias => {
                    const simplePattern = new RegExp(`^\\d*\\s*${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?$`, 'i');
                    return simplePattern.test(description.trim());
                });

                if (isSimpleUnitServing) {
                    score += 2; // Strong bonus for exact unit match like "fl oz" or "1 fl oz"
                }

                // Check if unit is in parentheses (secondary descriptor) - penalize
                const unitInParentheses = unitAliases.some(alias => {
                    const parenPattern = new RegExp(`\\(.*\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b.*\\)`, 'i');
                    return parenPattern.test(description);
                });

                if (unitInParentheses) {
                    score -= 1.5; // Penalize "1 cup (8 fl oz)" for "fl oz" requests
                }

                // BONUS: Prioritize single-unit servings ("1 cup") over multi-unit ("2 cups")
                // This helps select the canonical serving when multiple exist
                const servingAmountMatch = description.match(/^(\d+(?:\.\d+)?)\s+/);
                if (servingAmountMatch) {
                    const servingAmount = parseFloat(servingAmountMatch[1]);
                    // Prefer single-unit servings
                    if (servingAmount === 1) {
                        score += 0.5; // Small bonus for "1 cup" vs "2 cups"
                    }
                }

                if (!exactMatch || score > exactMatch.score) {
                    exactMatch = { serving, score, factor: 1 };
                }
                continue;
            }
        }

        // Volume conversion match
        if (effectiveUnit && requestedVolumeUnit) {
            let servingVolume = extractServingVolumeUnit(description);

            // Fallback: check metricServingUnit for volume data when description lacks it
            // This handles cases like "serving" with metricServingAmount=240, metricServingUnit="ml"
            if (!servingVolume && serving.metricServingUnit && serving.metricServingAmount) {
                const metricUnit = serving.metricServingUnit.toLowerCase();
                if (volumeToMl[metricUnit]) {
                    servingVolume = { unit: metricUnit, amount: serving.metricServingAmount };
                }
            }

            if (servingVolume && volumeToMl[servingVolume.unit]) {
                const servingMl = servingVolume.amount * volumeToMl[servingVolume.unit];
                const requestedMl = volumeToMl[requestedVolumeUnit];
                if (servingMl > 0 && requestedMl > 0) {
                    conversionFactor = requestedMl / servingMl;
                    if (minVolumeGrams && requestedVolumeUnit) {
                        const perUnitGrams = (grams / unitsPerServing) * conversionFactor;
                        if (perUnitGrams < minVolumeGrams) {
                            continue;
                        }
                    }
                    score += 2.5;
                    if (!sameTypeMatch || score > sameTypeMatch.score) {
                        sameTypeMatch = { serving, score, factor: conversionFactor };
                    }
                    continue;
                }
            }
        }

        // Same unit type match (count for count, volume for volume)
        if (requestedUnitType === 'count' && isCountServing(description)) {
            score += 2;
            if (!sameTypeMatch || score > sameTypeMatch.score) {
                sameTypeMatch = { serving, score, factor: 1 };
            }
            continue;
        }

        // For count-based requests, DON'T use generic serving as fallback
        if (requestedUnitType === 'count' && isGenericServing(description)) {
            // Skip - we don't want "serving = 28g" for "slice" requests
            continue;
        }

        // For VOLUME-based requests (cup, tbsp, tsp), DON'T use generic mass servings as fallback
        // Issue: "g" servings with numberOfUnits=100 give 1g per unit, causing microscopic values
        // e.g., "0.5 cup mayonnaise" was getting 0.9g because it used "g" serving with 100 units
        if (requestedUnitType === 'volume') {
            const isGenericMassServing = (
                description === 'g' ||
                description === 'gram' ||
                description === 'grams' ||
                description === 'oz' ||
                description === 'ounce' ||
                description === 'ml' ||
                (description.match(/^\d+\s*g$/) !== null) // "100 g"
            );
            if (isGenericMassServing) {
                // Skip - we don't want "g = 100g, 100 units" for "cup" requests
                // This should trigger volume conversion fallback with estimated density instead
                continue;
            }
        }

        // Non-matching serving (can only be used as fallback for unknown/mass units)
        if (requestedUnitType !== 'count' && requestedUnitType !== 'volume') {
            // Only allow generic fallback for mass units (where "g" serving is appropriate)
            if (!fallbackMatch || score > fallbackMatch.score) {
                fallbackMatch = { serving, score, factor: 1 };
            }
        }
    }

    // Select best match with proper typing
    let selected: { serving: FatSecretServing; score: number; factor: number } | null = null;
    let matchType: 'exact' | 'same_type' | 'fallback' | 'no_match' = 'no_match';
    let warning: string | undefined;

    if (exactMatch) {
        selected = exactMatch;
        matchType = 'exact';
    } else if (sameTypeMatch) {
        selected = sameTypeMatch;
        matchType = 'same_type';
    } else if (fallbackMatch && effectiveUnit) {
        // For volume requests with no matching serving, try to estimate grams from common food densities
        // This is a best-effort fallback when no proper serving exists
        if (requestedUnitType === 'volume') {
            // Estimate: 1 cup of powder/granular food ≈ 120-220g, use middle ground
            // Common densities: sugar ~200g/cup, flour ~120g/cup, oats ~80g/cup
            const cupToGramsEstimate: Record<string, number> = {
                'cup': 180,  // General estimate
                'tbsp': 11.25,  // 180/16
                'tsp': 3.75,  // 180/48
            };
            const requestedVolUnit = getCanonicalVolumeUnit(effectiveUnit);
            if (requestedVolUnit && cupToGramsEstimate[requestedVolUnit]) {
                // Use density-based estimate as conversion factor
                const gramsPerUnit = cupToGramsEstimate[requestedVolUnit];
                const servingGrams = gramsForServing(fallbackMatch.serving) || 1;
                fallbackMatch.factor = gramsPerUnit / servingGrams;
                warning = `No "${effectiveUnit}" serving found, estimated ${gramsPerUnit}g per ${effectiveUnit}`;
            }
        }

        // For count requests (slice, piece, serving), use typical estimates
        if (requestedUnitType === 'count') {
            // Common count-to-grams estimates for when no proper serving exists
            const countToGramsEstimate: Record<string, number> = {
                'slice': 15,     // Average slice of bread, cheese, etc.
                'slices': 15,
                'piece': 20,     // Average small piece
                'pieces': 20,
                'serving': 100,  // Standard serving
                'servings': 100,
            };
            const unitLower = effectiveUnit.toLowerCase();
            if (countToGramsEstimate[unitLower]) {
                const gramsPerUnit = countToGramsEstimate[unitLower];
                const servingGrams = gramsForServing(fallbackMatch.serving) || 1;
                fallbackMatch.factor = gramsPerUnit / servingGrams;
                warning = `No "${effectiveUnit}" serving found, estimated ${gramsPerUnit}g per ${effectiveUnit}`;
            }
        }

        selected = fallbackMatch;
        matchType = 'fallback';
        if (!warning) warning = `No "${effectiveUnit}" serving found, using fallback`;
    } else if (!effectiveUnit) {
        // No unit specified - PREFER whole-item servings for produce
        // e.g., "1 cucumber" should use "medium" (~300g), NOT "slice" (7g)

        // PRIORITY 1: Look for WHOLE-ITEM servings (medium, large, small, whole, fruit)
        const wholeItemPatterns = [
            /\bmedium\b/i, /\blarge\b/i, /\bsmall\b/i,
            /\bwhole\b/i, /\beach\b/i,
            /\bfruit\b/i, /\bfruits\b/i,  // For "1 mango" → "fruit without refuse"
            /\bhead\b/i, /\bheads\b/i,    // For "1 lettuce" → "head"
        ];

        const wholeItemServing = servings.find(s => {
            const desc = (s.measurementDescription || s.description || '').toLowerCase();
            const g = gramsForServing(s);
            return g != null && g > 0 && wholeItemPatterns.some(p => p.test(desc));
        });

        if (wholeItemServing) {
            selected = { serving: wholeItemServing, score: 1.0, factor: 1 };
            matchType = 'same_type';
            logger.debug('selectServing.unitless_whole_item_serving', {
                description: wholeItemServing.measurementDescription || wholeItemServing.description,
                grams: gramsForServing(wholeItemServing),
            });
        } else {
            // PRIORITY 2: Look for other count-based servings (clove, piece, slice, etc.)
            // These are for items where partial servings are default (garlic cloves, bread slices)
            const countPatterns = [
                /\bclove\b/i, /\bcloves\b/i,
                /\bpiece\b/i, /\bpieces\b/i,
                /\bslice\b/i, /\bslices\b/i,
                /\bsprig\b/i, /\bsprigs\b/i,
                /\bleaf\b/i, /\bleaves\b/i,
                /\bstalk\b/i, /\bstalks\b/i,
            ];

            const countServing = servings.find(s => {
                const desc = (s.measurementDescription || s.description || '').toLowerCase();
                const g = gramsForServing(s);
                return g != null && g > 0 && countPatterns.some(p => p.test(desc));
            });

            if (countServing) {
                selected = { serving: countServing, score: 1.0, factor: 1 };
                matchType = 'same_type';
                logger.debug('selectServing.unitless_count_serving', {
                    description: countServing.measurementDescription || countServing.description,
                    grams: gramsForServing(countServing),
                });
            } else {
                // No suitable serving found - return null to trigger AI backfill
                // e.g., "5 garlic" should get a "clove" serving, not use 100g generic
                logger.warn('selectServing.unitless_no_count_serving', {
                    availableServings: servings.map(s => s.measurementDescription || s.description).slice(0, 5),
                });
                return null;  // Trigger AI backfill for count-based serving
            }
        }
    }

    // No match for count-based units - return null with warning
    if (!selected && requestedUnitType === 'count') {
        logger.warn('selectServing.no_count_match', {
            unit,
            requestedType: requestedUnitType,
            availableServings: servings.map(s => s.measurementDescription || s.description).slice(0, 5),
        });
        return null;
    }

    if (!selected) return null;

    const unitsPerServing = selected.serving.numberOfUnits && selected.serving.numberOfUnits > 0
        ? selected.serving.numberOfUnits
        : 1;
    const bestGrams = gramsForServing(selected.serving);
    const adjustedGrams = bestGrams ? (bestGrams / unitsPerServing) * selected.factor : null;

    // Debug: Log the selected serving to help diagnose gram calculation issues
    logger.debug('selectServing.result', {
        requestedUnit: effectiveUnit,
        requestedQty: qty,
        selectedServing: selected.serving.measurementDescription || selected.serving.description,
        selectedGrams: bestGrams,
        conversionFactor: selected.factor,
        adjustedGrams,
        matchType,
        matchScore: selected.score,
    });

    return {
        serving: selected.serving,
        matchScore: selected.score,
        gramsPerUnit: adjustedGrams,
        unitsPerServing: unitsPerServing,
        baseGrams: adjustedGrams,
        matchType,
        warning,
    };
}

// ============================================================
// Helper Functions
// ============================================================

function gramsForServing(
    serving: FatSecretServing,
    foodName?: string | null
): number | null {
    if (serving.servingWeightGrams && serving.servingWeightGrams > 0) {
        return serving.servingWeightGrams;
    }
    if (serving.metricServingUnit?.toLowerCase() === 'g' && serving.metricServingAmount) {
        return serving.metricServingAmount;
    }
    if (serving.metricServingUnit?.toLowerCase() === 'ml' && serving.metricServingAmount) {
        // IMPORTANT: ml ≠ grams! Must apply density conversion.
        // 1. Try to infer category from food name
        // 2. Look up category density (legume: 0.90, grain: 0.80, rice: 0.85, etc.)
        // 3. Fallback to 1.0 g/ml (water-like)
        let density = 1.0;  // Default: water-like

        if (foodName) {
            // Import dynamically to avoid circular deps - but we know it's already loaded
            const { inferCategoryFromName, categoryDensity } = require('../units/density');
            const category = inferCategoryFromName(foodName);
            if (category) {
                const catDensity = categoryDensity(category);
                if (catDensity) {
                    density = catDensity;
                    logger.debug('gramsForServing.category_density', {
                        foodName,
                        category,
                        density,
                        ml: serving.metricServingAmount
                    });
                }
            }
        }

        return serving.metricServingAmount * density;
    }
    return null;
}



function computeMacros(
    serving: FatSecretServing,
    qty: number,
    unitsPerServing: number,
    gramsOverride?: number | null
) {
    const baseGrams = gramsForServing(serving);

    // If we have a grams override and a base reference, scale macros
    if (gramsOverride && baseGrams) {
        const factor = gramsOverride / baseGrams;
        if (serving.calories == null || serving.protein == null || serving.carbohydrate == null || serving.fat == null) {
            return null;
        }
        return {
            kcal: serving.calories * factor * qty,
            protein: serving.protein * factor * qty,
            carbs: serving.carbohydrate * factor * qty,
            fat: serving.fat * factor * qty,
        };
    }

    // Otherwise scale by units
    const divisor = unitsPerServing > 0 ? unitsPerServing : 1;
    const factorFromUnits = qty / divisor;

    if (serving.calories == null || serving.protein == null || serving.carbohydrate == null || serving.fat == null) {
        return null;
    }

    return {
        kcal: serving.calories * factorFromUnits,
        protein: serving.protein * factorFromUnits,
        carbs: serving.carbohydrate * factorFromUnits,
        fat: serving.fat * factorFromUnits,
    };
}

// Re-export types for backward compatibility
export type { MapIngredientOptions as MapIngredientWithFallbackOptions };
