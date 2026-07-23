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
import { isCorruptExclusionEnabled } from './corrupt-mark';
import { assessSaveTimePlausibility } from './macro-plausibility';
import type { MacroPlausibilityInput, ExpectedNutritionPer100g } from './macro-plausibility';
import { detectBrandInQuery } from './brand-detector';
import { hasDecisiveBrandContext, candidateMatchesTargetBrand } from './simple-rerank';
import { parseIngredientLine } from '../parse/ingredient-line';
import { normalizeIngredientName, canonicalizeCacheKey } from './normalization-rules';

/**
 * Cache read result: the mapped ingredient plus row provenance. `validatedBy`
 * (FoodMapping.validatedBy: 'ai' | 'human-triage') is threaded through reads
 * for the HUMAN_ROW_TRUST read-time trust follow-up — populated here, not yet
 * consumed by any skip logic.
 */
export type CachedMappedIngredient = FatsecretMappedIngredient & {
    validatedBy?: string;
};

/**
 * Read-time trust for human-triage rows (PR D pt3, B6).
 *
 * FoodMapping rows stamped validatedBy='human-triage' are deliberate triage
 * repoints — a person chose the record identity. The NAME-heuristic cache
 * rejections (core-token coverage, NUTRITIONAL_MODIFIERS, cooking-state /
 * critical-modifier) compare query text against the food name and kill
 * legitimate repoints (e.g. a 'mayonnaise' → 'Light Mayonnaise' repoint dies
 * on the 'light' modifier), so trusted human rows skip them. Nutrition-invalid
 * checks and serving-shape escapes (counted-piece, cooked-grain — mapper
 * level) stay active for ALL rows: a human repoint fixes identity, not
 * per-piece/cooked serving shape.
 *
 * Trade-off (accepted, per plan): combined with the save-side write-guard, a
 * WRONG human repoint is sticky — nothing at read or save time evicts it, so
 * the only way out is re-running apply-repoints. No TTL in this PR.
 *
 * Kill-switch: HUMAN_ROW_TRUST === '0' disables trust (default on). Read at
 * call time so the flag can be flipped without a restart of test harnesses.
 */
export function isTrustedHumanRow(validatedBy?: string | null): boolean {
    return validatedBy === 'human-triage' && process.env.HUMAN_ROW_TRUST !== '0';
}

/**
 * Mapper-level cache-escape reasons that read-time trust may skip for
 * human-triage rows — the NAME-heuristic identity checks. core_token_mismatch
 * belongs here: human repoints routinely cross naming conventions (key
 * 'prawns' → FDC "Crustaceans, shrimp, ..."), and the helper-side core-token
 * skip would be moot if the mapper twin still escaped the row. Deliberately
 * excludes corrupt_record, nutrition_invalid, count_label and grain_cooked:
 * those escapes fire for every row regardless of provenance (a repoint fixes
 * identity, not data validity or serving shape).
 */
const HUMAN_TRUST_SKIPPABLE_ESCAPES = new Set([
    'category_mismatch',
    'multi_ingredient',
    'modifier_mismatch',
    'replacement_mismatch',
    'brand_guard',
    'core_token_mismatch',
]);

export function isHumanTrustSkippableEscape(reason: string): boolean {
    return HUMAN_TRUST_SKIPPABLE_ESCAPES.has(reason);
}

/**
 * Retrieve a validated mapping from cache by RAW ingredient line
 * @deprecated Use getValidatedMappingByNormalizedName for new code
 */
