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
import { assessSaveTimePlausibility, isAllZeroMacros } from './macro-plausibility';
import type { MacroPlausibilityInput, ExpectedNutritionPer100g } from './macro-plausibility';
import { detectBrandInQuery } from './brand-detector';
import { markSaveRejected, normalizeClassId, type FunnelSink } from './funnel';
import { hasDecisiveBrandContext, candidateMatchesTargetBrand } from './simple-rerank';
import { parseIngredientLine } from '../parse/ingredient-line';
import { normalizeIngredientName, canonicalizeCacheKey } from './normalization-rules';
import { ensureFatSecretParentPersisted } from './fatsecret-lane';

// Cross-source displacement margin (fs displacement hardening, Jul 2026):
// how much MORE confident a challenger from a different source family
// (off: ↔ fs:) must be than the incumbent's stored aiConfidence to take
// over an existing cache row. Same-family swaps are exempt.
const CROSS_SOURCE_DISPLACEMENT_MARGIN = 0.05;

// Bare-category takeover gate (Jul 2026). See saveValidatedMapping.
// Trivial words dropped before counting query specificity / testing whether a
// food name is a bare category.
const SAVE_GATE_STOPWORDS = new Set([
    'the', 'a', 'an', 'of', 'with', 'and', 'or', 'in', 'on', 'for', 'to',
    'plus', 'jr', 'sr', 'style', 'flavor', 'flavored', 'flavour', 'flavoured',
    'original', 'classic', 'regular',
]);

// Generic food-category nouns. A food name built ENTIRELY of these adds no
// identity beyond the category, so a specific branded query that resolves to
// such a name is a poisoning collapse. Deliberately excludes distinctive
// product names ("mac", "whopper", "baconator") and core single-ingredient
// nouns ("chicken", "beef", "rice") so real SKUs and legitimate generic picks
// from generic queries are never rejected.
const BARE_CATEGORY_WORDS = new Set([
    'cereal', 'burger', 'cheeseburger', 'hamburger', 'sandwich', 'sub', 'wrap',
    'burrito', 'taco', 'pizza', 'nugget', 'nuggets', 'fries', 'soda', 'pop',
    'drink', 'beverage', 'snack', 'candy', 'cookie', 'cookies', 'cracker',
    'crackers', 'chips', 'shake', 'smoothie', 'sauce', 'dressing', 'soup',
    'bacon', 'sausage', 'hotdog', 'breakfast', 'lunch', 'dinner', 'meal',
    'platter', 'combo', 'pie', 'cake', 'muffin', 'donut', 'doughnut', 'roll',
    'bun', 'oatmeal', 'pudding', 'popsicle', 'pretzel', 'dessert',
]);

/**
 * Count the distinctive (specific) tokens in a raw query for the bare-category
 * gate: tokens longer than 2 chars that are not digits, not part of the
 * detected brand, and not trivial stopwords. De-duplicated.
 */
function countSpecificSaveTokens(rawLine: string, detectedBrand: string | null): number {
    const brandTokens = new Set(
        (detectedBrand ?? '').toLowerCase().split(/\s+/).filter(Boolean),
    );
    const tokens = rawLine.toLowerCase().split(/[\s,()[\]{}]+/).filter(Boolean);
    const specific = tokens.filter(t =>
        t.length > 2
        && !/^\d/.test(t)
        && !brandTokens.has(t)
        && !SAVE_GATE_STOPWORDS.has(t),
    );
    return new Set(specific).size;
}

/**
 * True when every significant token of a food name is a generic food-category
 * word — i.e. the name is a bare category ("Cereal", "Bacon Cheeseburger") with
 * no distinctive product/ingredient token.
 */
function isBareCategoryFoodName(foodName: string): boolean {
    const tokens = foodName.toLowerCase()
        .split(/[\s,()[\]{}/-]+/)
        .filter(t => t.length > 0 && !SAVE_GATE_STOPWORDS.has(t));
    if (tokens.length === 0) return false;
    return tokens.every(t => BARE_CATEGORY_WORDS.has(t));
}

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
 * Out-parameter for getValidatedMappingByNormalizedName.
 *
 * The read path has two very different ways to return null: no row existed under
 * this key, or a row existed and the identity checks below REJECTED it. Callers
 * could not tell them apart, so every helper-level rejection was written to
 * MappingEventLog as `cacheHit=NULL, cacheEscape=NULL` — byte-identical to a cold
 * key. That made a real, recurring failure class (a row the pipeline writes and
 * then can never serve, so it re-resolves forever) statistically invisible.
 *
 * Pass an object here to find out which happened: a non-null `reason` after the
 * call means a row was found and rejected. Purely diagnostic — populating it
 * changes no control flow.
 */
