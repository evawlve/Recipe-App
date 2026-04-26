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
    hasCoreTokenMismatch,
    hasNullOrInvalidMacros,
} from './filter-candidates';
import { simpleRerank, toRerankCandidate, extractLeanPercentage, isGenericGroundMeatQuery, stripPrepModifiers } from './simple-rerank';
import { getValidatedMappingByNormalizedName, saveValidatedMapping, getAiNormalizeCache } from './validated-mapping-helpers';
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
import { backfillOnDemand, isDiscreteItem } from './serving-backfill';
import { classifyUnit } from './unit-type';
import { isAmbiguousUnit, getOrCreateAmbiguousServing } from './ambiguous-unit-backfill';
import { shouldNormalizeLlm } from './normalize-gate';
import { extractModifierConstraints } from './modifier-constraints';
import { incrementSkippedByGate, incrementCacheHit } from '../ai/structured-client';
import { extractPrepModifier, generatePreemptiveServings } from './preemptive-backfill';
import { requestAiNutrition, extractBaseFoodContext, getAiServingGrams } from './ai-nutrition-backfill';
import { AI_NUTRITION_BACKFILL_ENABLED } from './config';
import { hydrateOffCandidate } from '../openfoodfacts/hydrate';
import { detectBrandInQuery } from './brand-detector';

// ============================================================
// In-Flight Lock (Prevents race conditions in parallel processing)
// ============================================================
// When multiple threads try to map the same ingredient simultaneously,
// only the first one runs the full pipeline. Others wait for its result.
const inFlightLocks = new Map<string, Promise<FatsecretMappedIngredient | null>>();

// Minimum confidence to SKIP AI simplify fallback
// If winner confidence is below this, we try AI simplify even if there's a winner
// This catches cases like "burger relish" -> "Black Bean Burger" (0.80 conf)
// where AI simplify would correctly map to "Pickle Relish"
const MIN_CONFIDENCE_FOR_FALLBACK_SKIP = 0.85;

// ============================================================
// AI Parse Event Logger (for debugging/learning)
// ============================================================
// Logs every AI parse assist call to a dedicated file so we can:
// 1. See exactly which ingredients triggered AI parsing
// 2. Compare regex parser output vs AI output
// 3. Identify patterns to improve the regex parser
import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';

interface AiParseLogEntry {
    rawLine: string;
    regexResult: unknown;
    triggerReason: string;
    aiResult: unknown;
    outcome: 'success' | 'rejected_absurd_qty' | 'ai_failed';
}