export async function getValidatedMapping(
    rawIngredient: string,
    source: 'fatsecret' | 'fdc' = 'fatsecret'
): Promise<CachedMappedIngredient | null> {
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
): Promise<CachedMappedIngredient | null> {
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

        // Read-time trust (PR D pt3, HUMAN_ROW_TRUST): human-triage rows skip
        // the NAME-heuristic rejections below — see isTrustedHumanRow. The
        // first rejection that WOULD have fired is recorded so telemetry can
        // count trust saves.
        const humanRowTrusted = isTrustedHumanRow(cached.validatedBy);
        let trustSkippedRejection: string | null = null;

        // Always check core token coverage (Jan 2026)
        if (hasCoreTokenMismatch(normalizedName, cached.foodName, cached.brandName)) {
            if (!humanRowTrusted) {
                logger.debug('validated_mapping.cache_core_token_mismatch', {
                    query: normalizedName,
                    cachedFood: cached.foodName,
                });
                return null;  // Reject cache hit, force fresh search
            }
            trustSkippedRejection = 'core_token_mismatch';
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
                if (!humanRowTrusted) {
                    logger.debug('validated_mapping.cache_nutritional_modifier_mismatch', {
                        query: normalizedName,
                        cachedFood: cached.foodName,
                        modifier: mod,
                    });
                    return null;  // Reject cache hit, force fresh search
                }
                trustSkippedRejection = trustSkippedRejection ?? `nutritional_modifier:${mod}`;
                break;
            }
        }

        if (rawLine) {
            if (isWrongCookingStateForGrain(rawLine, normalizedName, cached.foodName) ||
                hasCriticalModifierMismatch(rawLine, cached.foodName, 'cache')) {
                if (!humanRowTrusted) {
                    logger.debug('validated_mapping.cache_context_mismatch', {
                        query: normalizedName,
                        rawLine,
                        cachedFood: cached.foodName,
                    });
                    return null;  // Reject cache hit, force fresh search
                }
                trustSkippedRejection = trustSkippedRejection ?? 'context_mismatch';
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

        // Build mapping food ID correctly from FDC ID, OFF barcode, FatSecret
        // food id, or AI generated food
        let foodId = '';
        if (cached.fdcId) {
            foodId = `fdc_${cached.fdcId}`;
        } else if (cached.offBarcode) {
            foodId = `off_${cached.offBarcode}`;
        } else if (cached.fsId) {
            foodId = `fs_${cached.fsId}`;
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

        if (trustSkippedRejection) {
            logger.debug('cache.human_row_trusted', {
                key: cached.normalizedForm,
                foodId,
                skippedRejection: trustSkippedRejection,
            });
        }

        return {
            foodId,
            foodName: cached.foodName,
            brandName: cached.brandName,
            confidence: Math.max(0, Math.min(1, cached.aiConfidence)),
            source: cached.fsId ? 'fatsecret'
                    : cached.source === 'openfoodfacts' ? 'openfoodfacts'
                    : cached.source === 'fdc' ? 'fdc'
                    : 'ai_generated',
            validatedBy: cached.validatedBy,
        } as CachedMappedIngredient;
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

    // Historical quirk: the mapper calls the read path with source='fatsecret'
    // as its catch-all default, which this filter has always remapped to
    // 'ai_generated' rows. Lane-written rows now genuinely carry
    // source='fatsecret', so that call must match BOTH.
    const mappingSources = source === 'fatsecret' ? ['ai_generated', 'fatsecret'] : [source];

    const candidates = await prisma.foodMapping.findMany({
        where: {
            source: { in: mappingSources },
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

    const detectedBrand = detectBrandInQuery(rawIngredient).matchedBrand;

    // Brand-mismatch save gate (PR D pt2, Jul 2026): the parity sweep cached
    // "protein ryse" as "Protein Rice". When the query names a brand
    // decisively (multi-word brand, or brand token adjacent to a product-form
    // word like "protein") and the mapped food carries that brand in neither
    // its brand field nor its name, the identity is wrong — or a generic
    // substitute that shouldn't answer a brand query from cache. Reuses the
    // rerank's decisive-context + whole-token matching so ranking and caching
    // agree on what "named a brand" means. The pick still serves THIS request.
    if (detectedBrand
        && hasDecisiveBrandContext(rawIngredient, detectedBrand)
        && !candidateMatchesTargetBrand(mapping.brandName ?? undefined, mapping.foodName, detectedBrand)) {
        logger.warn('validated_mapping.save_rejected_brand_mismatch', {
            rawIngredient,
            normalizedForm,
            foodName: mapping.foodName,
            brandName: mapping.brandName,
            namedBrand: detectedBrand,
        });
        return;
    }

    // Pre-save validation: Reject mappings where core tokens from normalizedForm are missing from foodName
    if (hasCoreTokenMismatch(normalizedForm, mapping.foodName, mapping.brandName)) {
        // Brand rescue (mirrors the runtime core-token brand rescue): when the
        // query names a brand and the mapped food carries it — in its brand
        // field or embedded in its name — the "missing" core token is usually
        // a flavor the brand spells differently ("cinnamon" vs "Cinnabon").
        // Rejecting the save forces a full re-resolution on every request.
        const rescueBrand = detectedBrand?.toLowerCase().trim();
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
        let fsId: string | null = null;

        if (mapping.foodId.startsWith('fdc_')) {
            fdcId = parseInt(mapping.foodId.replace('fdc_', ''), 10);
        } else if (mapping.foodId.startsWith('off_')) {
            offBarcode = mapping.foodId.replace('off_', '');
        } else if (mapping.foodId.startsWith('fs_')) {
            fsId = mapping.foodId.replace('fs_', '');
        }

        const mappingSource = offBarcode ? 'openfoodfacts' : fdcId ? 'fdc' : fsId ? 'fatsecret' : 'ai_generated';
        const clampedConfidence = Math.max(0, Math.min(1, validation.confidence));

        // Existing-row lookup, hoisted ahead of EVERY upsert (PR D pt3): the
        // human-row write-guard below and the serving-downgrade guard both
        // need the current row, so fetch it once.
        const existing = await prisma.foodMapping.findUnique({
            where: { normalizedForm },
            select: { offBarcode: true, fdcId: true, fsId: true, foodName: true, validatedBy: true },
        });

        // Human-row write-guard (PR D pt3): rows stamped validatedBy=
        // 'human-triage' are triage repoints — a fresh AI resolution must not
        // overwrite their identity, and the update branch's validatedBy:'ai'
        // stamp was exactly the escape→overwrite mechanism that reverted the
        // 2026-07-20 repoints. Same record → bump usage only, PRESERVE the
        // human provenance. Different record → skip the write entirely (the
        // pick still serves THIS request, it just isn't cached). 'ai' rows
        // keep the full supersede-stale semantics of the upsert below.
        if (existing?.validatedBy === 'human-triage') {
            const existingFoodId = existing.offBarcode
                ? `off_${existing.offBarcode}`
                : existing.fdcId != null
                    ? `fdc_${existing.fdcId}`
                    : existing.fsId
                        ? `fs_${existing.fsId}`
                        : null;
            const sameRecord = existingFoodId != null
                ? existingFoodId === mapping.foodId
                // ai_generated rows carry no id columns — match on food name.
                : existing.foodName === mapping.foodName;
            if (sameRecord) {
                await prisma.foodMapping.update({
                    where: { normalizedForm },
                    data: {
                        usedCount: { increment: 1 },
                        lastUsedAt: new Date(),
                    },
                });
                logger.debug('validated_mapping.human_row_usage_bumped', {
                    normalizedForm,
                    foodId: mapping.foodId,
                });
            } else {
                logger.warn('save.skipped_human_row', {
                    rawIngredient,
                    normalizedForm,
                    existingFoodId: existingFoodId ?? existing.foodName,
                    attemptedFoodId: mapping.foodId,
                    attemptedFoodName: mapping.foodName,
                });
            }
            return;
        }

        // Serving-shape downgrade guard (PR D pt2, Jul 2026; extended to the
        // fatsecret lane, Phase 1): the parity sweep showed record swaps
        // silently replacing a cache row whose OFF record carries real serving
        // data ("red bull" with its 250ml can label) with a record that has
        // none — every later serving-billed request then falls to
        // flat_100g_default. When an overwrite would change the target record
        // (OFF barcode or fs id, in either direction), keep the old row if the
        // new record would lose all serving shape. fs picks do NOT bypass the
        // guard: an fs record only counts as having serving shape when it
        // carries a gram-quantified FatSecretServing. The new pick still
        // serves THIS request, it just isn't cached.
        const newTargetKey = offBarcode ? `off:${offBarcode}` : fsId ? `fs:${fsId}` : null;
        const existingTargetKey = existing?.offBarcode
            ? `off:${existing.offBarcode}`
            : existing?.fsId ? `fs:${existing.fsId}` : null;
        if (newTargetKey && existingTargetKey && newTargetKey !== existingTargetKey) {
            const hasServingShape = (f: { servingGrams: number | null; packageQuantity: number | null } | null) =>
                !!f && ((f.servingGrams ?? 0) > 0 || (f.packageQuantity ?? 0) > 0);
            const fsHasServingShape = async (id: string) =>
                !!(await prisma.fatSecretServing.findFirst({
                    where: { fsId: id, grams: { gt: 0 } },
                    select: { id: true },
                }));

            let incumbentShape: boolean;
            let incumbentCorruptReason: string | null = null;
            if (existing!.offBarcode) {
                const oldOff = await prisma.offFood.findUnique({
                    where: { barcode: existing!.offBarcode },
                    select: { servingGrams: true, packageQuantity: true, corruptReason: true },
                });
                incumbentShape = hasServingShape(oldOff);
                incumbentCorruptReason = oldOff?.corruptReason ?? null;
            } else {
                // fs incumbent — no fs corrupt-marking exists in Phase 1.
                incumbentShape = await fsHasServingShape(existing!.fsId!);
            }

            // A corrupt-marked incumbent forfeits the guard: keeping it
            // would zombie the row — every hit escapes ('corrupt_record'),
            // re-resolves, and lands right back here. Serving shape on a
            // corrupt panel is not worth preserving.
            const incumbentCorrupt = incumbentCorruptReason != null && isCorruptExclusionEnabled();
            if (incumbentCorrupt) {
                logger.info('validated_mapping.downgrade_guard_bypassed_corrupt_incumbent', {
                    normalizedForm,
                    keptTarget: newTargetKey,
                    evictedTarget: existingTargetKey,
                    corruptReason: incumbentCorruptReason,
                });
            } else if (incumbentShape) {
                let newShape: boolean;
                if (offBarcode) {
                    const newOff = await prisma.offFood.findUnique({
                        where: { barcode: offBarcode },
                        select: { servingGrams: true, packageQuantity: true },
                    });
                    newShape = hasServingShape(newOff);
                } else {
                    newShape = await fsHasServingShape(fsId!);
                }
                if (!newShape) {
                    logger.warn('validated_mapping.save_rejected_serving_downgrade', {
                        rawIngredient,
                        normalizedForm,
                        foodName: mapping.foodName,
                        keptTarget: existingTargetKey,
                        rejectedTarget: newTargetKey,
                    });
                    return;
                }
            }
        }

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
                fsId,
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
                // offBarcode/fdcId/fsId are ALL written every save (non-matching
                // ids are null), so the target columns stay mutually exclusive.
                foodName: mapping.foodName,
                brandName: mapping.brandName,
                source: mappingSource,
                offBarcode,
                fdcId,
                fsId,
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