export interface CacheLookupRejection {
    /** Rejection class, or null when no row was found at all. */
    reason: string | null;
    /** Key the rejected row was stored under — for key-fork diagnosis. */
    normalizedForm?: string;
    /** Name of the rejected row, so the reason can be read without a second query. */
    foodName?: string;
}

function noteRejection(
    rejection: CacheLookupRejection | undefined,
    reason: string,
    cached: { normalizedForm: string; foodName: string },
): void {
    if (!rejection) return;
    rejection.reason = reason;
    rejection.normalizedForm = cached.normalizedForm;
    rejection.foodName = cached.foodName;
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
 * @param rejection - Optional out-param; receives the reason when a row was found
 *                    and rejected. See CacheLookupRejection.
 */
export async function getValidatedMappingByNormalizedName(
    normalizedName: string,
    source: 'fatsecret' | 'fdc' | 'openfoodfacts' = 'fatsecret',
    rawLine?: string,
    rejection?: CacheLookupRejection
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
                noteRejection(rejection, 'core_token_mismatch', cached);
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
                    noteRejection(rejection, `nutritional_modifier:${mod}`, cached);
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
                    noteRejection(rejection, 'context_mismatch', cached);
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
 * Normalize the AI-derived base into a brand-safe value for the canonicalBase COLUMN.
 * Returns null when there's no base to persist. When the pick carries a brand that the
 * base doesn't already name, the brand is prepended so distinct branded products never
 * collapse to the same canonicalBase (e.g. "tropicana orange juice" vs "simply orange
 * juice"). This is grouping/observability only — it never touches the normalizedForm key.
 */
export function brandSafeCanonicalBase(
    rawBase: string | undefined | null,
    brandName: string | undefined | null,
): string | null {
    const base = rawBase?.toLowerCase().trim().replace(/\s+/g, ' ');
    if (!base) return null;
    const brand = brandName?.toLowerCase().trim().replace(/\s+/g, ' ');
    if (!brand) return base;
    // Already brand-qualified if every brand token is present in the base (whole-token).
    const baseTokens = new Set(base.split(' '));
    const brandTokens = brand.split(' ').filter(Boolean);
    const hasBrand = brandTokens.length > 0 && brandTokens.every((t) => baseTokens.has(t));
    return hasBrand ? base : `${brand} ${base}`;
}

/**
 * THE single answer to "what record does this row point at".
 *
 * One helper, applied to BOTH sides of an overwrite, so the two expressions
 * cannot drift apart — which is precisely what happened: they were written
 * separately and both stopped at `fs:`, so any overwrite with FDC on either
 * side returned null for one key and skipped the whole guarded block (the
 * serving-downgrade guard, the corrupt bypass and the cross-source margin
 * together). Precedence off > fs > fdc matches
 * `getValidatedMappingByNormalizedName()` and the human-row identity branch.
 *
 * Exported for tests. Accepts a partial row: callers pass Prisma selections
 * that may omit columns entirely (undefined), not just null them.
 */
export function targetKeyOf(
    t: { offBarcode?: string | null; fsId?: string | null; fdcId?: number | null } | null | undefined,
): string | null {
    if (!t) return null;
    if (t.offBarcode) return `off:${t.offBarcode}`;
    if (t.fsId) return `fs:${t.fsId}`;
    if (t.fdcId != null) return `fdc:${t.fdcId}`;
    return null;
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
        normalizedForm?: string;  // If provided, uses this; otherwise normalizes rawIngredient
        // The pre-derived LOOKUP KEY basis (historical misnomer — NOT the AI
        // canonical base; that is persistCanonicalBase below). It is the
        // HIGHEST-PRIORITY input to normalizedForm, ahead of both
        // options.normalizedForm and the rawIngredient. Consequence to hold
        // onto: two call sites passing the same canonicalBase target the SAME
        // ROW, whatever rawIngredient they were given. That is exactly how the
        // deleted alias loop overwrote the primary save it had just made.
        canonicalBase?: string;
        // Observability/grouping columns (NEVER affect the lookup key). The AI base
        // (ai-normalize `canonical_base`) + cooking method, persisted as-is for dedup/analytics.
        persistCanonicalBase?: string;   // e.g. "tropicana orange juice" (brand kept), "strawberries"
        persistCookingModifier?: string; // e.g. "grilled", "scrambled"
        nutrientsPer100g?: MacroPlausibilityInput | null;      // Pick's per-100g macros for the save-time gate
        expectedNutrition?: ExpectedNutritionPer100g | null;   // AI normalize estimate to cross-check against
        // Funnel sink (sprint F1): the caller marks the line 'saved' optimistically;
        // whichever gate below blocks the write downgrades it to 'save_rejected'
        // with that gate's class ID. Pass ONLY for the primary save — an alias
        // save being rejected must not relabel the line it was derived from.
        telemetry?: FunnelSink;
        // Funnel fix 4: this pick was admitted BELOW the 0.85 confidence gate,
        // so it may create a cache row but must never overwrite one. See the
        // insert-only guard in the body.
        insertOnly?: boolean;
    }
): Promise<void> {
    // Priority: canonicalBase > normalizedForm > computed from rawIngredient
    const rawForm = options?.canonicalBase || options?.normalizedForm || normalizeQuery(rawIngredient);
    // Canonicalize: lowercase + singularize + sort tokens
    const normalizedForm = canonicalizeCacheKey(rawForm);

    // Brand-safe base identity for the canonicalBase COLUMN (observability only —
    // does not touch normalizedForm). ai-normalize is supposed to keep the brand in
    // canonical_base when is_branded, but guard deterministically: if the pick carries
    // a brand and the base doesn't already name it, prepend it — so two different
    // branded products (e.g. Tropicana vs Simply orange juice) never share a
    // canonicalBase and stay distinct for grouping/dedup.
    const persistedCanonicalBase = brandSafeCanonicalBase(options?.persistCanonicalBase, mapping.brandName);
    const persistedCookingModifier = options?.persistCookingModifier?.trim() || null;

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
        markSaveRejected(options?.telemetry, 'brand_mismatch');
        return;
    }

    // Bare-category takeover save gate (Jul 2026 cache-warming session): a
    // specific branded/multi-token query must not collapse into a bare generic
    // category that carries no brand — "special k red berries" -> "Cereal",
    // "wendys jr bacon cheeseburger" -> "Bacon cheeseburger" poison the generic
    // key so every later request for the plain category answers from a branded
    // save (and vice-versa). Fires only when the query is specific (a brand is
    // named, or it carries >= 3 distinctive tokens) AND the pick carries neither
    // a brand field nor the detected brand in its name AND every significant
    // token of the food name is a generic food-category word. Proper product
    // names survive because they keep a distinctive non-category token
    // ("mcdonalds big mac" -> "Big Mac"; "mac" is not a category word). The pick
    // still serves THIS request, it just isn't cached under the collapsed key.
    const bareBrandCarried = detectedBrand
        ? candidateMatchesTargetBrand(mapping.brandName ?? undefined, mapping.foodName, detectedBrand)
        : false;
    const pickHasBrandField = !!(mapping.brandName && mapping.brandName.trim());
    const specificTokenCount = countSpecificSaveTokens(rawIngredient, detectedBrand);
    if ((!!detectedBrand || specificTokenCount >= 3)
        && !bareBrandCarried
        && !pickHasBrandField
        && isBareCategoryFoodName(mapping.foodName)) {
        logger.warn('validated_mapping.save_rejected_bare_category_takeover', {
            rawIngredient,
            normalizedForm,
            foodName: mapping.foodName,
            brandName: mapping.brandName,
            namedBrand: detectedBrand,
            specificTokenCount,
        });
        markSaveRejected(options?.telemetry, 'bare_category_takeover');
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
            markSaveRejected(options?.telemetry, 'core_token_mismatch');
            return; // Don't save this invalid mapping
        }
        logger.info('validated_mapping.save_core_token_brand_rescued', {
            rawIngredient,
            normalizedForm,
            foodName: mapping.foodName,
            brandName: mapping.brandName,
        });
    }

    // Degenerate-nutrition gate (funnel first read, Jul 2026): a pick whose
    // per-100g macros are ALL zero has no nutrition to give. The plausibility
    // gate below can't catch it — all-zero passes every bounds check (nothing
    // is negative, the macro sum is 0) and Atwater compares 0 against 0 — so
    // such a pick sailed through at confidence 0.95-1.00. FoodMapping stores
    // identity only, so caching one pins the key to a record that hydrates to
    // 0 kcal for every later request, long after this one.
    //
    // Genuinely zero-calorie foods exist (water, black coffee, diet soda), but
    // an all-zero row is far more often a data gap than a real measurement, and
    // declining to CACHE it costs only a repeat lookup — this request is served
    // either way. Water and ice short-circuit at the fast path and never
    // reach a save.
    if (options?.nutrientsPer100g && isAllZeroMacros(options.nutrientsPer100g)) {
        logger.warn('validated_mapping.save_rejected_zero_macros', {
            rawIngredient,
            normalizedForm,
            foodName: mapping.foodName,
            brandName: mapping.brandName,
            foodId: mapping.foodId,
        });
        markSaveRejected(options?.telemetry, 'zero_macros');
        return;
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
            // Fold the first plausibility reason in as the detail suffix —
            // normalizeClassId strips the interpolated measurements that would
            // otherwise make this class ID unique per row.
            markSaveRejected(
                options?.telemetry,
                `implausible_macros:${normalizeClassId(gate.reasons[0], { maxSegments: 2 })}`,
            );
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
            select: { offBarcode: true, fdcId: true, fsId: true, foodName: true, validatedBy: true, aiConfidence: true },
        });

        // Insert-only guard (funnel fix 4). A pick admitted BELOW the 0.85
        // confidence gate may create a cache row but must never overwrite one:
        // something the cascade was 78% sure of has no business evicting a row
        // a more confident pick already earned. This is the whole blast-radius
        // bound on conditional admission — it is why relaxing the gate cannot
        // regress a currently-passing lookup, and it is the guarantee the
        // abandoned PR #143 lacked when it repointed the eight most-used
        // generic keys in the cache.
        if (options?.insertOnly && existing) {
            logger.info('validated_mapping.sub_threshold_no_displace', {
                rawIngredient,
                normalizedForm,
                keptFoodName: existing.foodName,
                rejectedFoodName: mapping.foodName,
            });
            markSaveRejected(options?.telemetry, 'sub_threshold_no_displace');
            return;
        }

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
            markSaveRejected(options?.telemetry, 'human_row');
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
        const newTargetKey = targetKeyOf({ offBarcode, fsId, fdcId });
        const existingTargetKey = targetKeyOf(existing);
        if (newTargetKey && existingTargetKey && newTargetKey !== existingTargetKey) {
            const hasServingShape = (f: { servingGrams: number | null; packageQuantity: number | null } | null) =>
                !!f && ((f.servingGrams ?? 0) > 0 || (f.packageQuantity ?? 0) > 0);
            const fsHasServingShape = async (id: string) =>
                !!(await prisma.fatSecretServing.findFirst({
                    where: { fsId: id, grams: { gt: 0 } },
                    select: { id: true },
                }));

            // Corrupt-incumbent check, HOISTED above the downgrade half so it
            // still gates the margin half below. Load-bearing: the downgrade
            // half now skips whenever either side is `fdc:`, and if this stayed
            // inside it a corrupt-marked OFF incumbent would newly regain full
            // margin protection against an FDC challenger — every hit would
            // escape as 'corrupt_record', re-resolve, and land back at a
            // blocked save. Only OFF rows carry corruptReason (fs/fdc
            // incumbents are never corrupt-marked), so the offFood.findUnique
            // still runs on exactly the same inputs as before the hoist.
            let incumbentOff: { servingGrams: number | null; packageQuantity: number | null; corruptReason: string | null } | null = null;
            let incumbentCorruptReason: string | null = null;
            if (existing!.offBarcode) {
                incumbentOff = await prisma.offFood.findUnique({
                    where: { barcode: existing!.offBarcode },
                    select: { servingGrams: true, packageQuantity: true, corruptReason: true },
                });
                incumbentCorruptReason = incumbentOff?.corruptReason ?? null;
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
            }

            // ASYMMETRY, deliberate: `fdc:` enters the MARGIN half below but
            // NOT this serving-downgrade half. hasServingShape() reads only
            // OffFood.servingGrams/packageQuantity and fsHasServingShape()
            // reads FatSecretServing, so every FDC record evaluates SHAPELESS
            // under both — folding fdc: in unchanged would block every FDC
            // upgrade of a shaped incumbent. (It is also a correctness bug:
            // the incumbent branch's else takes `existing!.fsId!`, which is
            // null for an FDC incumbent.)
            //
            // This is a scope choice, not a data gap. MEASURED 2026-08-01
            // (live DB): FdcServing has a grams>0 row for 3,998 of 4,133
            // FdcFood rows, and for 80 of the 84 live FDC FoodMapping rows —
            // so the follow-up is an fdcHasServingShape() reading FdcServing,
            // not a schema change. FdcFood.servingSize is NOT usable
            // (MEASURED: 0 rows with servingSize > 0).
            const servingShapeComparable =
                !newTargetKey.startsWith('fdc:') && !existingTargetKey.startsWith('fdc:');
            if (servingShapeComparable && !incumbentCorrupt) {
                const incumbentShape = existing!.offBarcode
                    ? hasServingShape(incumbentOff)
                    // fs incumbent — no fs corrupt-marking exists in Phase 1.
                    : await fsHasServingShape(existing!.fsId!);
                if (incumbentShape) {
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
                        markSaveRejected(options?.telemetry, 'serving_downgrade');
                        return;
                    }
                }
            }

            // Cross-source displacement margin (fs displacement hardening,
            // Jul 2026): when the overwrite would move the key to a different
            // source family (off: ↔ fs: ↔ fdc:), the incumbent already passed
            // every save gate at its own save time — displacing an already-good
            // pick with a different corpus's record is only justified when
            // the challenger is meaningfully MORE confident, not merely this
            // run's rerank winner by a hair. Same-family swaps (off:→off:)
            // keep the full supersede-stale semantics, and corrupt incumbents
            // forfeited above.
            //
            // fdc: DOES belong here, unlike the downgrade half: this needs only
            // the two stored aiConfidence values, and FDC rows carry those like
            // any other. Its omission was the measured exposure (2,855 OFF +
            // 570 fs mappings displaceable with no margin at all).
            //
            // Interaction with the alias-loop removal (F1): incumbent
            // confidences are no longer deflated by 0.9 at save time, so a row
            // earned at 0.98 needs 1.03 here — unreachable, i.e. safe — rather
            // than the 0.932 that any exact_match rerank winner cleared.
            const crossSourceFamily =
                newTargetKey.split(':')[0] !== existingTargetKey.split(':')[0];
            if (!incumbentCorrupt && crossSourceFamily) {
                const incumbentConfidence = existing?.aiConfidence ?? 0;
                if (clampedConfidence < incumbentConfidence + CROSS_SOURCE_DISPLACEMENT_MARGIN) {
                    logger.warn('validated_mapping.save_rejected_cross_source_margin', {
                        rawIngredient,
                        normalizedForm,
                        foodName: mapping.foodName,
                        keptTarget: existingTargetKey,
                        rejectedTarget: newTargetKey,
                        incumbentConfidence,
                        challengerConfidence: clampedConfidence,
                    });
                    markSaveRejected(options?.telemetry, 'cross_source_margin');
                    return;
                }
            }
        }

        // FatSecret FK persist race (Jul 2026). FoodMapping.fsId is a foreign
        // key to FatSecretFood.fsId, and the lane writes those parent rows
        // fire-and-forget (fatsecret-lane.ts persistFatSecretHits, registered
        // as a background task). On a food's FIRST-EVER sighting this child
        // write can beat its parent: the upsert then fails the FK, the catch
        // below logs save_error, and the mapping is silently never cached even
        // though the funnel already marked the line 'saved'. Warm batch 01
        // reported 92 saves and wrote 81 rows — 31.4% of its fatsecret saves
        // wrote nothing.
        //
        // Waiting on the ONE in-flight persist that owns this fsId is free
        // when it already drained (a Map lookup, the normal case — the persist
        // starts at retrieval time and rerank + AI validation run after it)
        // and capped when it hasn't.
        //
        // INSERT-BOUND on `existing`: only a save that would CREATE a row
        // waits. When a row is already there the parent is left to the
        // background task exactly as today, so this can never turn a
        // currently-failing overwrite into a successful one. That bound is not
        // cosmetic — 8 of the 67 measured FK failures were update branches
        // against hot validatedBy='ai' incumbents, including the `cooked rice`
        // and `cooked pasta` rows golden cases n-cook-01/n-cook-02 exist to
        // lock and the bare generic key `chicken`. An unbounded version of
        // this fix displaces them.
        if (fsId && !existing) {
            // Also persists the winner outright when the runners-up cap deferred it —
            // waiting alone is no longer sufficient now that the lane does not write
            // every hit.
            await ensureFatSecretParentPersisted(fsId);
        }

        await prisma.foodMapping.upsert({
            where: {
                normalizedForm,
            },
            create: {
                normalizedForm,
                foodName: mapping.foodName,
                brandName: mapping.brandName,
                canonicalBase: persistedCanonicalBase,
                cookingModifier: persistedCookingModifier,
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
                // Only overwrite the base/modifier when THIS save actually derived one
                // (e.g. the LLM-skipped cached-normalize path may lack a brand-safe base) —
                // otherwise leave a previously populated value intact.
                ...(persistedCanonicalBase ? { canonicalBase: persistedCanonicalBase } : {}),
                ...(persistedCookingModifier ? { cookingModifier: persistedCookingModifier } : {}),
            },
        });

        logger.info('validated_mapping.saved', {
            rawIngredient,
            normalizedForm,
            foodName: mapping.foodName,
            aiConfidence: clampedConfidence,
        });
    } catch (error) {
        // The funnel optimistically marks a line 'saved' before this write. If the
        // write throws and we return quietly, telemetry reports a conversion for a
        // row that does not exist — which is exactly what happened to warm batch 01:
        // it reported 92 saves, wrote 81 rows, and the 11-row gap was 11 FK failures
        // that no metric could see. Every downstream number (conversion, coverage
        // lift, the campaign's own gate) inherits that lie, so the failure has to be
        // reported here or the information is destroyed at write time.
        //
        // P2003 is Prisma's foreign-key violation. The FatSecret lane persists its
        // FatSecretFood parents in a background task, so a first-sighting fs winner
        // can reach this write before its parent row exists — the dominant cause by
        // a wide margin (31.4% of batch 01's FatSecret saves). It is split out from
        // other save errors because the two need completely different fixes.
        const isForeignKeyViolation = (error as { code?: string }).code === 'P2003';
        markSaveRejected(options?.telemetry, isForeignKeyViolation ? 'persist_failed_fk' : 'persist_failed');
        logger.error('validated_mapping.save_error', {
            error: (error as Error).message,
            code: (error as { code?: string }).code,
            foreignKeyViolation: isForeignKeyViolation,
            rawIngredient,
            normalizedForm,
            source: mapping.source,
            foodId: mapping.foodId,
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

        // NOTE: this is a hand-built projection, not a spread of the row. A new column on
        // AiNormalizeCache is invisible to every caller until it is added HERE as well —
        // splitIngredients had a live read in ai-normalize.ts for months that could only
        // ever yield undefined, because the column and this projection were both missing.
        return {
            normalizedName: cached.normalizedName,
            canonicalBase: cached.canonicalBase ?? cached.normalizedName,  // Fallback for backward compatibility
            synonyms: cached.synonyms as string[],
            prepPhrases: cached.prepPhrases as string[],
            sizePhrases: cached.sizePhrases as string[],
            cookingModifier: cached.cookingModifier ?? undefined,
            isBranded: cached.isBranded ?? false,
            isMultiIngredient: cached.isMultiIngredient ?? false,
            splitIngredients: (cached.splitIngredients as string[] | null) ?? undefined,
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
        isMultiIngredient?: boolean;  // Input names two distinct ingredients ("salt and pepper")
        splitIngredients?: string[];  // The separated components, when isMultiIngredient
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
                isMultiIngredient: result.isMultiIngredient ?? false,
                splitIngredients: result.splitIngredients,  // undefined → column omitted → NULL
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
                // Undefined-safe on purpose: aiSimplifyIngredient and batchNormalizeIngredients
                // share this table and never compute these two, so they pass `undefined`, which
                // Prisma treats as "leave the column alone" rather than "write null/false".
                // A caller that DOES know must be able to fill a row written by one that didn't.
                isMultiIngredient: result.isMultiIngredient,
                splitIngredients: result.splitIngredients,
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