function logAiParseEvent(entry: AiParseLogEntry): void {
    try {
        const logsDir = join(process.cwd(), 'logs');
        if (!existsSync(logsDir)) {
            mkdirSync(logsDir, { recursive: true });
        }
        const logPath = join(logsDir, 'ai-parse-events.jsonl');
        const logEntry = {
            timestamp: new Date().toISOString(),
            ...entry,
        };
        appendFileSync(logPath, JSON.stringify(logEntry) + '\n');
    } catch (err) {
        // Don't fail the pipeline for logging errors
        logger.warn('ai_parse_log.write_failed', { error: (err as Error).message });
    }
}

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
    source: 'fatsecret' | 'fdc' | 'cache' | 'ai_generated' | 'openfoodfacts';
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

    // Step 0b: Pre-parse unit cleanup
    // The parser doesn't recognize "second spray" as a unit (e.g., "0.33 second spray")
    // Replace it with just "spray" before parsing so the quantity and "spray" unit separate cleanly.
    let preProcessLine = effectiveQuery
        .replace(/\bseconds?\s+(spray|squirt)s?\b/gi, '$1')
        .replace(/\bsec\s+(spray|squirt)s?\b/gi, '$1');

    // Step 1: Parse and normalize
    // NOTE: Cache lookup now only happens after normalization (see "EARLY CACHE CHECK" below)
    // This eliminates "selection drift" where raw line variations would get different mappings
    let parsed = parseIngredientLine(preProcessLine);
    let baseName = parsed?.name?.trim() || preProcessLine;

    // Step 1-AI-FALLBACK: If regex parser didn't detect a unit but input looks complex,
    // try AI to extract qty/unit/name. This handles edge cases like "1 5 floz serving red wine"
    // where the parser gets confused by the leading "1" serving count.
    const looksLikeHasUnit = /\d+\s*(floz|fl\s*oz|oz|cup|tbsp|tsp|ml|g|lb|lbs|serving)\b/i.test(trimmed);
    if (!parsed?.unit && looksLikeHasUnit && !_skipFallback) {
        logger.info('mapping.ai_parse_fallback_attempt', { rawLine: trimmed });
        const aiParsed = await aiParseIngredient(trimmed);
        if (aiParsed.status === 'success' && aiParsed.name) {
            // SANITY CHECK: Reject absurd quantity values
            // This catches OCR/import artifacts like "0 311625 cup" where the AI
            // might misinterpret malformed numbers as quantities
            const MAX_REASONABLE_QTY = 1000;
            const aiQty = aiParsed.qty ?? 1;

            if (aiQty > MAX_REASONABLE_QTY) {
                logger.warn('mapping.ai_parse_qty_rejected', {
                    rawLine: trimmed,
                    aiQty,
                    reason: 'exceeds_max_reasonable_qty',
                });
                // Don't use AI result - keep original parsed values

                // Log to dedicated file for debugging
                logAiParseEvent({
                    rawLine: trimmed,
                    regexResult: parsed,
                    triggerReason: 'unit_pattern_detected_but_not_parsed',
                    aiResult: aiParsed,
                    outcome: 'rejected_absurd_qty',
                });
            } else {
                // Update parsed with AI results
                parsed = {
                    qty: aiQty,
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

                // Log to dedicated file for debugging
                logAiParseEvent({
                    rawLine: trimmed,
                    regexResult: { qty: null, unit: null, name: trimmed },  // Original failed parse
                    triggerReason: 'unit_pattern_detected_but_not_parsed',
                    aiResult: aiParsed,
                    outcome: 'success',
                });
            }
        } else {
            // Log failed AI parse attempts  
            logAiParseEvent({
                rawLine: trimmed,
                regexResult: parsed,
                triggerReason: 'unit_pattern_detected_but_not_parsed',
                aiResult: aiParsed.status === 'error' ? { error: aiParsed.reason } : null,
                outcome: 'ai_failed',
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

        // ── Brand detection (static list, no LLM required) ─────────────
        // Must run before the early cache check so the brand guard is available
        // when validating cached results against the user's intended brand.
        const brandDetection = detectBrandInQuery(rawLine);
        let isBrandedQuery = brandDetection.isBranded;
        if (brandDetection.isBranded) {
            logger.debug('brand_detector.matched', {
                rawLine,
                matchedBrand: brandDetection.matchedBrand,
            });
        }


        // ============================================================
        // EARLY CACHE CHECK - Skip AI if we've seen this ingredient before
        // ============================================================
        // Check ValidatedMapping for normalized name BEFORE calling AI
        // This is the key optimization: "1 cup chopped onion" → normalized "onion" → cache hit!
        const earlyCacheHit = skipCache ? null : await getValidatedMappingByNormalizedName(normalizedName, 'fatsecret', trimmed);
        if (earlyCacheHit) {
            logger.info('mapping.early_cache_hit', { rawLine: trimmed, normalizedName, foodName: earlyCacheHit.foodName });

            // Validate cached mapping against current filters
            // Cached mappings from before filter improvements may have bad mappings
            const earlyCoreTokenMismatch = hasCoreTokenMismatch(normalizedName, earlyCacheHit.foodName, earlyCacheHit.brandName);

            let earlyNutritionInvalid = false;
            let loadedFdcNutrition: any = null;

            if (!earlyCoreTokenMismatch) {
                const { prisma } = await import('../db');
                if (earlyCacheHit.foodId.startsWith('fdc_')) {
                    const fdcId = parseInt(earlyCacheHit.foodId.replace('fdc_', ''), 10);
                    const cachedFdc = await prisma.fdcFoodCache.findUnique({
                        where: { id: fdcId },
                        select: { nutrients: true }
                    });
                    if (cachedFdc?.nutrients) {
                        const rawFdc: any = cachedFdc.nutrients;
                        loadedFdcNutrition = {
                            kcal: rawFdc.energy ?? rawFdc.calories ?? 0,
                            protein: rawFdc.protein ?? 0,
                            carbs: rawFdc.carbohydrate ?? rawFdc.carbs ?? 0,
                            fat: rawFdc.fat ?? 0,
                            per100g: true,
                        };
                        earlyNutritionInvalid = hasNullOrInvalidMacros(loadedFdcNutrition);
                        if (earlyNutritionInvalid) {
                            logger.warn('mapping.early_cache_bad_nutrition', {
                                rawLine: trimmed,
                                cachedFood: earlyCacheHit.foodName,
                                nutrients: loadedFdcNutrition,
                            });
                        }
                    } else {
                        try {
                            const { fdcApi } = await import('../usda/fdc-api');
                            const details = await fdcApi.getFoodDetails(fdcId);
                            
                            // Map FDC api array format
                            if (details?.foodNutrients) {
                                const getNutrient = (id: number) => {
                                    const n = details.foodNutrients.find((x: any) => x.nutrient?.id === id || x.nutrientId === id);
                                    return n?.amount || 0;
                                };
                                loadedFdcNutrition = {
                                    kcal: getNutrient(1008),
                                    protein: getNutrient(1003),
                                    carbs: getNutrient(1005),
                                    fat: getNutrient(1004),
                                    per100g: true,
                                };
                                earlyNutritionInvalid = hasNullOrInvalidMacros(loadedFdcNutrition);
                            } else {
                                earlyNutritionInvalid = true;
                            }
                        } catch (err) {
                            logger.error('mapping.early_cache_fdc_fetch_failed', { fdcId, error: (err as Error).message });
                            earlyNutritionInvalid = true;
                        }
                    }
                } else {
                    const cachedFood = await prisma.fatSecretFoodCache.findUnique({
                        where: { id: earlyCacheHit.foodId },
                        select: { nutrientsPer100g: true }
                    });
                    if (cachedFood?.nutrientsPer100g) {
                        const nutrients = cachedFood.nutrientsPer100g as any;
                        earlyNutritionInvalid = hasNullOrInvalidMacros(nutrients);
                        if (earlyNutritionInvalid) {
                            logger.warn('mapping.early_cache_bad_nutrition', {
                                rawLine: trimmed,
                                cachedFood: earlyCacheHit.foodName,
                                nutrients,
                            });
                        }
                    }
                }
            }

            if (earlyCoreTokenMismatch ||
                earlyNutritionInvalid ||
                isCategoryMismatch(normalizedName, earlyCacheHit.foodName, earlyCacheHit.brandName) ||
                isMultiIngredientMismatch(normalizedName, earlyCacheHit.foodName) ||
                hasCriticalModifierMismatch(trimmed, earlyCacheHit.foodName, 'cache') ||
                isReplacementMismatch(trimmed, earlyCacheHit.foodName, earlyCacheHit.brandName) ||
                // Branded query guard: if a target brand is detected (e.g. "heinz") and the cached
                // food belongs to a DIFFERENT brand (e.g. WEIS), reject the cache hit so the full
                // pipeline runs and finds the correct brand.
                (isBrandedQuery &&
                    brandDetection.matchedBrand != null &&
                    earlyCacheHit.brandName != null &&
                    !earlyCacheHit.brandName.toLowerCase().includes(brandDetection.matchedBrand.toLowerCase())
                )) {
                logger.warn('mapping.early_cache_filter_mismatch', {
                    rawLine: trimmed,
                    cachedFood: earlyCacheHit.foodName,
                    normalized: normalizedName,
                    coreTokenMismatch: earlyCoreTokenMismatch,
                    nutritionInvalid: earlyNutritionInvalid,
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
                    ...(loadedFdcNutrition ? { nutrition: loadedFdcNutrition } : {})
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
        // ── Brand detection (already computed above, available here too) ────
        // isBrandedQuery and brandDetection are set before the early cache check.
        // The LLM result below may upgrade isBrandedQuery to true if the AI
        // returns isBranded=true even when the static detector missed it.

        if (!usedGenericFallback) {
            // First gather candidates to check if LLM is needed
            const quickGatherOptions: GatherOptions = {
                client,
                skipCache,
                skipLiveApi: !allowLiveFallback,
                skipFdc,
                skipOff: true,  // Always skip OFF during quick gate check (saves API quota)
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

                // FIX: Pass baseName instead of rawLine so the LLM output is cached by the normalized quantity-free string
                const aiHint = await aiNormalizeIngredient(baseName, normalizedName);
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
                    isBrandedQuery = aiHint.isBranded ?? false;  // Capture brand signal for scoring
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

                // Even when LLM is skipped, retrieve cached nutrition estimate
                // (from a previous LLM call) for the reranker's nutrition tiebreaker.
                // This is critical for cases like rice vinegar where all candidates
                // score identically but have vastly different calorie profiles.
                // FIX: Use baseName instead of rawLine to hit the cache for quantity variations!
                const cachedNormalize = await getAiNormalizeCache(baseName);
                if (cachedNormalize?.nutritionEstimate) {
                    aiNutritionEstimate = cachedNormalize.nutritionEstimate;
                    aiCanonicalBase = cachedNormalize.canonicalBase;
                    logger.debug('normalize_gate.cached_nutrition_estimate', {
                        baseName,
                        estimate: aiNutritionEstimate.caloriesPer100g,
                        confidence: aiNutritionEstimate.confidence,
                    });
                }
                // Also restore isBranded from cached normalize result
                if (cachedNormalize) {
                    isBrandedQuery = (cachedNormalize as any).isBranded ?? false;
                }
            }
        }

        // Context-dependent normalization: bare "pepper" in spice context → "black pepper"
        // Applied AFTER AI normalization to prevent AI from overriding the rewrite.
        // When the unit is a spice measure (dash, pinch, tsp, tbsp), the user means black pepper,
        // not bell/poblano/hungarian peppers.
        const SPICE_CONTEXT_UNITS_FB = new Set(['dash', 'pinch', 'tsp', 'tbsp', 'teaspoon', 'tablespoon']);
        const parsedUnitForContextFB = parsed?.unit?.toLowerCase() ?? '';
        if (/^pepper$/i.test(normalizedName.trim()) && SPICE_CONTEXT_UNITS_FB.has(parsedUnitForContextFB)) {
            logger.info('fatsecret.map.pepper_spice_rewrite', { rawLine: trimmed, originalName: normalizedName, unit: parsedUnitForContextFB });
            normalizedName = 'black pepper';
        }

        // Context-dependent bouillon rewrite: "bouillon" with volume unit -> "broth"
        // This prevents mapping "1 cup beef bouillon" to powdered concentrate and getting 300kcal/cup
        const VOLUME_UNITS = new Set(['cup', 'cups', 'floz', 'fl oz', 'quart', 'quarts', 'gallon', 'gallons', 'ml', 'liter', 'liters', 'pint', 'pints']);
        if (/\bbouillon\b/i.test(normalizedName) && VOLUME_UNITS.has(parsedUnitForContextFB)) {
            logger.info('fatsecret.map.bouillon_broth_rewrite', { rawLine: trimmed, originalName: normalizedName, unit: parsedUnitForContextFB });
            normalizedName = normalizedName.replace(/\bbouillon\b/gi, 'broth');
        }

        // Context-dependent corn rewrite: "corn" in a can should map to sweet corn, not dry corn grain
        if (/\bcorn\b/i.test(normalizedName) && (parsedUnitForContextFB === 'can' || /\bcanned\b/i.test(trimmed))) {
            logger.info('fatsecret.map.canned_corn_rewrite', { rawLine: trimmed, originalName: normalizedName });
            if (!normalizedName.toLowerCase().includes('sweet')) {
                normalizedName = normalizedName.replace(/\bcorn\b/gi, 'sweet corn');
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
            const normalizedCache = await getValidatedMappingByNormalizedName(normalizedName, 'fatsecret', trimmed);
            if (normalizedCache) {
                logger.info('mapping.normalized_cache_hit', { rawLine: trimmed, normalizedName });
                const normalizedCoreTokenMismatch = hasCoreTokenMismatch(normalizedName, normalizedCache.foodName, normalizedCache.brandName);

                // Validate nutrition data - reject cached mappings to foods with zero/null nutrition
                let normalizedNutritionInvalid = false;
                if (!normalizedCoreTokenMismatch) {
                    const { prisma } = await import('../db');
                    const cachedFood = await prisma.fatSecretFoodCache.findUnique({
                        where: { id: normalizedCache.foodId },
                        select: { nutrientsPer100g: true }
                    });
                    if (cachedFood?.nutrientsPer100g) {
                        const nutrients = cachedFood.nutrientsPer100g as any;
                        normalizedNutritionInvalid = hasNullOrInvalidMacros(nutrients);
                        if (normalizedNutritionInvalid) {
                            logger.warn('mapping.normalized_cache_bad_nutrition', {
                                rawLine: trimmed,
                                cachedFood: normalizedCache.foodName,
                                nutrients,
                            });
                        }
                    }
                }

                if (normalizedCoreTokenMismatch ||
                    normalizedNutritionInvalid ||
                    isCategoryMismatch(normalizedName, normalizedCache.foodName, normalizedCache.brandName) ||
                    isMultiIngredientMismatch(normalizedName, normalizedCache.foodName) ||
                    // For branded queries: skip modifier mismatch when the cached food's brand
                    // matches the detected brand (e.g. "Oikos" query → "Oikos Triple Zero Vanilla Nonfat"
                    // should not be rejected just because "nonfat" is in the food name but not the query).
                    (!isBrandedQuery || !(
                        normalizedCache.brandName &&
                        brandDetection.matchedBrand &&
                        normalizedCache.brandName.toLowerCase().includes(brandDetection.matchedBrand.toLowerCase())
                    )
                        ? hasCriticalModifierMismatch(trimmed, normalizedCache.foodName, 'cache')
                        : false
                    ) ||
                    isReplacementMismatch(trimmed, normalizedCache.foodName, normalizedCache.brandName) ||
                    // For branded queries with a known target brand: reject cached results from a
                    // DIFFERENT brand. e.g. "Heinz Tomato Ketchup" query must not serve a cached
                    // "TOMATO KETCHUP (WEIS)" result — force a fresh pipeline run to find Heinz.
                    (isBrandedQuery &&
                        brandDetection.matchedBrand != null &&
                        normalizedCache.brandName != null &&
                        !normalizedCache.brandName.toLowerCase().includes(brandDetection.matchedBrand.toLowerCase())
                    )) {
                    logger.warn('mapping.normalized_cache_filter_mismatch', {
                        rawLine: trimmed,
                        cachedFood: normalizedCache.foodName,
                        normalized: normalizedName,
                        coreTokenMismatch: normalizedCoreTokenMismatch,
                        nutritionInvalid: normalizedNutritionInvalid,
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
                isBrandedQuery,
                targetBrand: brandDetection.matchedBrand ?? undefined,
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

                // Step 3b: Apply core token validation to filtered candidates
                // This catches cases like "dry brown rice" → "dry brown beans" (missing "rice" token)
                const beforeCoreFilter = filtered.length;
                filtered = filtered.filter(c => {
                    const mismatch = hasCoreTokenMismatch(normalizedName, c.name, c.brandName);
                    if (mismatch && debug) {
                        logger.debug('mapping.core_token_filtered', {
                            normalizedName,
                            candidate: c.name,
                            reason: 'core_token_mismatch',
                        });
                    }
                    return !mismatch;
                });
                const coreFilterRemoved = beforeCoreFilter - filtered.length;
                if (coreFilterRemoved > 0) {
                    logger.info('mapping.core_token_filter_applied', {
                        rawLine: trimmed,
                        removed: coreFilterRemoved,
                        remaining: filtered.length,
                    });
                }

                if (filtered.length === 0) {
                    // Retry with relaxed filtering before giving up
                    const relaxedFilterResult = filterCandidatesByTokens(
                        allCandidates,
                        normalizedName,
                        { debug, rawLine: trimmed, relaxed: true }
                    );
                    
                    if (relaxedFilterResult.filtered.length > 0) {
                        filtered = relaxedFilterResult.filtered;
                        logger.info('mapping.relaxed_filter_recovery', {
                            rawLine: trimmed,
                            recoveredCount: filtered.length,
                        });
                    } else {
                        logger.warn('mapping.all_filtered', { rawLine: trimmed, removedCount: removedCount + coreFilterRemoved });
                        // Fall through to Fallback
                    }
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

                        // Enrich FatSecret candidates with cached nutrition data.
                        // FatSecret live search doesn't return per-100g nutrition, but
                        // previously hydrated foods have it in FatSecretFoodCache.
                        const candidatesForRerank = filtered.slice(0, 10);
                        const fsCandidatesMissingNutr = candidatesForRerank
                            .filter(c => c.source === 'fatsecret' && !c.nutrition);
                        if (fsCandidatesMissingNutr.length > 0) {
                            const { prisma } = await import('../db');
                            const fsIds = fsCandidatesMissingNutr.map(c => c.id);
                            const cachedFoods = await prisma.fatSecretFoodCache.findMany({
                                where: { id: { in: fsIds } },
                                select: { id: true, nutrientsPer100g: true },
                            });
                            for (const cf of cachedFoods) {
                                const nutrients = cf.nutrientsPer100g as any;
                                if (nutrients && nutrients.calories != null) {
                                    const cand = candidatesForRerank.find(c => c.id === cf.id);
                                    if (cand && !cand.nutrition) {
                                        cand.nutrition = {
                                            kcal: nutrients.calories ?? 0,
                                            protein: nutrients.protein ?? 0,
                                            carbs: nutrients.carbs ?? 0,
                                            fat: nutrients.fat ?? 0,
                                            per100g: true,
                                        };
                                    }
                                }
                            }
                        }

                        // FDC-based fallback for AI nutrition estimate.
                        // FDC candidates always have per-100g nutrition inline from
                        // the search API. When no AI estimate is available (LLM gate
                        // skipped and no cached estimate), use the best-matching FDC
                        // candidate's nutrition as a synthetic reference for the tiebreaker.
                        if (!aiNutritionEstimate) {
                            const fdcRef = candidatesForRerank.find(
                                c => c.source === 'fdc' && c.nutrition?.per100g && (c.nutrition.kcal > 0 || c.nutrition.protein > 0)
                            );
                            if (fdcRef && fdcRef.nutrition) {
                                aiNutritionEstimate = {
                                    caloriesPer100g: fdcRef.nutrition.kcal,
                                    proteinPer100g: fdcRef.nutrition.protein,
                                    carbsPer100g: fdcRef.nutrition.carbs,
                                    fatPer100g: fdcRef.nutrition.fat,
                                    confidence: 0.6,  // Lower confidence than LLM estimate
                                };
                                logger.debug('mapping.fdc_nutrition_fallback', {
                                    rawLine: trimmed,
                                    fdcName: fdcRef.name,
                                    fdcId: fdcRef.id,
                                    estimate: aiNutritionEstimate.caloriesPer100g,
                                });
                            }
                        }

                        const rerankCandidates = candidatesForRerank.map(c => toRerankCandidate({
                            id: c.id,
                            name: c.name,
                            brandName: c.brandName,
                            foodType: c.foodType,
                            score: c.score,
                            source: c.source,
                            nutrition: c.nutrition,  // Include for Route C macro sanity check + nutrition tiebreaker
                        }));

                        // Hybrid prep stripping: prefer AI canonicalBase (strips prep but preserves
                        // nutritional modifiers), fall back to local prep-word stripping.
                        // The raw line (trimmed) is still passed for modifier constraint extraction.
                        const rerankQuery = aiCanonicalBase || stripPrepModifiers(searchQuery);
                        const rerankResult = simpleRerank(rerankQuery, rerankCandidates, aiNutritionEstimate, trimmed, isBrandedQuery, brandDetection.matchedBrand ?? undefined);

                        if (rerankResult && rerankResult.winner) {
                            const selected = filtered.find(c => c.id === rerankResult.winner!.id);
                            if (selected) {
                                winner = selected;
                                confidence = rerankResult.confidence;
                                selectionReason = rerankResult.reason;
                            }
                        }

                        if (!winner && sortedFiltered.length > 0) {
                            // Fallback to top scorer ONLY if above minimum threshold
                            const MIN_FALLBACK_CONFIDENCE = 0.80;
                            if (sortedFiltered[0].score >= MIN_FALLBACK_CONFIDENCE) {
                                winner = sortedFiltered[0];
                                confidence = winner.score;
                                selectionReason = 'scored_by_confidence';
                            } else {
                                // Below threshold - let fallback step handle it
                                logger.info('mapping.fallback_rejected', {
                                    rawLine: trimmed,
                                    topCandidate: sortedFiltered[0].name,
                                    score: sortedFiltered[0].score,
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
                // requestSizeEstimates was removed — use proactiveProduceBackfill instead
                const requestSizeEstimates: any = null; // TODO: Replace with proper implementation
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

                        const sizeResult = requestSizeEstimates ? await requestSizeEstimates(winner.name, 'fdc') : { status: 'skipped' as const };

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

        // Step 2b: Semantic Fallback (If no winner at all)
        // Handle complex lines like "buttermilk pancake mix light" -> "Pancake Mix"
        // Also handle cases like "burger relish" -> "Black Bean Burger" (low conf)
        // where AI simplify would correctly return "Pickle Relish"
        // Skip if this is already a recursive fallback call to prevent infinite loops
        // NOTE: Only fire when !winner. If we have a winner from rerank (even with 
        // moderate confidence), let it proceed to hydration + volume backfill (L1108-1232)
        // instead of overriding with a potentially worse fallback candidate.
        const shouldTryFallback = !winner;
        if (shouldTryFallback && !_skipFallback) {
            logger.info('mapping.attempting_fallback', { rawLine: trimmed, currentConfidence: confidence, winner: winner?.name });

            // ── Step 2b-i: Dietary-prefix stripping fallback ──────────────
            // If the ingredient has a dietary-attribute prefix (fat-free, gluten-free, sugar-free, etc.),
            // try re-searching WITHOUT it. These prefixes describe what's ABSENT, not what the food IS.
            // We try the full term FIRST (above), and only strip as a fallback.
            // Example flow: "gluten-free salad seasoning" → initial search fails → retry "salad seasoning"
            const DIETARY_PREFIX_PATTERN = /\b(?:fat[- ]?free|nonfat|non[- ]?fat|gluten[- ]?free|sugar[- ]?free|dairy[- ]?free|grain[- ]?free|nut[- ]?free)\s+/gi;
            const strippedLine = trimmed.replace(DIETARY_PREFIX_PATTERN, '').trim();

            if (strippedLine !== trimmed && strippedLine.length > 2) {
                logger.info('mapping.dietary_prefix_fallback', { original: trimmed, stripped: strippedLine });

                const dietaryFallbackResult = await mapIngredientWithFallback(strippedLine, {
                    ...options,
                    minConfidence: 0.1,
                    _skipInFlightLock: true,
                    _skipFallback: true, // Prevent infinite recursion
                });

                if (dietaryFallbackResult && 'confidence' in dietaryFallbackResult && dietaryFallbackResult.confidence > 0) {
                    logger.info('mapping.dietary_prefix_fallback_success', {
                        original: trimmed,
                        stripped: strippedLine,
                        food: dietaryFallbackResult.foodName,
                        confidence: dietaryFallbackResult.confidence,
                    });
                    return dietaryFallbackResult;
                }
            }

            // ── Step 2b-ii: LLM-based simplification ──────────────────────
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

                    if (fallbackResult && 'foodId' in fallbackResult) {
                        // Fallback found a food, but its serving data was computed without our original qty/unit
                        // Re-hydrate using the ORIGINAL parsed input for correct serving selection
                        const fbr = fallbackResult as FatsecretMappedIngredient;
                        const fallbackCandidate: UnifiedCandidate = {
                            id: fbr.foodId,
                            name: fbr.foodName,
                            brandName: fbr.brandName || undefined,
                            source: fbr.foodId.startsWith('fdc_') ? 'fdc' : 'cache',
                            score: fbr.confidence * 0.85,
                            foodType: 'generic',
                            rawData: {},
                        };

                        // For FDC candidates, populate nutrition from fallback result
                        // so buildFdcResult() can compute serving-specific nutrition
                        if (fbr.foodId.startsWith('fdc_') && fbr.grams > 0) {
                            const factor = 100 / fbr.grams;
                            fallbackCandidate.nutrition = {
                                kcal: fbr.kcal * factor,
                                protein: fbr.protein * factor,
                                carbs: fbr.carbs * factor,
                                fat: fbr.fat * factor,
                                per100g: true,
                            };
                        }

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
                                mappedTo: fbr.foodName,
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
            // ============================================================
            // AI NUTRITION BACKFILL: Last resort for unmappable ingredients
            // ============================================================
            if (AI_NUTRITION_BACKFILL_ENABLED) {
                const baseFoodContext = extractBaseFoodContext(allCandidates);
                const aiResult = await requestAiNutrition(normalizedName, {
                    rawLine: trimmed,
                    baseFoodContext,
                    isBatchMode: true,
                });

                if (aiResult.status === 'success') {
                    // Compute grams and nutrition for the requested serving
                    const parsedQty = parsed ? parsed.qty * parsed.multiplier : 1;
                    const parsedUnit = parsed?.unit || 'serving';

                    const servingResult = await getAiServingGrams(
                        aiResult.foodId,
                        parsedUnit,
                        parsedQty,
                    );

                    const grams = servingResult?.grams ?? 100;
                    const scale = grams / 100;

                    const aiMapped: FatsecretMappedIngredient = {
                        source: 'ai_generated',
                        foodId: aiResult.foodId,
                        foodName: aiResult.displayName,
                        brandName: null,
                        servingId: null,
                        servingDescription: servingResult?.servingLabel ?? `${parsedQty} ${parsedUnit}`,
                        grams,
                        kcal: aiResult.caloriesPer100g * scale,
                        protein: aiResult.proteinPer100g * scale,
                        carbs: aiResult.carbsPer100g * scale,
                        fat: aiResult.fatPer100g * scale,
                        confidence: aiResult.confidence * 0.8,  // Penalize slightly vs API matches
                        quality: aiResult.confidence >= 0.7 ? 'medium' : 'low',
                        rawLine,
                    };

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
                                foodId: aiResult.foodId,
                                foodName: aiResult.displayName,
                                brandName: '',
                                confidence: aiMapped.confidence,
                                selectionReason: aiResult.cached ? 'ai_nutrition_cache_hit' : 'ai_nutrition_generated',
                            },
                            selectedNutrition: {
                                calories: aiMapped.kcal,
                                protein: aiMapped.protein,
                                carbs: aiMapped.carbs,
                                fat: aiMapped.fat,
                                perGrams: aiMapped.grams,
                            },
                            servingSelection: {
                                servingDescription: aiMapped.servingDescription || 'N/A',
                                grams: aiMapped.grams,
                                backfillUsed: true,
                                backfillType: 'weight',
                            },
                            finalResult: 'success',
                            source: 'full_pipeline',
                            aiCalls: {
                                normalize: {
                                    called: !skippedLlmNormalize && !usedGenericFallback,
                                    skipped: skippedLlmNormalize,
                                },
                            },
                        });
                    }

                    logger.info('mapping.ai_nutrition_backfill_success', {
                        rawLine: trimmed,
                        foodName: aiResult.displayName,
                        confidence: aiMapped.confidence,
                        cached: aiResult.cached,
                    });

                    return aiMapped;
                } else {
                    logger.warn('mapping.ai_nutrition_backfill_failed', {
                        rawLine: trimmed,
                        reason: aiResult.reason,
                    });
                }
            }

            // Total failure — log and return null
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
        } as any : undefined);

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
                unit: parsed!.unit,
            });

            const backfillResult = await backfillWeightServing(winner.id);

            if (backfillResult.success) {
                // Retry hydration now that we have a weight serving
                result = await hydrateAndSelectServing(winner, parsed, confidence, rawLine, client);

                if (result) {
                    logger.info('mapping.weight_backfill_success', {
                        foodId: winner.id,
                        foodName: winner.name,
                        unit: parsed!.unit,
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

        // Step 5a-VOLUME: If hydration failed for a VOLUME unit (cup, tbsp, tsp, etc.),
        // try AI volume backfill to estimate density for the winner BEFORE falling back to other candidates.
        // This prevents falling back to semantically unrelated candidates just because they have volume servings.
        const isVolumeUnit = parsed?.unit && /^(cup|cups|tbsp|tablespoon|tablespoons|tsp|teaspoon|teaspoons|ml|milliliter|milliliters|floz|fl\s*oz|fluid\s*ounce|l|liter|liters)$/i.test(parsed.unit);

        // Extract prep modifier from ingredient line for modifier-aware serving labels
        const prepModifier = extractPrepModifier(rawLine, parsed?.qualifiers);

        // Enable AI backfill for BOTH FatSecret and FDC sources (FDC often lacks volume servings)
        if (!result && isVolumeUnit && (winner.source === 'fatsecret' || winner.source === 'fdc')) {
            logger.info('mapping.volume_backfill_attempt', {
                foodId: winner.id,
                foodName: winner.name,
                unit: parsed!.unit,
                source: winner.source,
                prepModifier,
            });

            const volumeBackfillResult = await insertAiServing(winner.id, 'volume', {
                targetServingUnit: parsed?.unit ?? undefined,
                prepModifier,
                candidateData: winner,  // Pass candidate data to avoid DB lookup race condition
            });

            if (volumeBackfillResult.success) {
                // Retry hydration now that we have a volume serving
                result = await hydrateAndSelectServing(winner, parsed, confidence, rawLine, client);

                if (result) {
                    logger.info('mapping.volume_backfill_success', {
                        foodId: winner.id,
                        foodName: winner.name,
                        unit: parsed!.unit,
                        grams: result.grams,
                    });
                    selectionReason = 'volume_backfill_success';
                }
            } else {
                logger.warn('mapping.volume_backfill_failed', {
                    foodId: winner.id,
                    reason: volumeBackfillResult.reason,
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
                // CRITICAL: Validate semantic relevance before accepting fallback
                // This prevents "golden flaxseed meal" → "Golden Delicious Apples" syndrome
                // where the fallback is selected just because it has the right serving, 
                // despite being semantically unrelated to the query
                if (hasCoreTokenMismatch(normalizedName, fallback.name, fallback.brandName)) {
                    logger.debug('mapping.fallback_rejected_token_mismatch', {
                        query: normalizedName,
                        fallbackName: fallback.name,
                        fallbackBrand: fallback.brandName,
                    });
                    continue; // Skip this fallback, try next one
                }


                let fallbackResult = await hydrateAndSelectServing(
                    fallback, parsed, confidence * 0.95, rawLine, client
                );

                // If hydration failed for a FatSecret candidate, try backfill before giving up
                if (!fallbackResult && fallback.source === 'fatsecret') {
                    if (isVolumeUnit) {
                        logger.info('mapping.fallback_volume_backfill_attempt', {
                            foodId: fallback.id,
                            foodName: fallback.name,
                            unit: parsed?.unit,
                            prepModifier,
                        });
                        const backfillResult = await insertAiServing(fallback.id, 'volume', {
                            targetServingUnit: parsed?.unit ?? undefined,
                            prepModifier,
                            candidateData: fallback,  // Pass candidate data to avoid DB lookup race condition
                        });
                        if (backfillResult.success) {
                            fallbackResult = await hydrateAndSelectServing(
                                fallback, parsed, confidence * 0.95, rawLine, client
                            );
                        }
                    } else if (isWeightUnit) {
                        logger.info('mapping.fallback_weight_backfill_attempt', {
                            foodId: fallback.id,
                            foodName: fallback.name,
                            unit: parsed?.unit,
                        });
                        const backfillResult = await backfillWeightServing(fallback.id);
                        if (backfillResult.success) {
                            fallbackResult = await hydrateAndSelectServing(
                                fallback, parsed, confidence * 0.95, rawLine, client
                            );
                        }
                    }
                }

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
                isBrandedQuery,
                targetBrand: brandDetection.matchedBrand ?? undefined,
                aiSynonyms: allSynonyms,
            };

            const searchCandidates = await gatherCandidates(rawLine, parsed, normalizedName, searchGatherOptions);

            if (searchCandidates.length > 0) {
                const searchFilterResult = filterCandidatesByTokens(searchCandidates, normalizedName, { debug, rawLine: trimmed });

                // Run reranker to ensure anomaly penalties (e.g. canned beans) are applied
                const rerankCandidates = searchFilterResult.filtered.map(c => toRerankCandidate({
                    id: c.id,
                    name: c.name,
                    brandName: c.brandName,
                    foodType: c.foodType,
                    score: c.score,
                    source: c.source,
                    nutrition: c.nutrition,
                }));
                const rerankQuery = aiCanonicalBase || stripPrepModifiers(normalizedName);
                const rerankResult = simpleRerank(rerankQuery, rerankCandidates, aiNutritionEstimate, trimmed, isBrandedQuery, brandDetection.matchedBrand ?? undefined);
                
                // simpleRerank returns the fully sorted list based on semantic score, nutrition ties, and FDC preferencing
                const sortedFallbackCandidates = rerankResult.sortedCandidates.map(
                    rerankCand => searchFilterResult.filtered.find(c => c.id === rerankCand.id)!
                ).filter(Boolean);

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

            // Attempt AI Nutrition Backfill if all API pipeline candidates failed hydration
            if (AI_NUTRITION_BACKFILL_ENABLED) {
                logger.info('mapping.pipeline_failed_attempting_ai_backfill', { rawLine: trimmed });
                const baseFoodContext = extractBaseFoodContext(allCandidates);
                const aiResult = await requestAiNutrition(normalizedName, {
                    rawLine: trimmed,
                    baseFoodContext,
                    isBatchMode: true,
                });

                if (aiResult.status === 'success') {
                    const parsedQty = parsed ? parsed.qty * parsed.multiplier : 1;
                    const parsedUnit = parsed?.unit || 'serving';

                    const servingResult = await getAiServingGrams(
                        aiResult.foodId,
                        parsedUnit,
                        parsedQty,
                    );

                    const grams = servingResult?.grams ?? 100;
                    const scale = grams / 100;

                    const aiMapped: FatsecretMappedIngredient = {
                        source: 'ai_generated',
                        foodId: aiResult.foodId,
                        foodName: aiResult.displayName,
                        brandName: null,
                        servingId: null,
                        servingDescription: servingResult?.servingLabel ?? `${parsedQty} ${parsedUnit}`,
                        grams,
                        kcal: aiResult.caloriesPer100g * scale,
                        protein: aiResult.proteinPer100g * scale,
                        carbs: aiResult.carbsPer100g * scale,
                        fat: aiResult.fatPer100g * scale,
                        confidence: aiResult.confidence * 0.8,
                        quality: aiResult.confidence >= 0.7 ? 'medium' : 'low',
                        rawLine,
                    };

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
                                foodId: aiResult.foodId,
                                foodName: aiResult.displayName,
                                brandName: '',
                                confidence: aiMapped.confidence,
                                selectionReason: aiResult.cached ? 'ai_nutrition_cache_hit' : 'ai_nutrition_generated',
                            },
                            selectedNutrition: {
                                calories: aiMapped.kcal,
                                protein: aiMapped.protein,
                                carbs: aiMapped.carbs,
                                fat: aiMapped.fat,
                                perGrams: aiMapped.grams,
                            },
                            servingSelection: {
                                servingDescription: aiMapped.servingDescription || 'N/A',
                                grams: aiMapped.grams,
                                backfillUsed: true,
                                backfillType: 'weight',
                            },
                            finalResult: 'success',
                            source: 'full_pipeline',
                            aiCalls: {
                                normalize: {
                                    called: !skippedLlmNormalize,
                                    skipped: skippedLlmNormalize,
                                },
                            },
                        });
                    }

                    logger.info('mapping.ai_nutrition_backfill_success_after_hydration_failure', {
                        rawLine: trimmed,
                        foodName: aiResult.displayName,
                        confidence: aiMapped.confidence,
                        cached: aiResult.cached,
                    });

                    return aiMapped;
                } else {
                    logger.warn('mapping.ai_nutrition_backfill_failed_after_hydration_failure', {
                        rawLine: trimmed,
                        reason: aiResult.reason,
                    });
                }
            }

            return null;
        }

        // Step 6: Save to validated cache if high confidence
        if (confidence >= 0.85) {
            // Use normalizedName (preserves nutritional modifiers like "powdered", "reduced fat")
            // instead of canonicalBase (which collapses variants to a shared base).
            // This prevents cache poisoning where "powdered peanut butter" → "peanut butter" key
            // caused 73+ subsequent "peanut butter" queries to return powdered PB.
            let cacheKey = normalizedName;

            // Brand-Prefixed normalizedForm (Option A)
            // If the query is branded and we have a targetBrand, prefix the cache key
            // with the brand name so that it doesn't overwrite generic cache entries.
            // e.g., "heinz tomato ketchup" instead of "tomato ketchup"
            if (isBrandedQuery && brandDetection.matchedBrand) {
                const brandPrefix = brandDetection.matchedBrand.toLowerCase();
                if (!cacheKey.toLowerCase().includes(brandPrefix)) {
                    cacheKey = `${brandPrefix} ${cacheKey}`;
                }
            }

            await saveValidatedMapping(rawLine, result, {
                approved: true,
                confidence,
                reason: selectionReason,
            }, {
                canonicalBase: cacheKey,  // Use normalizedName as cache key
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
                    canonicalBase: cacheKey,  // Use same cache key for consolidation
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

        // ============================================================
        // FINAL SANITY CHECK: Reject wildly unreasonable computed values
        // ============================================================
        // This catches cases where:
        // 1. User genuinely entered an absurd quantity (e.g., "5000 cups flour")
        // 2. Upstream calculation errors produced unreasonable results
        // 3. Import/OCR artifacts created malformed inputs
        const MAX_REASONABLE_GRAMS = 10000;  // 10kg - more than any typical ingredient
        const MAX_REASONABLE_KCAL = 50000;   // ~20 days of calories - clearly an error

        if (result.grams > MAX_REASONABLE_GRAMS || result.kcal > MAX_REASONABLE_KCAL) {
            logger.warn('mapping.result_sanity_check_failed', {
                rawLine: trimmed,
                grams: result.grams,
                kcal: result.kcal,
                foodName: result.foodName,
                reason: result.grams > MAX_REASONABLE_GRAMS
                    ? 'grams_exceeds_10kg'
                    : 'kcal_exceeds_50000',
            });

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
                        foodId: result.foodId,
                        foodName: result.foodName,
                        brandName: result.brandName || '',
                        confidence,
                        selectionReason,
                    },
                    selectedNutrition: {
                        calories: result.kcal,
                        protein: result.protein,
                        carbs: result.carbs,
                        fat: result.fat,
                        perGrams: result.grams,
                    },
                    finalResult: 'failed',
                    failureReason: `sanity_check_failed: grams=${result.grams.toFixed(0)}, kcal=${result.kcal.toFixed(0)}`,
                });
            }

            return null;  // Reject the mapping - better to fail than return garbage
        }

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

export async function hydrateAndSelectServing(
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

    // Handle OpenFoodFacts candidates (off_ prefix)
    if (candidate.source === 'openfoodfacts' || candidate.id.startsWith('off_')) {
        return await buildOffResult(candidate, parsed, confidence, rawLine);
    }

    // For cache/fatsecret candidates, get full details with servings
    let details: FatSecretFoodDetails | null = null;

    // Try cache first
    const cached = await getCachedFoodWithRelations(candidate.id);
    if (cached) {
        details = cacheFoodToDetails(cached);

        // Check if cache has incomplete data (no nutrition)
        const hasNutrition = (details as any).nutrientsPer100g && (
            (details as any).nutrientsPer100g.calories !== null ||
            (details as any).nutrientsPer100g.protein !== null
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

        // Extract prep modifier for modifier-aware serving labels
        const hydratePrepModifier = extractPrepModifier(rawLine, parsed?.qualifiers);

        // Try AI backfill for weight-based serving
        const backfillResult = await insertAiServing(candidate.id, 'weight', {
            prepModifier: hydratePrepModifier,
            candidateData: candidate,  // Pass candidate data to avoid DB lookup race condition
        });
        if (backfillResult.success) {
            const refreshed = await getCachedFoodWithRelations(candidate.id);
            if (refreshed) {
                details = cacheFoodToDetails(refreshed);
            }
        }

        // If still no usable servings, try volume backfill
        if (!details || !hasUsableServing(details.servings)) {
            const volumeBackfill = await insertAiServing(candidate.id, 'volume', {
                targetServingUnit: parsed?.unit ?? undefined,
                prepModifier: hydratePrepModifier,
                candidateData: candidate,  // Pass candidate data to avoid DB lookup race condition
            });
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

    // ============================================================
    // UNIT HEURISTIC DEFAULTS (head, bunch, spray, cube)
    // ============================================================
    // For units like "head", "bunch", "spray", "cube" that have no serving equivalent
    // in FatSecret, we intercept before selectServing and return a known weight.
    const UNIT_HEURISTIC_DEFAULTS: Array<{ unit: string; pattern: RegExp; grams: number; notes: string }> = [
        { unit: 'head', pattern: /\bcauliflower\b/i, grams: 600, notes: '1 head cauliflower (USDA)' },
        { unit: 'head', pattern: /\bbroccoli\b/i, grams: 500, notes: '1 head broccoli (USDA)' },
        { unit: 'head', pattern: /\b(iceberg|romaine|butter|boston|bibb)?\s*lettuce\b/i, grams: 600, notes: '1 head lettuce (USDA)' },
        { unit: 'head', pattern: /\bcabbage\b/i, grams: 900, notes: '1 head cabbage (USDA)' },
        { unit: 'head', pattern: /\bgarlic\b/i, grams: 40, notes: '1 head garlic (~12 cloves)' },
        { unit: 'bunch', pattern: /\bbroccoli\b/i, grams: 250, notes: '1 bunch broccoli (est)' },
        { unit: 'bunch', pattern: /\bspinach\b/i, grams: 340, notes: '1 bunch spinach (USDA)' },
        { unit: 'bunch', pattern: /\b(cilantro|coriander)\b/i, grams: 50, notes: '1 bunch cilantro (est)' },
        { unit: 'bunch', pattern: /\bparsley\b/i, grams: 60, notes: '1 bunch parsley (est)' },
        { unit: 'bunch', pattern: /\bkale\b/i, grams: 250, notes: '1 bunch kale (est)' },
        { unit: 'bunch', pattern: /\b(scallion|green\s+onion)s?\b/i, grams: 100, notes: '1 bunch scallions (est)' },
        { unit: 'bunch', pattern: /\bmint\b/i, grams: 30, notes: '1 bunch mint (est)' },
        { unit: 'bunch', pattern: /\bbasil\b/i, grams: 30, notes: '1 bunch basil (est)' },
        { unit: 'bunch', pattern: /\bthyme\b/i, grams: 15, notes: '1 bunch thyme (est)' },
        { unit: 'bunch', pattern: /\brosemary\b/i, grams: 15, notes: '1 bunch rosemary (est)' },
        { unit: 'bunch', pattern: /\boregano\b/i, grams: 15, notes: '1 bunch oregano (est)' },
        { unit: 'spray', pattern: /./i, grams: 0.25, notes: '1 spray (~0.25g)' },
        { unit: 'cube', pattern: /\b(bouillon|stock)\b/i, grams: 3.5, notes: '1 bouillon/stock cube (~3.5g)' },
        { unit: 'cube', pattern: /\bsugar\b/i, grams: 4, notes: '1 sugar cube (~4g)' },
        { unit: 'packet', pattern: /\b(sucralose|stevia|sweetener|splenda|sugar substitute)\b/i, grams: 1, notes: '1 packet sweetener (~1g)' },
        { unit: 'serving', pattern: /\b(sucralose|stevia|sweetener|splenda|sugar substitute)\b/i, grams: 1, notes: '1 serving sweetener (~1g)' },
    ];

    // FIX: Sometimes the parser fails to extract units like "bunch" or "head", leaving them in the name.
    // E.g. "5 mint 1 bunch" => unit: null, name: "mint 1 bunch"
    if (parsed && !parsed.unit && parsed.name) {
        const trailingUnitMatch = parsed.name.match(/\b(bunch|head|stalk)\b/i);
        if (trailingUnitMatch) {
            parsed.unit = trailingUnitMatch[1].toLowerCase();
        }
    }

    if (parsed && parsed.unit) {
        const unitLower = parsed.unit.toLowerCase();
        const nameToCheck = (parsed.name || candidate.name).toLowerCase();
        const heuristicMatch = UNIT_HEURISTIC_DEFAULTS.find(
            d => d.unit === unitLower && d.pattern.test(nameToCheck)
        );
        logger.info('hydrate.checking_unit_heuristics', {
            unitLower,
            nameToCheck,
            isMatch: !!heuristicMatch,
        });

        if (heuristicMatch) {
            const heuristicGrams = heuristicMatch.grams * parsed.qty * parsed.multiplier;
            // Find any serving with gram data to derive macros
            const gramServing = details.servings.find(s =>
                s.metricServingUnit === 'g' ||
                s.measurementDescription?.toLowerCase().includes('gram') ||
                gramsForServing(s) != null
            );

            if (gramServing) {
                const servingGrams = gramsForServing(gramServing) || 100;
                const factor = heuristicGrams / servingGrams;
                return {
                    source: candidate.source === 'cache' ? 'cache' : 'fatsecret',
                    foodId: candidate.id,
                    foodName: candidate.name,
                    brandName: candidate.brandName,
                    servingId: gramServing.id,
                    servingDescription: `${parsed.qty * parsed.multiplier} ${parsed.unit} (${heuristicGrams.toFixed(1)}g, ${heuristicMatch.notes})`,
                    grams: heuristicGrams,
                    kcal: (gramServing.calories || 0) * factor,
                    protein: (gramServing.protein || 0) * factor,
                    carbs: (gramServing.carbohydrate || 0) * factor,
                    fat: (gramServing.fat || 0) * factor,
                    confidence,
                    quality: confidence >= 0.8 ? 'high' : confidence >= 0.6 ? 'medium' : 'low',
                    rawLine,
                };
            }
        }
    }

    // ============================================================
    // DETERMINISTIC COUNT & UNITLESS DEFAULTS (Almonds, Olives, Carrots)
    // ============================================================
    // For small count items, FatSecret often lacks a "1 each" serving and falls
    // back to "1 oz" or "100g", causing 4 almonds to become 4 oz (113g).
    // Try to intercept with deterministic seed data BEFORE we hit the general selection.
    if (parsed && (!parsed.unit || parsed.unit === 'each' || parsed.unit === 'piece')) {
        try {
            const { getDefaultCountServing } = await import('../servings/default-count-grams');
            // 'parsed.name' is more specific than 'candidate.name' but we should check both
            // e.g. parsed.name = "baby carrots", candidate.name = "carrots raw"
            const nameToCheck = parsed.name || candidate.name;
            const countDefault = getDefaultCountServing(nameToCheck, parsed.unit || 'each');
            
            if (countDefault && countDefault.grams > 0) {
                // If we found a known per-piece weight from seed data!
                // Create a dummy serving since we'll override baseGrams anyway.
                // We just need macros from any defined serving.
                const gramServing = details.servings.find(s =>
                    s.metricServingUnit === 'g' ||
                    s.measurementDescription?.toLowerCase().includes('gram') ||
                    gramsForServing(s) != null
                ) || details.servings[0];

                if (gramServing) {
                    const totalGrams = countDefault.grams * parsed.qty * parsed.multiplier;
                    const factor = totalGrams / (gramsForServing(gramServing) || 100);

                    logger.info('hydrate.deterministic_count_intercept', {
                        foodId: candidate.id,
                        foodName: candidate.name,
                        parsedName: nameToCheck,
                        perPieceGrams: countDefault.grams,
                        totalGrams
                    });

                    return {
                        source: candidate.source === 'cache' ? 'cache' : 'fatsecret',
                        foodId: candidate.id,
                        foodName: candidate.name,
                        brandName: candidate.brandName,
                        servingId: gramServing.id,
                        servingDescription: `${parsed.qty * parsed.multiplier} ${parsed.unit || 'each'} (${totalGrams.toFixed(1)}g)`,
                        grams: totalGrams,
                        kcal: (gramServing.calories || 0) * factor,
                        protein: (gramServing.protein || 0) * factor,
                        carbs: (gramServing.carbohydrate || 0) * factor,
                        fat: (gramServing.fat || 0) * factor,
                        confidence,
                        quality: confidence >= 0.8 ? 'high' : confidence >= 0.6 ? 'medium' : 'low',
                        rawLine,
                    };
                }
            }
        } catch (err) {
            // Ignore error and fall through
        }
    }

    // Select best serving
    let servingResult = selectServing(parsed, details.servings, candidate.name);

    // SANITY CHECK (Fix 82, Mar 2026): For UNITLESS ingredients, selectServing() may return
    // a fallback "medium" serving from FatSecret with an implausibly large weight.
    // E.g., "1 jalapeno pepper" → FatSecret "medium (4-1/8" long)" = 164g, but USDA = 14g.
    // When the per-unit weight is unreasonably large for produce, discard the result so the
    // code falls through to the unitless AI estimation path.
    if (servingResult && parsed && !parsed.unit) {
        const SMALL_PRODUCE = /\b(jalape[nñ]o|serrano|habanero|thai chili|cayenne|chipotle|poblano|anaheim|shallot|radish|clove|garlic|ginger|lime|lemon|kumquat|fig|date|olive|cherry|grape|plum|apricot|prune|scallion|green onion|chili pepper|chile pepper)\b/i;
        const unitlessPUG = servingResult.gramsPerUnit ?? servingResult.baseGrams;
        const isSmall = SMALL_PRODUCE.test(candidate.name) || SMALL_PRODUCE.test(parsed.name || '');
        const maxGrams = isSmall ? 100 : 500;

        if (unitlessPUG && unitlessPUG > maxGrams) {
            logger.info('hydrate.unitless_serving_sanity_failed', {
                foodId: candidate.id,
                foodName: candidate.name,
                parsedName: parsed.name,
                perUnitGrams: unitlessPUG,
                maxGrams,
                isSmall,
                matchedServing: servingResult.serving.measurementDescription || servingResult.serving.description,
                reason: 'FatSecret serving weight implausibly large for produce, falling through to AI estimation',
            });
            servingResult = null;
        }
    }

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
                    servingResult = selectServing(parsed, details.servings, candidate.name);

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
    // EXCEPTION: If the ingredient name contains "mini", use 'small' with a 0.8x reduction
    const hasMiniModifier = parsed?.name?.toLowerCase().includes('mini');
    const targetSizeUnit = hasMiniModifier ? 'small' : 'medium';

    if (!servingResult && parsed && !parsed.unit) {
        logger.info('hydrate.attempting_unitless_backfill', {
            foodId: candidate.id,
            ingredientName: parsed.name,
            targetSizeUnit,
        });

        // For unitless produce, request a 'medium' or 'small' serving
        const backfillRes = await backfillOnDemand(
            candidate.id,
            'count',
            targetSizeUnit  // 'small' for mini, 'medium' otherwise
        );

        if (backfillRes.success) {
            const freshData = await getCachedFoodWithRelations(candidate.id);
            if (freshData) {
                details = cacheFoodToDetails(freshData);
                servingResult = selectServing(parsed, details.servings, candidate.name);

                if (servingResult) {
                    // SANITY CHECK (Fix 82, Mar 2026): FatSecret "medium" servings for produce
                    // can be wildly wrong for unitless ingredients. E.g., jalapeño "medium" = 164g
                    // vs USDA = 14g. When per-unit weight is implausibly large, discard the
                    // serving result and fall through to AI estimation instead.
                    const SMALL_PRODUCE = /\b(jalape[nñ]o|serrano|habanero|thai chili|cayenne|chipotle|poblano|anaheim|shallot|radish|clove|garlic|ginger|lime|lemon|kumquat|fig|date|olive|cherry|grape|plum|apricot|prune|scallion|green onion)\b/i;
                    const unitlessPerUnitGrams = servingResult.gramsPerUnit ?? servingResult.baseGrams;
                    const isSmallProduceItem = SMALL_PRODUCE.test(candidate.name) || SMALL_PRODUCE.test(parsed.name || '');
                    const maxReasonableUnitlessGrams = isSmallProduceItem ? 100 : 500;

                    if (unitlessPerUnitGrams && unitlessPerUnitGrams > maxReasonableUnitlessGrams) {
                        logger.info('hydrate.unitless_sanity_check_failed', {
                            foodId: candidate.id,
                            foodName: candidate.name,
                            perUnitGrams: unitlessPerUnitGrams,
                            maxReasonableUnitlessGrams,
                            isSmallProduceItem,
                            matchedServing: servingResult.serving.measurementDescription || servingResult.serving.description,
                            reason: 'FatSecret serving weight implausibly large, falling through to AI estimation',
                        });
                        servingResult = null; // Discard — will trigger AI estimation at L2015
                    } else {
                        logger.info('hydrate.unitless_backfill_success', {
                            foodId: candidate.id,
                            serving: servingResult.serving.measurementDescription || servingResult.serving.description
                        });
                    }
                }
            }
        } else {
            logger.warn('hydrate.unitless_backfill_failed', {
                foodId: candidate.id,
                reason: backfillRes.reason
            });
        }

        // If still no serving result for unitless produce, use AI to estimate "1 {size} {food}" weight
        // This handles FDC entries that don't have medium/whole servings
        if (!servingResult && parsed) {
            logger.info('hydrate.attempting_unitless_ai_estimate', {
                foodId: candidate.id,
                foodName: candidate.name,
                targetSizeUnit,
            });

            const ambiguousResult = await getOrCreateAmbiguousServing(
                candidate.id,
                candidate.name,
                targetSizeUnit,  // 'small' for mini, 'medium' otherwise
                candidate.brandName
            );

            if (ambiguousResult.status === 'success' || ambiguousResult.status === 'cached') {
                let estimatedGrams = ambiguousResult.grams!;

                // SANITY CHECK (Fix 82, Mar 2026): The cached/estimated weight may be
                // implausibly large for small produce. E.g., jalapeño "medium" cached at 164g
                // (from a stale FatSecret serving) vs USDA ~14g. When implausible, delete the
                // stale cache entry and re-estimate with a fresh AI call.
                const SMALL_PRODUCE_SANITY = /\b(jalape[nñ]o|serrano|habanero|thai chili|cayenne|chipotle|poblano|anaheim|shallot|radish|clove|garlic|ginger|lime|lemon|kumquat|fig|date|olive|cherry|grape|plum|apricot|prune|scallion|green onion|chili pepper|chile pepper)\b/i;
                const isSmallProduceAI = SMALL_PRODUCE_SANITY.test(candidate.name) || SMALL_PRODUCE_SANITY.test(parsed.name || '');
                const maxAIGrams = isSmallProduceAI ? 100 : 500;

                if (estimatedGrams > maxAIGrams) {
                    logger.info('hydrate.unitless_ai_sanity_failed', {
                        foodId: candidate.id,
                        foodName: candidate.name,
                        estimatedGrams,
                        maxAIGrams,
                        isSmallProduceAI,
                        cacheStatus: ambiguousResult.status,
                        reason: 'Cached/estimated weight implausibly large, deleting stale cache and skipping',
                    });

                    // Delete the stale cached AI entry so next run gets a fresh estimate
                    try {
                        const { prisma: prismaDb } = await import('../db');
                        const staleId = `ai_${candidate.id}_${targetSizeUnit}`;
                        await prismaDb.fatSecretServingCache.deleteMany({
                            where: { id: staleId },
                        });
                        logger.info('hydrate.stale_ai_cache_deleted', { id: staleId });
                    } catch (e) {
                        // Ignore delete errors
                    }

                    // Don't use this result — fall through without setting servingResult
                } else {
                    // For "mini" modifier, reduce below "small" weight (mini ≈ 80% of small)
                    if (hasMiniModifier) {
                        estimatedGrams = Math.round(estimatedGrams * 0.8);
                        logger.info('hydrate.mini_modifier_applied', {
                            foodName: candidate.name,
                            smallGrams: ambiguousResult.grams,
                            miniGrams: estimatedGrams,
                        });
                    }
                    const qty = parsed.qty * parsed.multiplier;
                    const totalGrams = estimatedGrams * qty;

                    // Create a dummy serving if the item lacks servings entirely
                    const dummyServing = {
                        servingId: 0,
                        servingDescription: 'Fallback Serving',
                        metricServingUnit: 'g',
                        metricServingAmount: estimatedGrams,
                        numberOfUnits: 1,
                        measurementDescription: parsed.unit || 'serving',
                        calories: ((details as any).nutrientsPer100g?.calories || 0) * (estimatedGrams / 100),
                        carbohydrate: ((details as any).nutrientsPer100g?.carbohydrate || 0) * (estimatedGrams / 100),
                        protein: ((details as any).nutrientsPer100g?.protein || 0) * (estimatedGrams / 100),
                        fat: ((details as any).nutrientsPer100g?.fat || 0) * (estimatedGrams / 100),
                    } as any;

                    // Find ANY gram-based serving to calculate nutrition
                    const gramServing = details.servings?.find(s =>
                        s.metricServingUnit === 'g' ||
                        s.measurementDescription?.toLowerCase().includes('gram') ||
                        gramsForServing(s) != null
                    ) || details.servings?.[0] || dummyServing;

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
                }
            } else {
                logger.warn('hydrate.unitless_ai_estimate_failed', {
                    foodId: candidate.id,
                    error: ambiguousResult.error,
                });
            }
        }
    }

    const isStandardVolumeUnit = ['cup', 'cups', 'c', 'tbsp', 'tablespoon', 'tablespoons', 'tbs', 'tsp', 'teaspoon', 'teaspoons', 'floz', 'fl oz', 'fluid ounce', 'ml'].includes(parsed?.unit?.toLowerCase() || '');

    // If selection failed and unit is AMBIGUOUS or a STANDARD VOLUME that failed, try AI estimation
    if (!servingResult && parsed?.unit && (isAmbiguousUnit(parsed.unit) || isStandardVolumeUnit)) {
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

            // Create a dummy serving if the item lacks servings entirely
            const dummyServing = {
                servingId: 0,
                servingDescription: 'Fallback Serving',
                metricServingUnit: 'g',
                metricServingAmount: estimatedGrams,
                numberOfUnits: 1,
                measurementDescription: parsed.unit || 'serving',
                calories: ((details as any).nutrientsPer100g?.calories || 0) * (estimatedGrams / 100),
                carbohydrate: ((details as any).nutrientsPer100g?.carbohydrate || 0) * (estimatedGrams / 100),
                protein: ((details as any).nutrientsPer100g?.protein || 0) * (estimatedGrams / 100),
                fat: ((details as any).nutrientsPer100g?.fat || 0) * (estimatedGrams / 100),
            } as any;

            // Find ANY gram-based serving to calculate nutrition
            const gramServing = details.servings?.find(s =>
                s.metricServingUnit === 'g' ||
                s.measurementDescription?.toLowerCase().includes('gram') ||
                gramsForServing(s) != null
            ) || details.servings?.[0] || dummyServing;

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

    // ============================================================
    // COUNT-UNIT SANITY CHECK (Fix: bouillon cubes, sugar cubes, etc.)
    // ============================================================
    // When serving selection succeeds for a count unit but the per-unit weight
    // is implausibly large (e.g., 100g per bouillon cube), attempt on-demand
    // AI backfill to get a realistic estimate. This mirrors the fix in
    // map-ingredient.ts (known-issues line 172-179) which wasn't ported here.
    const MAX_REASONABLE_COUNT_GRAMS = 50; // No discrete "cube/piece" should be >50g
    if (servingResult && parsed?.unit && classifyUnit(parsed.unit) === 'count') {
        const countGramsPerUnit = servingResult.gramsPerUnit ?? servingResult.baseGrams;
        if (countGramsPerUnit && countGramsPerUnit > MAX_REASONABLE_COUNT_GRAMS) {
            logger.info('hydrate.count_unit_sanity_check', {
                foodId: candidate.id,
                foodName: candidate.name,
                unit: parsed.unit,
                gramsPerUnit: countGramsPerUnit,
                maxReasonable: MAX_REASONABLE_COUNT_GRAMS,
                reason: 'Per-unit weight implausibly large for count unit, attempting AI backfill',
            });

            // Attempt AI backfill for a realistic per-unit weight
            const countBackfill = await backfillOnDemand(
                candidate.id,
                'count',
                parsed.unit
            );

            if (countBackfill.success) {
                // Refresh servings and re-select
                const freshData = await getCachedFoodWithRelations(candidate.id);
                if (freshData) {
                    details = cacheFoodToDetails(freshData);
                    const newResult = selectServing(parsed, details.servings, candidate.name);
                    if (newResult) {
                        const newGpu = newResult.gramsPerUnit ?? newResult.baseGrams;
                        if (newGpu && newGpu <= MAX_REASONABLE_COUNT_GRAMS) {
                            servingResult = newResult;
                            logger.info('hydrate.count_unit_backfill_success', {
                                foodId: candidate.id,
                                unit: parsed.unit,
                                oldGramsPerUnit: countGramsPerUnit,
                                newGramsPerUnit: newGpu,
                            });
                        } else {
                            logger.warn('hydrate.count_unit_backfill_still_large', {
                                foodId: candidate.id,
                                newGramsPerUnit: newGpu,
                            });
                            // Keep original servingResult — AI couldn't provide better
                        }
                    }
                }
            } else {
                logger.warn('hydrate.count_unit_backfill_failed', {
                    foodId: candidate.id,
                    unit: parsed.unit,
                    reason: countBackfill.reason,
                });
                // Keep original servingResult — graceful degradation
            }
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
    if (!macros && (targetGrams || baseGrams) && (details as any).nutrientsPer100g) {
        const finalGrams = targetGrams || (baseGrams! * qty);
        const factor = finalGrams / 100;
        const nutrients = (details as any).nutrientsPer100g;
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

    let overrideServingDescription: string | null = null;

    // Calculate final grams for the result
    let finalGrams = targetGrams || ((unitGrams || gramsForServing(serving, candidate.name) || 100) * qty);

    // === BARE QUERY INFLATION GUARD ===
    // If the user didn't specify an amount or unit (e.g. "Baking Flour", "Mayonnaise"),
    // FatSecret often defaults to the full package size (454g flour, 340g mayo).
    // This intercepts bare queries and caps them to single standard servings.
    // Also handles high-count discrete items like "8 lettuce" defaulting to leaves instead of heads.
    if (parsed && !parsed.unit && !targetGrams) {
        console.log("=== BARE QUERY GUARD: ENTERED ===", parsed.qty, finalGrams);
        try {
            const { getBareQueryDefault, getDiscreteLeafyGreenDefault } = await import('../ai/ambiguous-serving-estimator');
            
            let bareDefault = null;
            let overrideGrams = 0;

            if (parsed.qty === 1) {
                bareDefault = getBareQueryDefault(parsed.name || candidate.name);
                if (bareDefault) overrideGrams = bareDefault.grams;
            } else if (parsed.qty > 3) {
                bareDefault = getDiscreteLeafyGreenDefault(parsed.name || candidate.name, parsed.qty);
                if (bareDefault) overrideGrams = bareDefault.grams * parsed.qty;
            }
            console.log("=== BARE QUERY GUARD: RESULTS ===", bareDefault, overrideGrams, finalGrams);

            if (bareDefault && overrideGrams > 0 && finalGrams > overrideGrams * 2) { // Only override if it's significantly inflating
                logger.info('hydrate.bare_query_inflation_capped', {
                    foodName: candidate.name,
                    oldGrams: finalGrams,
                    newGrams: overrideGrams,
                    description: bareDefault.description,
                });
                
                const gramsRatio = overrideGrams / finalGrams;
                macros.kcal *= gramsRatio;
                macros.protein *= gramsRatio;
                macros.carbs *= gramsRatio;
                macros.fat *= gramsRatio;
                finalGrams = overrideGrams;
                
                // Update the serving description to reflect the assumption
                overrideServingDescription = parsed.qty === 1 ? bareDefault.description : `${parsed.qty} × ${bareDefault.description}`;
            }
        } catch (err) {
            logger.error('hydrate.bare_query_guard_failed', { error: err instanceof Error ? err.message : String(err) });
        }
    }

    // === UNIVERSAL PER-UNIT WEIGHT SANITY GUARD ===
    // Catches implausible per-unit weights from ALL sources (FatSecret native, FDC, AI-generated,
    // default 100g serving). E.g., "4 spray cooking spray" = 4 × 100g = 400g is clearly wrong.
    // Also handles "1 serving 1 packet" where parse unit is "serving" but name has "packet".
    if (qty > 0 && !targetGrams) {
        const UNIT_MAX_GRAMS_PER_UNIT: Record<string, number> = {
            // Micro-units: should NEVER exceed a few grams each
            spray: 2, sprays: 2, squirt: 5, squirts: 5,
            dash: 1, dashes: 1, pinch: 0.5, pinches: 0.5,
            // True micro-volume units (drops of hot sauce, liquid stevia, etc.)
            drop: 0.5, drops: 0.5,
            // Cooking spray duration (0.4 second ≈ 0.25g oil)
            second: 1, seconds: 1,
            // Packet-like units: sweetener packets = 1g, sauce packets ≤ 10g
            packet: 10, packets: 10,
            // Scoops: protein powder scoops are 30-35g max
            scoop: 50, scoops: 50,
        };
        
        // Find the most restrictive applicable cap by checking both unit and name
        const tokensToScan = [
            ...(parsed?.unit ? [parsed.unit.toLowerCase()] : []),
            ...(parsed?.name ? parsed.name.toLowerCase().split(/\s+/) : [])
        ];
        
        let maxPerUnit: number | undefined;
        let matchedCapUnit: string | undefined;
        
        for (const token of tokensToScan) {
            const cap = UNIT_MAX_GRAMS_PER_UNIT[token];
            if (cap && (maxPerUnit === undefined || cap < maxPerUnit)) {
                maxPerUnit = cap;
                matchedCapUnit = token;
            }
        }

        if (maxPerUnit) {
            const perUnitGrams = finalGrams / qty;
            if (perUnitGrams > maxPerUnit) {
                const cappedTotal = maxPerUnit * qty;
                logger.warn('hydrate.unit_weight_sanity_capped', {
                    foodId: candidate.id,
                    foodName: candidate.name,
                    matchedCapUnit,
                    qty,
                    originalPerUnit: perUnitGrams,
                    cappedPerUnit: maxPerUnit,
                    originalTotal: finalGrams,
                    cappedTotal,
                });
                // Scale macros proportionally
                const gramsRatio = cappedTotal / finalGrams;
                macros.kcal *= gramsRatio;
                macros.protein *= gramsRatio;
                macros.carbs *= gramsRatio;
                macros.fat *= gramsRatio;
                finalGrams = cappedTotal;
            }
        }
    }

    // === MINI MODIFIER OVERRIDE ===
    // When the ingredient name contains "mini" (e.g., "1 mini avocado") and the serving
    // selection returned a standard-size weight (e.g., 201g for a medium avocado),
    // override with the "small" weight × 0.8 from deterministic seed data.
    if (hasMiniModifier && !targetGrams && !parsed?.unit) {
        try {
            const { getDefaultCountServing } = await import('../servings/default-count-grams');
            // Strip "mini" from the name to match the base food (e.g., "mini avocado" → "avocado")
            const baseFoodName = (parsed?.name || candidate.name)
                .replace(/\bmini\b/i, '')
                .replace(/\s+/g, ' ')
                .trim();
            const smallDefault = getDefaultCountServing(baseFoodName, 'each', 'small');
            if (smallDefault) {
                const miniGrams = Math.round(smallDefault.grams * 0.8);
                const newTotal = miniGrams * qty;
                logger.info('hydrate.mini_override_applied', {
                    foodName: candidate.name,
                    parsedName: parsed?.name,
                    baseFoodName,
                    oldGrams: finalGrams,
                    smallGrams: smallDefault.grams,
                    miniGrams,
                    newTotal,
                });
                // Scale macros proportionally to the weight reduction
                const gramsRatio = newTotal / finalGrams;
                macros.kcal *= gramsRatio;
                macros.protein *= gramsRatio;
                macros.carbs *= gramsRatio;
                macros.fat *= gramsRatio;
                finalGrams = newTotal;
            }
        } catch (err) {
            // If lookup fails, keep the original finalGrams
        }
    }

    // === OIL VOLUME OVERRIDE ===
    // FDC contains bad data for some branded oils (e.g. Spectrum Avocado Oil) where 1 tbsp = 7.5g.
    // Pure oil is ~14g per tbsp (~120 kcal) universally. 
    // If we're mapping an oil with a volume unit and the weight is significantly off, fix it.
    const isOil = (parsed?.name?.toLowerCase().trim().endsWith(' oil') || candidate.name.toLowerCase().trim().endsWith(' oil'));
    if (isOil && (parsed?.unit === 'tbsp' || parsed?.unit === 'tsp' || parsed?.unit === 'cup') && !targetGrams) {
        let expectedGramsPerUnit = 0;
        if (parsed.unit === 'tbsp') expectedGramsPerUnit = 14;
        else if (parsed.unit === 'tsp') expectedGramsPerUnit = 4.5;
        else if (parsed.unit === 'cup') expectedGramsPerUnit = 224; // 14g * 16 tbsp
        
        const expectedTotal = Math.round(expectedGramsPerUnit * qty * 10) / 10;
        
        // If the matched serving is suspiciously light (less than 75% of expected weight)
        if (expectedTotal > 0 && finalGrams < expectedTotal * 0.85) {
            logger.info('hydrate.oil_weight_override_applied', {
                foodName: candidate.name,
                parsedUnit: parsed.unit,
                oldGrams: finalGrams,
                newTotal: expectedTotal,
            });
            const gramsRatio = expectedTotal / (finalGrams || 1);
            macros.kcal *= gramsRatio;
            macros.protein *= gramsRatio;
            macros.carbs *= gramsRatio;
            macros.fat *= gramsRatio;
            finalGrams = expectedTotal;
        }
    }


    // === SANITY CHECK: Unitless high-count items ===
    // When no unit is specified and qty > 3, the serving resolution may have selected
    // a whole-fruit "medium" serving (e.g., 336g for mango) and multiplied by qty,
    // giving absurd totals like "14 mango chunks" → 4704g.
    // For high-count unitless items with suspiciously high grams, estimate per-piece weight.
    const MAX_UNITLESS_TOTAL_GRAMS = 500;
    if (!parsed?.unit && qty > 3 && finalGrams > MAX_UNITLESS_TOTAL_GRAMS && !targetGrams) {
        let corrected = false;

        // 0. Try direct count-default lookup by food name
        // e.g., "25 grape tomatoes" → grape tomato seed data = 5g each → 125g total
        // This catches small count items that have their own seed data entries
        try {
            const { getDefaultCountServing } = await import('../servings/default-count-grams');
            const itemName = parsed?.name || candidate.name;
            const countDefault = getDefaultCountServing(itemName, 'each');
            if (countDefault && countDefault.grams * qty < finalGrams * 0.5) {
                // Seed data gives a much smaller per-unit weight than what we computed
                const newGrams = qty * countDefault.grams;
                logger.info('hydrate.count_default_correction', {
                    foodName: candidate.name,
                    itemName,
                    perUnit: countDefault.grams,
                    oldGrams: finalGrams,
                    newGrams,
                    qty,
                });
                const gramsRatio = newGrams / finalGrams;
                macros.kcal *= gramsRatio;
                macros.protein *= gramsRatio;
                macros.carbs *= gramsRatio;
                macros.fat *= gramsRatio;
                finalGrams = newGrams;
                corrected = true;
            }
        } catch (err) {
            logger.warn('hydrate.count_default_lookup_error', {
                foodName: candidate.name,
                error: (err as Error).message,
            });
        }

        // 1. Try deterministic sub-piece defaults first (cheaper & more reliable than AI)
        const countUnit = parsed?.unitHint || '';
        if (countUnit) {
            try {
                const { getSubPieceDefault } = await import('../servings/default-count-grams');
                const cleanItemName = (parsed?.name || candidate.name)
                    .replace(/\b(chunks?|pieces?|slices?|bites?|wedges?|strips?|segments?)\b/gi, '')
                    .trim();
                const subPieceDefault = getSubPieceDefault(
                    cleanItemName || candidate.name,
                    countUnit
                );
                if (subPieceDefault) {
                    const newGrams = qty * subPieceDefault.grams;
                    logger.info('hydrate.sub_piece_default_applied', {
                        foodName: candidate.name,
                        itemName: cleanItemName,
                        unitHint: countUnit,
                        perPiece: subPieceDefault.grams,
                        oldGrams: finalGrams,
                        newGrams,
                        qty,
                    });
                    const gramsRatio = newGrams / finalGrams;
                    macros.kcal *= gramsRatio;
                    macros.protein *= gramsRatio;
                    macros.carbs *= gramsRatio;
                    macros.fat *= gramsRatio;
                    finalGrams = newGrams;
                    corrected = true;
                }
            } catch (err) {
                logger.warn('hydrate.sub_piece_default_error', {
                    foodName: candidate.name,
                    error: (err as Error).message,
                });
            }
        }

        // 2. Fall back to AI estimation if no sub-piece default available
        if (!corrected) {
            try {
                const { estimateAmbiguousServing } = await import('../ai/ambiguous-serving-estimator');
                const itemName = parsed?.name || candidate.name;
                // Use unitHint (e.g., "chunk") for more accurate AI estimation
                // "1 chunk of mango" (~12g) vs "1 piece of mango" (336g, whole fruit)
                const aiCountUnit = countUnit || 'piece';
                // Strip count words from the name so AI sees "mango" not "mango chunks"
                const cleanItemName = itemName.replace(/\b(chunks?|pieces?|slices?)\b/gi, '').trim();
                const pieceResult = await estimateAmbiguousServing({
                    foodName: cleanItemName || itemName,
                    brandName: candidate.brandName,
                    unit: aiCountUnit,
                });

                if (pieceResult.status === 'success' && pieceResult.estimatedGrams && pieceResult.estimatedGrams > 0) {
                    const perPiece = pieceResult.estimatedGrams;
                    const newGrams = qty * perPiece;
                    logger.info('hydrate.unitless_high_count_correction', {
                        foodName: candidate.name,
                        itemName,
                        oldGrams: finalGrams,
                        perPiece,
                        newGrams,
                        qty,
                    });
                    // Recalculate macros proportionally
                    const gramsRatio = newGrams / finalGrams;
                    macros.kcal *= gramsRatio;
                    macros.protein *= gramsRatio;
                    macros.carbs *= gramsRatio;
                    macros.fat *= gramsRatio;
                    finalGrams = newGrams;
                }
            } catch (err) {
                logger.warn('hydrate.unitless_high_count_error', {
                    foodName: candidate.name,
                    error: (err as Error).message,
                });
            }
        }
    }

    // Determine the correct serving description
    // For ambiguous unit fallbacks, use the parsed unit with gram weight (e.g., "package (227g)")
    // instead of the anchor serving's description (e.g., "cup")
    let finalServingDescription = overrideServingDescription || serving.measurementDescription || serving.description;
    if (!overrideServingDescription && servingResult.matchType === 'fallback' && parsed?.unit && servingResult.gramsPerUnit) {
        finalServingDescription = `${parsed.unit} (${Math.round(servingResult.gramsPerUnit)}g)`;
    }

    // Annotate food name for ground meat (so users see lean % when they just typed "ground beef")
    // Annotate food name for ground meat (so users see lean % when they just typed "ground beef")
    const queryForAnnotation = parsed?.name?.toLowerCase() || rawLine.toLowerCase();
    const annotatedFoodName = annotateGroundMeatName(candidate.name, queryForAnnotation);

    // LATE BINDING: Run hasCriticalModifierMismatch again now that we have FULL MACROS
    // This catches FatSecret "Fat Free X" products that tricked the early name-based filter
    // but actually have > 2g fat per 100g once their serving macros are fetched.
    if (finalGrams > 0 && typeof macros.fat === 'number') {
        const computedFatPer100g = (macros.fat / finalGrams) * 100;
        if (hasCriticalModifierMismatch(rawLine, candidate.name, 'fatsecret', { 
            fat: computedFatPer100g, 
            per100g: true 
        })) {
            logger.warn('hydrate.late_critical_modifier_mismatch_rejected', {
                rawLine,
                foodName: candidate.name,
                fatPer100g: computedFatPer100g,
            });
            return null; // Force pipeline to reject this hydrated candidate!
        }
    }

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
    let unit = parsed?.unit?.toLowerCase();

    // FIX: Sometimes the parser fails to extract units like "bunch" or "head", leaving them in the name.
    if (parsed && !unit && parsed.name) {
        const trailingUnitMatch = parsed.name.match(/\b(bunch|head|stalk)\b/i);
        if (trailingUnitMatch) {
            unit = trailingUnitMatch[1].toLowerCase();
        }
    }

    if (unit) {
        const UNIT_HEURISTIC_DEFAULTS = [
            { unit: 'head', pattern: /\bcauliflower\b/i, grams: 600, notes: '1 head cauliflower (USDA)' },
            { unit: 'head', pattern: /\bbroccoli\b/i, grams: 500, notes: '1 head broccoli (USDA)' },
            { unit: 'head', pattern: /\b(iceberg|romaine|butter|boston|bibb)?\s*lettuce\b/i, grams: 600, notes: '1 head lettuce (USDA)' },
            { unit: 'head', pattern: /\bcabbage\b/i, grams: 900, notes: '1 head cabbage (USDA)' },
            { unit: 'head', pattern: /\bgarlic\b/i, grams: 40, notes: '1 head garlic (~12 cloves)' },
            { unit: 'bunch', pattern: /\bbroccoli\b/i, grams: 250, notes: '1 bunch broccoli (est)' },
            { unit: 'bunch', pattern: /\bspinach\b/i, grams: 340, notes: '1 bunch spinach (USDA)' },
            { unit: 'bunch', pattern: /\b(cilantro|coriander)\b/i, grams: 50, notes: '1 bunch cilantro (est)' },
            { unit: 'bunch', pattern: /\bparsley\b/i, grams: 60, notes: '1 bunch parsley (est)' },
            { unit: 'bunch', pattern: /\bkale\b/i, grams: 250, notes: '1 bunch kale (est)' },
            { unit: 'bunch', pattern: /\b(scallion|green\s+onion)s?\b/i, grams: 100, notes: '1 bunch scallions (est)' },
            { unit: 'bunch', pattern: /\bmint\b/i, grams: 30, notes: '1 bunch mint (est)' },
            { unit: 'bunch', pattern: /\bbasil\b/i, grams: 30, notes: '1 bunch basil (est)' },
            { unit: 'bunch', pattern: /\bthyme\b/i, grams: 15, notes: '1 bunch thyme (est)' },
            { unit: 'bunch', pattern: /\brosemary\b/i, grams: 15, notes: '1 bunch rosemary (est)' },
            { unit: 'bunch', pattern: /\boregano\b/i, grams: 15, notes: '1 bunch oregano (est)' },
            { unit: 'spray', pattern: /./i, grams: 0.25, notes: '1 spray (~0.25g)' },
            { unit: 'cube', pattern: /\b(bouillon|stock)\b/i, grams: 3.5, notes: '1 bouillon/stock cube (~3.5g)' },
            { unit: 'cube', pattern: /\bsugar\b/i, grams: 4, notes: '1 sugar cube (~4g)' },
        ];

        const nameToCheck = (parsed?.name || candidate.name).toLowerCase();
        const heuristicMatch = UNIT_HEURISTIC_DEFAULTS.find(
            d => d.unit === unit && d.pattern.test(nameToCheck)
        );

        if (heuristicMatch) {
            const grams = heuristicMatch.grams * qty;
            const factor = grams / 100;
            return {
                source: candidate.source === 'cache' ? 'cache' : 'fdc',
                foodId: candidate.id,
                foodName: candidate.name,
                brandName: candidate.brandName || null,
                servingId: candidate.id + "_heuristic",
                servingDescription: `${qty} ${unit} (${grams.toFixed(1)}g, ${heuristicMatch.notes})`,
                grams: grams,
                kcal: (candidate.nutrition.kcal || 0) * factor,
                protein: (candidate.nutrition.protein || 0) * factor,
                carbs: (candidate.nutrition.carbs || 0) * factor,
                fat: (candidate.nutrition.fat || 0) * factor,
                confidence,
                quality: confidence >= 0.8 ? 'high' : confidence >= 0.6 ? 'medium' : 'low',
                rawLine,
            };
        }
    }

    // Handle weight units - convert qty in that unit to grams
    const weightToGrams: Record<string, number> = {
        'g': 1, 'gram': 1, 'grams': 1,
        'oz': 28.35, 'ounce': 28.35, 'ounces': 28.35,
        'lb': 453.6, 'lbs': 453.6, 'pound': 453.6, 'pounds': 453.6,
        'kg': 1000, 'kilogram': 1000,
    };

    // Handle volume units - estimate grams based on typical density
    // Note: This is an approximation. Actual density varies by food.
    const isLiquid = /broth|stock|water|juice|milk|sauce|vinegar|oil|syrup/i.test(candidate.name) || /broth|stock|water|juice|milk|sauce|vinegar|oil|syrup/i.test(parsed?.name || '');
    
    const volumeToGrams: Record<string, number> = {
        'cup': isLiquid ? 240 : 120,      // 1 cup ≈ 240ml ≈ 240g for liquids, 120g for granular solids
        'tbsp': isLiquid ? 15 : 7.5,     // 1 tbsp ≈ 15ml ≈ 15g for liquids, 7.5g for solids
        'tablespoon': isLiquid ? 15 : 7.5, 'tablespoons': isLiquid ? 15 : 7.5,
        'tsp': isLiquid ? 5 : 2.5,      // 1 tsp ≈ 5ml ≈ 5g for liquids, 2.5g for solids
        'teaspoon': isLiquid ? 5 : 2.5, 'teaspoons': isLiquid ? 5 : 2.5,
        'ml': 1,         // 1 ml ≈ 1g (for water-like liquids)
        'floz': 30,      // 1 fl oz ≈ 30ml
        // Micro-volume units (spice measures)
        'dash': 0.6,     // 1 dash ≈ 1/8 tsp ≈ 0.6ml ≈ 0.5-0.6g
        'dashes': 0.6,
        'pinch': 0.3,    // 1 pinch ≈ 1/16 tsp ≈ 0.3g
        'pinches': 0.3,
        'sprinkle': 0.2, // ~1/25 tsp
        'shake': 0.2,
        // True micro-volume units (e.g., drops of hot sauce, liquid stevia)
        'drop': 0.05,    // 1 drop ≈ 0.05ml ≈ 0.05g water-density liquid
        'drops': 0.05,
        // Cooking spray duration (s) — 1 second of spray ≈ 0.25g oil
        'second': 0.25,
        'seconds': 0.25,
    };

    let grams: number = 100 * qty;
    let servingDescription: string = `${grams.toFixed(1)}g`;

    if (unit && weightToGrams[unit]) {
        // Unit is a weight unit - convert qty to grams
        // e.g., "16 oz" → 16 * 28.35 = 453.6g
        grams = qty * weightToGrams[unit];
        servingDescription = `${grams.toFixed(1)}g`;
    } else if (unit && volumeToGrams[unit]) {
        // Unit is a volume unit - try AI estimation first for food-specific density
        const fdcId = parseInt(candidate.id.replace('fdc_', ''), 10);
        let aiEstimated = false;

        if (!isNaN(fdcId)) {
            try {
                const { insertFdcAiServing } = await import('../usda/fdc-ai-backfill');
                const aiResult = await insertFdcAiServing(fdcId, 'volume', { targetUnit: unit });
                if (aiResult.success) {
                    // Fetch the AI-created serving from cache
                    const { prisma: prismaDb } = await import('../db');
                    const aiServing = await prismaDb.fdcServingCache.findFirst({
                        where: { fdcId, isAiEstimated: true },
                        orderBy: { id: 'desc' },
                    });
                    if (aiServing && aiServing.grams > 0) {
                        grams = qty * aiServing.grams;
                        servingDescription = `${qty} ${unit}`;
                        aiEstimated = true;
                        logger.info('fdc.volume_ai_estimated', {
                            foodName: candidate.name, unit, gramsPerUnit: aiServing.grams, totalGrams: grams,
                        });
                    }
                }
            } catch (err) {
                logger.warn('fdc.volume_ai_failed', { foodName: candidate.name, unit, error: (err as Error).message });
            }
        }

        if (!aiEstimated) {
            // Fallback to hardcoded density estimate
            grams = qty * volumeToGrams[unit];
            servingDescription = `${qty} ${unit}`;
            logger.info('fdc.volume_hardcoded_fallback', {
                foodName: candidate.name, unit, gramsPerUnit: volumeToGrams[unit], totalGrams: grams,
            });
        }
    } else if (isSizeQualifier(unit)) {
        // Unit is a size qualifier (small/medium/large)
        // Get AI-estimated weight for this size, caching for future use
        const fdcId = parseInt(candidate.id.replace('fdc_', ''), 10);
        const sizes = await getOrCreateFdcSizeServings(fdcId, candidate.name);

        if (sizes) {
            const gramsPerUnit = unit ? sizes[unit] : undefined;
            grams = qty * (gramsPerUnit ?? 100);
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
    } else if (!unit || ['slice', 'slices', 'piece', 'pieces', 'chunk', 'chunks', 'wedge', 'wedges', 'strip', 'strips', 'segment', 'segments'].includes(unit)) {
        // UNITLESS items or COUNT items (pieces/slices) — two cases:
        //   LOW COUNT (qty <= 3 AND strictly unitless):  "1 cucumber", "2 avocados" → estimate "medium" weight
        //   HIGH COUNT / COUNT UNITS: "4 slice ham", "25 grape tomatoes", "14 mango chunks" → estimate per-PIECE weight
        //
        // Fix 49 (Feb 2026): The "medium" estimation was giving ~182g for "grape raw tomatoes"
        // (a regular tomato size), causing 25 × 182 = 4550g. For high-count items, we need
        // per-individual-item weight, not per-medium-serving weight.
        const fdcId = parseInt(candidate.id.replace('fdc_', ''), 10);
        const isExplicitCountUnit = !!unit;

        if (qty > 3 || isExplicitCountUnit) {
            // HIGH COUNT: user is counting individual items ("25 grape tomatoes")
            // Use per-piece estimation with the PARSED name for specificity
            // (parsed.name = "grape tomatoes" is more specific than candidate.name = "grape raw tomatoes")
            const itemName = parsed?.name || candidate.name;
            let resolved = false;

            // 1. Try deterministic sub-piece defaults first (cheaper & more reliable than AI)
            const unitHint = parsed?.unitHint || '';
            if (unitHint) {
                try {
                    const { getSubPieceDefault } = await import('../servings/default-count-grams');
                    const cleanItemName = itemName
                        .replace(/\b(chunks?|pieces?|slices?|bites?|wedges?|strips?|segments?)\b/gi, '')
                        .trim();
                    const subPieceDefault = getSubPieceDefault(
                        cleanItemName || candidate.name,
                        unitHint || unit || ''
                    );
                    if (subPieceDefault) {
                        grams = qty * subPieceDefault.grams;
                        servingDescription = `${qty} ${unitHint}s (${subPieceDefault.grams}g each)`;
                        resolved = true;
                        logger.info('fdc.sub_piece_default_applied', {
                            foodName: candidate.name,
                            parsedName: cleanItemName,
                            unitHint,
                            perPiece: subPieceDefault.grams,
                            qty,
                            totalGrams: grams,
                        });
                    }
                } catch (err) {
                    logger.warn('fdc.sub_piece_default_error', {
                        foodName: candidate.name,
                        error: (err as Error).message,
                    });
                }
            }

            // 2. Fall back to AI per-piece estimation
            if (!resolved) {
                try {
                    const { estimateAmbiguousServing } = await import('../ai/ambiguous-serving-estimator');
                    const cleanItemName = itemName.replace(/\b(chunks?|pieces?|slices?)\b/gi, '').trim();
                    const aiCountUnit = unitHint || unit || 'piece';
                    const pieceResult = await estimateAmbiguousServing({
                        foodName: cleanItemName || itemName,
                        brandName: candidate.brandName,
                        unit: aiCountUnit,  // E.g. "What does 1 slice of {itemName} weigh?"
                    });

                    if (pieceResult.status === 'success' && pieceResult.estimatedGrams && pieceResult.estimatedGrams > 0) {
                        const gramsPerPiece = pieceResult.estimatedGrams;
                        grams = qty * gramsPerPiece;
                        servingDescription = `${qty} pieces (${gramsPerPiece}g each)`;
                        resolved = true;
                        logger.info('fdc.unitless_piece_resolved', {
                            foodName: candidate.name,
                            parsedName: itemName,
                            gramsPerPiece,
                            qty,
                            totalGrams: grams,
                            confidence: pieceResult.confidence,
                        });
                    }
                } catch (err) {
                    logger.warn('fdc.unitless_piece_failed', {
                        foodName: candidate.name,
                        error: (err as Error).message,
                    });
                }
            }

            if (!resolved) {
                // Fallback: try medium estimation (may overestimate for small items)
                // CRITICAL: Skip medium estimation for branded goods (like "Pancake Mix" or "Protein Powder")
                const sizes = !candidate.brandName ? await getOrCreateFdcSizeServings(fdcId, candidate.name) : null;
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
                    grams = 100 * qty;
                    servingDescription = `${grams.toFixed(1)}g`;
                    logger.warn('fdc.unitless_fallback', {
                        foodName: candidate.name,
                        fallbackGrams: grams,
                    });
                }
            }
        } else {
            // LOW COUNT: "1 cucumber", "2 avocados" → "medium" estimation
            const sizes = await getOrCreateFdcSizeServings(fdcId, candidate.name);

            // Apply mini override identical to hydrateAndSelectServing
            const hasMiniModifier = parsed?.name?.toLowerCase().includes('mini');
            const targetSize = hasMiniModifier ? 'small' : 'medium';

            if (sizes && sizes[targetSize]) {
                const baseGramsPerUnit = sizes[targetSize]!;
                // For "mini" modifier, reduce below "small" weight (mini ≈ 80% of small)
                const gramsPerUnit = hasMiniModifier ? Math.round(baseGramsPerUnit * 0.8) : baseGramsPerUnit;
                
                grams = qty * gramsPerUnit;
                servingDescription = `${qty} ${hasMiniModifier ? 'mini' : targetSize} (${gramsPerUnit}g each)`;
                logger.info('fdc.unitless_size_resolved', {
                    foodName: candidate.name,
                    sizeUsed: targetSize,
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
        }
    } else if (unit && (isAmbiguousUnit(unit) || ['cup', 'cups', 'c', 'tbsp', 'tablespoon', 'tablespoons', 'tbs', 'tsp', 'teaspoon', 'teaspoons', 'floz', 'fl oz', 'fluid ounce', 'ml'].includes(unit.toLowerCase()))) {
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

    // === BARE QUERY INFLATION GUARD (FDC) ===
    if (parsed && !parsed.unit && parsed.qty === 1) {
        try {
            const { getBareQueryDefault } = await import('../ai/ambiguous-serving-estimator');
            const bareDefault = getBareQueryDefault(parsed.name || candidate.name);
            if (bareDefault && grams > bareDefault.grams * 2) {
                logger.info('fdc.bare_query_inflation_capped', {
                    foodName: candidate.name,
                    oldGrams: grams,
                    newGrams: bareDefault.grams,
                    description: bareDefault.description,
                });
                grams = bareDefault.grams;
                servingDescription = bareDefault.description;
            }
        } catch (err) {
            // Ignore
        }
    }

    // === UNIVERSAL PER-UNIT WEIGHT SANITY GUARD (FDC) ===
    if (qty > 0) {
        const UNIT_MAX_GRAMS_PER_UNIT: Record<string, number> = {
            spray: 2, sprays: 2, squirt: 5, squirts: 5,
            dash: 1, dashes: 1, pinch: 0.5, pinches: 0.5,
            drop: 0.5, drops: 0.5,
            second: 1, seconds: 1,
            packet: 10, packets: 10,
            scoop: 50, scoops: 50,
        };
        const tokensToScan = [
            ...(parsed?.unit ? [parsed.unit.toLowerCase()] : []),
            ...(parsed?.name ? parsed.name.toLowerCase().split(/\s+/) : [])
        ];
        let maxPerUnit: number | undefined;
        let matchedCapUnit: string | undefined;
        for (const token of tokensToScan) {
            const cap = UNIT_MAX_GRAMS_PER_UNIT[token];
            if (cap && (maxPerUnit === undefined || cap < maxPerUnit)) {
                maxPerUnit = cap; matchedCapUnit = token;
            }
        }
        if (maxPerUnit) {
            const perUnitGrams = grams / qty;
            if (perUnitGrams > maxPerUnit) {
                const cappedTotal = maxPerUnit * qty;
                logger.warn('fdc.unit_weight_sanity_capped', {
                    foodId: candidate.id, foodName: candidate.name, matchedCapUnit, qty,
                    originalPerUnit: perUnitGrams, cappedPerUnit: maxPerUnit,
                    originalTotal: grams, cappedTotal,
                });
                grams = cappedTotal;
            }
        }
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
// OpenFoodFacts Result Builder
// ============================================================

/**
 * Build a FatsecretMappedIngredient from an OpenFoodFacts candidate.
 * Hydrates the candidate into the local DB, resolves grams from the parsed unit,
 * and falls back to AI nutrition backfill when the Atwater gate rejects label data.
 */
async function buildOffResult(
    candidate: UnifiedCandidate,
    parsed: ParsedIngredient | null,
    confidence: number,
    rawLine: string
): Promise<FatsecretMappedIngredient | null> {
    // 1. Hydrate into local DB
    let hydrated;
    try {
        hydrated = await hydrateOffCandidate(candidate);
    } catch (err) {
        logger.warn('off.build_result.hydrate_failed', {
            foodId: candidate.id,
            error: (err as Error).message,
        });
        return null;
    }

    const qty = parsed ? parsed.qty * parsed.multiplier : 1;
    const unit = parsed?.unit?.toLowerCase();

    // 2. Resolve serving grams
    const weightToGrams: Record<string, number> = {
        'g': 1, 'gram': 1, 'grams': 1,
        'oz': 28.35, 'ounce': 28.35, 'ounces': 28.35,
        'lb': 453.6, 'lbs': 453.6, 'pound': 453.6, 'pounds': 453.6,
        'kg': 1000, 'kilogram': 1000,
    };
    const isLiquid = /broth|stock|water|juice|milk|sauce|vinegar|oil|syrup/i.test(candidate.name);
    const volumeToGrams: Record<string, number> = {
        'cup': isLiquid ? 240 : 120, 'cups': isLiquid ? 240 : 120,
        'tbsp': isLiquid ? 15 : 7.5, 'tablespoon': isLiquid ? 15 : 7.5, 'tablespoons': isLiquid ? 15 : 7.5,
        'tsp': isLiquid ? 5 : 2.5,  'teaspoon': isLiquid ? 5 : 2.5,  'teaspoons': isLiquid ? 5 : 2.5,
        'ml': 1, 'floz': 30, 'fl oz': 30,
        'dash': 0.6, 'dashes': 0.6, 'pinch': 0.3, 'pinches': 0.3,
    };

    let grams: number;
    let servingDescription: string;

    if (unit && weightToGrams[unit]) {
        grams = qty * weightToGrams[unit];
        servingDescription = `${grams.toFixed(1)}g`;
    } else if (unit && volumeToGrams[unit]) {
        grams = qty * volumeToGrams[unit];
        servingDescription = `${qty} ${unit}`;
    } else if (hydrated.servingGrams && hydrated.servingGrams > 0) {
        grams = qty * hydrated.servingGrams;
        servingDescription = `${qty} serving (${hydrated.servingGrams}g each)`;
    } else {
        grams = 100 * qty;
        servingDescription = `${grams.toFixed(1)}g`;
    }

    const factor = grams / 100;
    const n = hydrated.nutrientsPer100g;

    // 3. Direct nutrients (passed Atwater gate)
    if (n && n['calories'] != null) {
        return {
            source: 'openfoodfacts',
            foodId: candidate.id,
            foodName: hydrated.foodName,
            brandName: hydrated.brandName,
            servingId: null,
            servingDescription,
            grams,
            kcal:    (n['calories'] || 0) * factor,
            protein: (n['protein']  || 0) * factor,
            carbs:   (n['carbs']    || 0) * factor,
            fat:     (n['fat']      || 0) * factor,
            confidence,
            quality: confidence >= 0.8 ? 'high' : confidence >= 0.6 ? 'medium' : 'low',
            rawLine,
        };
    }

    // 4. AI nutrition backfill (Atwater gate rejected label data)
    if (!AI_NUTRITION_BACKFILL_ENABLED) {
        logger.warn('off.build_result.no_nutrients_no_backfill', { foodId: candidate.id });
        return null;
    }

    const aiNutrition = await requestAiNutrition(hydrated.foodName, { rawLine });
    if (aiNutrition.status !== 'success') {
        logger.warn('off.build_result.ai_nutrition_failed', {
            foodId: candidate.id,
            reason: aiNutrition.reason,
        });
        return null;
    }

    return {
        source: 'openfoodfacts',
        foodId: candidate.id,
        foodName: hydrated.foodName,
        brandName: hydrated.brandName,
        servingId: null,
        servingDescription,
        grams,
        kcal:    aiNutrition.caloriesPer100g * factor,
        protein: aiNutrition.proteinPer100g  * factor,
        carbs:   aiNutrition.carbsPer100g    * factor,
        fat:     aiNutrition.fatPer100g      * factor,
        confidence: confidence * aiNutrition.confidence,
        quality: 'low',
        rawLine,
    };
}

// ============================================================
// Serving Selection (simplified from map-ingredient.ts)
// ============================================================

function selectServing(
    parsed: ParsedIngredient | null,
    servings: FatSecretServing[],
    foodName?: string  // Optional food name for discrete item detection
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
    const { isDiscreteItem } = require('./serving-backfill');
    let unitRaw = parsed?.unit?.toLowerCase() ?? null;
    const isCountLikely = !unitRaw && parsed?.qty && Number.isInteger(parsed.qty);
    const unit = unitRaw || (isCountLikely && foodName && isDiscreteItem(foodName) ? 'piece' : null);

    // AMBIGUOUS UNITS: Skip normal serving selection and force AI backfill
    // Units like "packet", "container", "scoop", "medium" get wildly incorrect grams
    // from API-provided servings (e.g., "1 packet" matching to "serving = 100g").
    // These require AI estimation to get accurate weights.
    if (unit && isAmbiguousUnit(unit)) {
        // EXCEPTION: For size qualifiers (small/medium/large), first check if
        // an existing serving already contains that size with valid grams.
        // e.g., "medium (4-1/8" long)" with 15g should be used instead of AI.
        const SIZE_QUALIFIERS = ['mini', 'small', 'medium', 'large'];
        if (SIZE_QUALIFIERS.includes(unit)) {
            const matchingServing = servings.find(s => {
                const desc = (s.measurementDescription || s.description || '').toLowerCase();
                const g = gramsForServing(s);
                // Must contain the size qualifier and have valid grams
                return desc.includes(unit) && g != null && g > 0;
            });

            if (matchingServing) {
                const grams = gramsForServing(matchingServing)!;
                const servingDesc = (matchingServing.measurementDescription || matchingServing.description || '').toLowerCase();

                // Extract count from serving description (e.g., "10 large" → 10, "10 medium" → 10)
                // This is critical because FatSecret often doesn't set numberOfUnits correctly
                // for count-based servings, causing double-multiplication bugs
                const countMatch = servingDesc.match(/^(\d+)\s+(mini|small|medium|large|extra\s*large)/i);
                let unitsPerServing = matchingServing.numberOfUnits && matchingServing.numberOfUnits > 0
                    ? matchingServing.numberOfUnits : 1;

                if (countMatch) {
                    const extractedCount = parseInt(countMatch[1], 10);
                    if (extractedCount > 0) {
                        unitsPerServing = extractedCount;
                        logger.debug('selectServing.extracted_count_from_desc', {
                            servingDesc,
                            extractedCount,
                            originalNumberOfUnits: matchingServing.numberOfUnits,
                        });
                    }
                }

                const perUnitGrams = grams / unitsPerServing;

                // SANITY CHECK (Batch 5, Mar 2026): FatSecret "medium" servings for produce
                // can be wildly wrong. E.g., jalapeño "medium (4-1/8\" long)" = 164g, but
                // USDA says a medium jalapeño = 14g. When the per-unit weight seems implausible,
                // skip the FatSecret serving and fall through to AI estimation instead.
                // Heuristic: small produce items (peppers, herbs, small fruits) should be <100g
                // for "medium"; most produce should be <500g for "medium".
                const SMALL_PRODUCE = /\b(jalape[nñ]o|serrano|habanero|thai chili|cayenne|chipotle|poblano|anaheim|shallot|radish|clove|garlic|ginger|lime|lemon|kumquat|fig|date|olive|cherry|grape|plum|apricot|prune|scallion|green onion)\b/i;
                const foodNameForCheck = foodName || parsed?.name || '';
                const isSmallProduce = SMALL_PRODUCE.test(foodNameForCheck);
                const maxReasonableGrams = isSmallProduce ? 100 : 500;

                if (perUnitGrams > maxReasonableGrams) {
                    logger.info('selectServing.size_qualifier_sanity_failed', {
                        unit,
                        foodName: foodNameForCheck,
                        matchedServing: servingDesc,
                        perUnitGrams,
                        maxReasonableGrams,
                        isSmallProduce,
                        reason: 'FatSecret serving weight implausibly large, falling through to AI estimation',
                    });
                    // Fall through to AI backfill instead of trusting FatSecret's data
                } else {
                    logger.debug('selectServing.size_qualifier_from_existing', {
                        unit,
                        matchedServing: matchingServing.measurementDescription || matchingServing.description,
                        grams,
                        unitsPerServing,
                    });

                    return {
                        serving: matchingServing,
                        matchScore: 3.0,
                        gramsPerUnit: perUnitGrams,
                        unitsPerServing,
                        baseGrams: perUnitGrams,
                        matchType: 'exact' as const,
                    };
                }
            }
        }

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
        // Herb/produce count units (singular ↔ plural aliasing)
        'sprig': ['sprig', 'sprigs'],
        'stalk': ['stalk', 'stalks'],
        'clove': ['clove', 'cloves'],
        'leaf': ['leaf', 'leaves'],
        'floret': ['floret', 'florets'],
        'wedge': ['wedge', 'wedges'],
        'strip': ['strip', 'strips'],
        'chunk': ['chunk', 'chunks'],
        'head': ['head', 'heads'],
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
    const extractServingVolumeUnit = (description: string, serving?: FatSecretServing): { unit: string; amount: number } | null => {
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

        // Handle servings that are just the unit without number prefix (e.g., "ml", "tbsp")
        // Use numberOfUnits from serving object or volumeMl for ml amount
        const standaloneVolumeUnits = ['ml', 'cup', 'cups', 'tbsp', 'tablespoon', 'tsp', 'teaspoon', 'floz', 'fl oz'];
        const descTrimmed = desc.trim();
        for (const volUnit of standaloneVolumeUnits) {
            if (descTrimmed === volUnit || descTrimmed === volUnit + 's') {
                const canonical = getCanonicalVolumeUnit(volUnit);
                if (canonical) {
                    // Use volumeMl if available (for ml servings), otherwise numberOfUnits
                    let amount = 1;
                    if (serving) {
                        if (canonical === 'ml' && (serving as any).volumeMl && (serving as any).volumeMl > 0) {
                            amount = (serving as any).volumeMl;
                        } else if (serving.numberOfUnits && serving.numberOfUnits > 0) {
                            amount = serving.numberOfUnits;
                        }
                    }
                    return { unit: canonical, amount };
                }
            }
        }

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

        // === BARE QUERY (UNITLESS) HEURISTIC ===
        // When no unit is specified (e.g. "Pancake Mix"), we want to avoid picking
        // full package volumes like "1 box (425g)" and prefer "1 serving" or "100g".
        if (requestedUnitType === 'unknown' && !effectiveUnit) {
            if (/\b(box|package|bag|container|bottle|jar|tub|can|carton)\b/i.test(description)) {
                score -= 5; // Heavy penalty for full retail packages
            }
            if (isGenericServing(description) || description === 'g' || description === '100g' || description === 'oz') {
                score += 2; // Bonus for generic baseline servings
            }
            if (/\b(1\s*serving|serving)\b/i.test(description)) {
                score += 1; // Extra bonus for an explicit "1 serving"
            }
        }

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
            let servingVolume = extractServingVolumeUnit(description, serving);

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

        // Non-matching serving (can only be used as fallback for explicit mass units or unknown units WITH a specific string)
        // DO NOT allow unitless queries (!effectiveUnit) to use generic fallbacks here,
        // because they must fall through to the dedicated unitless handling logic below.
        if (requestedUnitType === 'mass' || (requestedUnitType === 'unknown' && effectiveUnit)) {
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
    } else if (fallbackMatch) {
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
            const unitLower = effectiveUnit?.toLowerCase() || '';
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
        // No unit specified - need to determine if this is:
        // A) Produce (use medium/large/small for whole items)
        // B) Discrete countable items like franks, sausages (use default "serving")

        // PRIORITY 0: For discrete countable items, prefer the default "serving"
        // These are items where "medium" means size variation, not a whole item
        // e.g., "2 beef franks" should use 2x "serving" (45g each), not "medium" (140g)
        const defaultServing = servings.find(s => (s as any).isDefault === true);
        const defaultDesc = (defaultServing?.measurementDescription || defaultServing?.description || '').toLowerCase();
        const isSimpleServingDefault = defaultDesc === 'serving' || defaultDesc === '1 serving';

        if (defaultServing && isSimpleServingDefault) {
            const g = gramsForServing(defaultServing);
            if (g != null && g > 0) {
                selected = { serving: defaultServing, score: 1.0, factor: 1 };
                matchType = 'exact';
                logger.debug('selectServing.unitless_default_serving', {
                    description: defaultServing.measurementDescription || defaultServing.description,
                    grams: g,
                });
            }
        }

        // PRIORITY 1: Look for WHOLE-ITEM servings (medium, large, small, whole, fruit)
        // This is for produce like "1 cucumber" → "medium" (~300g)
        // Skip if we already found a good default serving
        // IMPORTANT: Skip for discrete items (franks, sausages) where "medium" means size, not quantity
        const isDiscrete = foodName ? isDiscreteItem(foodName) : false;

        if (!selected && !isDiscrete) {
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
            }

            // FALLBACK: If no standard whole-item pattern matched, try matching by food name
            // e.g., for food "Avocado", the serving "avocado, NS as to Florida or California" (201g)
            // contains the food name and represents a whole item
            if (!selected && foodName) {
                const foodNameLower = foodName.toLowerCase().replace(/\bcubed\b|\bsliced\b|\bchopped\b|\bdiced\b|\bminced\b/g, '').trim();
                const foodNameTokens = foodNameLower.split(/\s+/).filter(w => w.length > 2);
                const mainFoodToken = foodNameTokens[foodNameTokens.length - 1]; // Last word = main food

                if (mainFoodToken) {
                    const foodNameServing = servings.find(s => {
                        const desc = (s.measurementDescription || s.description || '').toLowerCase();
                        const g = gramsForServing(s);
                        if (g == null || g <= 0) return false;
                        // Must contain the food name and be a substantial serving (>50g for produce)
                        return desc.includes(mainFoodToken) && g > 50;
                    });

                    if (foodNameServing) {
                        selected = { serving: foodNameServing, score: 1.0, factor: 1 };
                        matchType = 'same_type';
                        logger.debug('selectServing.unitless_food_name_serving', {
                            description: foodNameServing.measurementDescription || foodNameServing.description,
                            grams: gramsForServing(foodNameServing),
                            matchedToken: mainFoodToken,
                        });
                    }
                }
            }
        }

        // For discrete items without a default serving, use ANY serving with valid grams
        // This ensures "2 beef franks" uses a per-item serving rather than failing
        if (!selected && isDiscrete) {
            const anyServing = servings.find(s => {
                const g = gramsForServing(s);
                return g != null && g > 0;
            });

            if (anyServing) {
                selected = { serving: anyServing, score: 1.0, factor: 1 };
                matchType = 'fallback';
                logger.debug('selectServing.discrete_fallback_serving', {
                    foodName,
                    description: anyServing.measurementDescription || anyServing.description,
                    grams: gramsForServing(anyServing),
                });
            }
        }

        // PRIORITY 2: Look for other count-based servings (clove, piece, slice, etc.)
        // These are for items where partial servings are default (garlic cloves, bread slices)
        // GUARD: Skip partial-count servings for low-qty unitless queries (qty ≤ 3)
        // "1 avocado" should NOT use "slice" (10g), it should trigger AI backfill for whole item
        if (!selected) {
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

    // Extract count embedded in serving description when numberOfUnits is missing/zero.
    // FatSecret frequently omits numberOfUnits for count-based servings (e.g., "5 grape tomatoes = 123g"
    // has numberOfUnits=0), causing Double Multiplier: qty=20 × gramsPerUnit=123 → 2460g instead of 492g.
    // This mirrors the same fix applied above for size_qualifiers (small/medium/large).
    const servingDescForCount = (
        selected.serving.measurementDescription || selected.serving.description || ''
    ).toLowerCase();
    // Match patterns like: "5 grape tomatoes", "3 pieces", "10 crackers", "2 large eggs"
    const embeddedCountMatch = servingDescForCount.match(/^(\d+)\s+\S/);
    let unitsPerServing = selected.serving.numberOfUnits && selected.serving.numberOfUnits > 0
        ? selected.serving.numberOfUnits
        : 1;

    if (embeddedCountMatch && unitsPerServing === 1) {
        const extractedCount = parseInt(embeddedCountMatch[1], 10);
        if (extractedCount > 1) {
            unitsPerServing = extractedCount;
            logger.debug('selectServing.extracted_count_from_desc', {
                servingDesc: servingDescForCount,
                extractedCount,
                originalNumberOfUnits: selected.serving.numberOfUnits,
            });
        }
    }

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
