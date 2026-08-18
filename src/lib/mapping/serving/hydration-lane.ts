/**
 * Hydration & serving-selection lane, extracted verbatim from
 * map-ingredient-with-fallback.ts (Phase 1 stage 1a, 2026-08-06).
 * Pure code motion: every function body is byte-identical to the mapper's
 * pre-extraction tree except for relative import paths, which gained one
 * directory of depth. The five COPIED_HELPERS bodies that winner-diff.ts
 * hashes live here now; its drift guard reads this file.
 */

import { type ParsedIngredient } from '../../parse/ingredient-line';
import { type UnifiedCandidate } from '../gather-candidates';
import { hasCriticalModifierMismatch } from '../filter-candidates';
import { extractLeanPercentage, isGenericGroundMeatQuery } from '../simple-rerank';
import {
    singularizeUnit,
    extractLabelServingUnit,
    LABEL_COUNT_PIECE_NOUNS,
    GENERIC_PIECE_WORDS,
    pieceNounInName,
    labelPieceMatchesItem,
    servingLabelCountsPiece,
    inferDiscreteUnit,
} from '../count-label';
import { logger } from '../../logger';
import type { FatSecretFoodDetails, FatSecretServing } from '../client';
import { getCachedFoodWithRelations, cacheFoodToDetails } from '../cache-search';
import { insertAiServing } from '../ai-backfill';
import { backfillOnDemand, isDiscreteItem } from '../serving-backfill';
import { classifyUnit } from '../unit-type';
import { isAmbiguousUnit, getOrCreateAmbiguousServing } from '../ambiguous-unit-backfill';
import { isEstimableUnknownUnit } from '../../ai/ambiguous-serving-estimator';
import { extractPrepModifier } from '../preemptive-backfill';
import { requestAiNutrition, createAiNutritionBudget, type AiNutritionBudget } from '../ai-nutrition-backfill';
import { AI_NUTRITION_BACKFILL_ENABLED, AI_NUTRITION_HYDRATION_MAX_PER_REQUEST } from '../config';
import { hydrateOffCandidate } from '../../openfoodfacts/hydrate';
import {
    applyOffBareQueryGuard,
    isBareUnitlessQty1,
    usableBareLabelServing,
    isBarePluralRequest,
    isDoseAnchoredBareQuery,
    BARE_LABEL_MIN_GRAMS,
    BARE_LABEL_MAX_GRAMS,
    BARE_MIN_PIECE_SERVING_GRAMS,
} from '../../servings/bare-query-guard';
import { buildFatSecretResult } from '../build-fatsecret-result';
import { resolveVolumeGrams, pickVolumeUnits, LARGE_VOLUME_UNIT_SPELLINGS } from '../../units/volume-density';
import type { FatsecretMappedIngredient } from '../map-ingredient-with-fallback';

/**
 * The volume-unit SPELLINGS `buildOffResult()` accepts. UNCHANGED by the B1a
 * convergence, and that is the point: this set is the gate on the whole volume
 * branch (`unit && volumeToGrams[unit]`), so adding a spelling routes a line
 * that reaches some other branch today. The owner also carries `milliliter` /
 * `milliliters`, which this lane has never accepted; admitting them is still
 * an open decision (B1b admitted only the large units — see below).
 *
 * `ml` / `floz` / `fl oz` are absent here on purpose — `buildOffResult()` pins
 * its own flat values for those three (see the comment at the call site).
 *
 * Reachability, measured 2026-08-17 by reading `parseIngredientLine()` in
 * `src/lib/parse/ingredient-line.ts`: `parsed.unit` normally comes from
 * `normalizeUnitToken()`, which canonicalises `cups`→`cup`, `tablespoons`→
 * `tbsp`, `teaspoons`→`tsp`, so the long spellings are unreachable on that
 * path — but `mapIngredientWithFallback()`'s `aiParseIngredient()` fallback
 * assigns the model's RAW string, so they are reachable and must stay.
 *
 * Lane B1b (2026-08-17) added `LARGE_VOLUME_UNIT_SPELLINGS` — `l`/`liter(s)`/
 * `litre(s)`, `pint(s)`, `quart(s)`, `gallon(s)`. Before that every one of them
 * fell past this branch (and every branch below it) to `flat_100g_default`:
 * `1 gallon of milk` billed 100 g live, 38x under. They now bill the owner's
 * density-scaled cell (`1 l` = 1000 x the ml cell), which for a LIQUID is
 * 1000 g — note this is the OWNER's ml scaling, not the flat `ml: 1` pin
 * below, so a SOLID-classed food bills `1000 x solidDensity` for a litre while
 * `1000 ml` of the same food bills 1000 g. That asymmetry is the ml/floz
 * disagreement documented at the call site and is not widened here: the live
 * lines are milk (LIQUID), and the beverage classifier (#340, `BEVERAGE_RE`
 * in the owner) moves named drinks to the pourable class.
 */
export const OFF_VOLUME_UNIT_SPELLINGS: readonly string[] = [
    'cup', 'cups',
    'tbsp', 'tablespoon', 'tablespoons',
    'tsp', 'teaspoon', 'teaspoons',
    'dash', 'dashes', 'pinch', 'pinches',
    ...LARGE_VOLUME_UNIT_SPELLINGS,
];

/**
 * The volume-unit SPELLINGS `buildFdcResult()` accepts. Also unchanged by B1a,
 * and here the gate matters more than it does on the OFF side: this branch's
 * density fallback is dead (0 live events), but the same gate admits the three
 * LIVE rungs above it — `fdc_label_volume` (2,134), `fdc_volume_cached` (632)
 * and `fdc_volume_ai` (318), measured 2026-08-17. Adding `cups`, `fl oz` or
 * `milliliter(s)` — all of which the owner carries and this lane never has —
 * would move real traffic into them; that is still open.
 *
 * Lane B1b (2026-08-17) added `LARGE_VOLUME_UNIT_SPELLINGS`. Before that they
 * landed on the terminal `fdc_unknown_unit` arm at a flat 100 g (the pin in
 * `__tests__/fdc-fallback-tiers.test.ts`, flipped by B1b). Admitting them here
 * routes a `1 quart milk` FDC line through the SAME three rungs a `1 cup milk`
 * line takes: own USDA row (`findOwnFdcVolumeServing()` — its stem table below
 * knows `pint`/`quart`/`gallon`/`liter`), then `insertFdcAiServing()`
 * (`fdc_volume_ai`, a live-model rung), then the density fallback. Note
 * `fdc-ai-backfill.ts`'s own ml table knows `l`/`liter(s)`/`litre(s)` but not
 * `pint`/`quart`/`gallon`, so a model answer phrased in those units fails its
 * `missing_volume_unit` check and falls to density — correct, if unhelpful.
 */
export const FDC_VOLUME_UNIT_SPELLINGS: readonly string[] = [
    'cup',
    'tbsp', 'tablespoon', 'tablespoons',
    'tsp', 'teaspoon', 'teaspoons',
    'ml', 'floz',
    'dash', 'dashes', 'pinch', 'pinches',
    ...LARGE_VOLUME_UNIT_SPELLINGS,
];

/**
 * Micro-volume measures this lane accepts and the owner has no opinion on:
 * absolute grams, never density-scaled — a pinch of anything is a pinch. Kept
 * verbatim from the inline table B1a replaced so the branch gate is unchanged.
 * `sprinkle` / `shake` reach `parsed.unit` only through the partitive-"of" path
 * in `parseIngredientLine()` ("1 sprinkle of salt"), which assigns the raw
 * lowercase token; `drop` / `second` are canonical outputs of
 * `normalizeUnitToken()`. Whether these belong in the owner is lane B1b.
 */
export const FDC_MICRO_VOLUME_GRAMS: Record<string, number> = {
    'sprinkle': 0.2, // ~1/25 tsp
    'shake': 0.2,
    // True micro-volume units (e.g., drops of hot sauce, liquid stevia)
    'drop': 0.05,    // 1 drop ≈ 0.05ml ≈ 0.05g water-density liquid
    'drops': 0.05,
    // Cooking spray duration (s) — 1 second of spray ≈ 0.25g oil
    'second': 0.25,
    'seconds': 0.25,
};

/**
 * Trailing-unit recovery set: units the parser sometimes fails to extract,
 * leaving them in the name (e.g. "5 mint 1 bunch" => unit: null, name:
 * "mint 1 bunch"). hydrateAndSelectServing and buildFdcResult both recover
 * them from parsed.name; the first MUTATES parsed.unit when it fires.
 * (Symbol names here deliberately carry no parens — the migration guard in
 * __tests__/ai-nutrition-hydration-budget.test.ts scans this file's raw text
 * for that name followed by an open paren, comments included.)
 *
 * INVARIANT (pinned by __tests__/trailing-unit-hoist-divergence.test.ts):
 * this set must stay DISJOINT from WEIGHT_UNIT_REGEX and VOLUME_UNIT_REGEX in
 * ../map-ingredient-with-fallback.ts. The 1d-hoisted isWeightUnit /
 * isVolumeUnit flags evaluate parsed.unit BEFORE that mutation runs, so the
 * hoist is only divergence-free while no member of this set reads as a weight
 * or volume unit (log/2026-08-07_0230, Findings).
 */
export const TRAILING_UNIT_REGEX = /\b(bunch|head|stalk)\b/i;

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
// Hydration & Serving Selection
// ============================================================

export async function hydrateAndSelectServing(
    candidate: UnifiedCandidate,
    parsed: ParsedIngredient | null,
    confidence: number,
    rawLine: string,
    /**
     * HYDRATION allowance, forwarded to buildOffResult (the OFF lane can reach
     * requestAiNutrition when the Atwater gate rejects label data). This is the
     * hydration pool, NOT the caller's last-resort pool: spending here is what
     * decides whether an already-won candidate survives at all, so it must not
     * be drainable by the unmappable-line path. See
     * `MapIngredientOptions.aiHydrationBudget`.
     * Optional so the offline eval/probe callers that pass four positional
     * args keep compiling; they then get one per-call allowance each.
     */
    aiHydrationBudget?: AiNutritionBudget,
): Promise<FatsecretMappedIngredient | null> {
    // Handle FDC candidates (already have nutrition data)
    // Also check for fdc_ prefix in ID - cached ValidatedMappings may have source='cache' but FDC IDs
    const isFdcFood = candidate.source === 'fdc' || candidate.id.startsWith('fdc_');
    if (isFdcFood) {
        return await buildFdcResult(candidate, parsed, confidence, rawLine);
    }

    // Handle OpenFoodFacts candidates (off_ prefix)
    if (candidate.source === 'openfoodfacts' || candidate.id.startsWith('off_')) {
        return await buildOffResult(candidate, parsed, confidence, rawLine, aiHydrationBudget);
    }

    // Handle FatSecret retrieval-lane candidates (fs_ prefix). MUST run before
    // the legacy branch below: that path is keyed to name-keyed AiGeneratedFood
    // rows (getCachedFoodWithRelations) and would misroute fs_ ids.
    if (candidate.source === 'fatsecret' || candidate.id.startsWith('fs_')) {
        return await buildFatSecretResult(candidate, parsed, confidence, rawLine);
    }

    // For cache/fatsecret candidates, get full details with servings
    let details: FatSecretFoodDetails | null = null;
    let targetFoodId = candidate.id;

    // Try cache first
    const cached = await getCachedFoodWithRelations(candidate.id);
    if (cached) {
        targetFoodId = cached.id;
        details = cacheFoodToDetails(cached);
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
        const trailingUnitMatch = parsed.name.match(TRAILING_UNIT_REGEX);
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
                    source: candidate.source,
                    foodId: targetFoodId,
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
            const { getDefaultCountServing } = await import('../../servings/default-count-grams');
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
                        source: candidate.source,
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

                    // Delete the stale cached AI entry so next run gets a fresh estimate.
                    //
                    // `isAiEstimated: true` is LOAD-BEARING on the fdc_/off_ branches. Without it
                    // these deleteMany calls match on (id, description) alone, and `targetSizeUnit`
                    // is exactly 'small' | 'medium' | 'large' — the same key space USDA's own size
                    // servings occupy. 94 of the 109 exact-name size rows in FdcServing are genuine
                    // `source='usda_fdc'` / isAiEstimated=false (re-derive:
                    //   SELECT source,"isAiEstimated",count(*) FROM "FdcServing"
                    //   WHERE lower(description) IN ('small','medium','large') GROUP BY 1,2;
                    // -> usda_fdc|f|94, ai|t|15, measured 2026-08-04), so an unfiltered delete
                    // removes curated USDA data. It fires precisely on legitimately heavy foods: a
                    // genuine 'medium' cabbage head at 588 g trips `> maxAIGrams` (500) and the row
                    // is destroyed for being correct. Nothing regenerates it.
                    //
                    // The branch's own comment above names a STALE FATSECRET-derived value as the
                    // motivating case, not a USDA row — deleting genuine rows was never the intent.
                    //
                    // AiGeneratedServing deliberately takes no filter: it has no `source` or
                    // `isAiEstimated` column because every row there is AI by construction.
                    try {
                        const { prisma: prismaDb } = await import('../../db');
                        const staleId = `ai_${candidate.id}_${targetSizeUnit}`;
                        if (candidate.id.startsWith('fdc_')) {
                            const fdcId = parseInt(candidate.id.replace('fdc_', ''), 10);
                            await prismaDb.fdcServing.deleteMany({
                                where: { fdcId, description: targetSizeUnit, isAiEstimated: true },
                            });
                        } else if (candidate.id.startsWith('off_')) {
                            const barcode = candidate.id.replace('off_', '');
                            await prismaDb.offServing.deleteMany({
                                where: { barcode, description: targetSizeUnit, isAiEstimated: true },
                            });
                        } else {
                            await prismaDb.aiGeneratedServing.deleteMany({
                                where: { foodId: candidate.id, label: targetSizeUnit },
                            });
                        }
                        logger.info('hydrate.stale_ai_cache_deleted', { foodId: candidate.id, targetSizeUnit });
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
        try {
            const { getBareQueryDefault, getDiscreteLeafyGreenDefault } = await import('../../ai/ambiguous-serving-estimator');
            
            let bareDefault = null;
            let overrideGrams = 0;

            if (parsed.qty === 1) {
                bareDefault = getBareQueryDefault(parsed.name || candidate.name);
                if (bareDefault) overrideGrams = bareDefault.grams;
            } else if (parsed.qty > 3) {
                bareDefault = getDiscreteLeafyGreenDefault(parsed.name || candidate.name, parsed.qty);
                if (bareDefault) overrideGrams = bareDefault.grams * parsed.qty;
            }

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
            const { getDefaultCountServing } = await import('../../servings/default-count-grams');
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
            const { getDefaultCountServing } = await import('../../servings/default-count-grams');
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
                const { getSubPieceDefault } = await import('../../servings/default-count-grams');
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
                const { estimateAmbiguousServing } = await import('../../ai/ambiguous-serving-estimator');
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
        source: candidate.source,
        foodId: targetFoodId,
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

import { isSizeQualifier, getOrCreateFdcSizeServings } from '../../usda/fdc-ai-backfill';

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
        const trailingUnitMatch = parsed.name.match(TRAILING_UNIT_REGEX);
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
                source: candidate.source,
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
                servingTier: 'fdc_unit_heuristic',
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

    // Handle volume units. The density rule — liquid / paste / dry-granule
    // category — is owned by `resolveVolumeGrams()` in
    // `src/lib/units/volume-density.ts`. This branch carried a hand-copy of it
    // until 2026-08-17 (lane B1a), and it was the copy WITHOUT the paste tier,
    // so `1 tbsp peanut butter` billed 7.5 g here against 16 g on the other two
    // paths.
    //
    // The convergence closes THREE differences, not one, and all three are
    // confined to the `volume_unit` fallback at the bottom of this branch —
    // which has never billed a live query (all 8,200 `volume_unit` events have
    // an `openfoodfacts` winner, 0 an FDC one; measured 2026-08-17, re-derive:
    // `SELECT "source", count(*) FROM "MappingEventLog"
    //    WHERE "servingTier"='volume_unit' GROUP BY 1;`):
    //   (1) the paste tier now applies here too;
    //   (2) the dry-granule category override no longer stomps the LIQUID
    //       default. This copy applied it unconditionally, so a food that is
    //       liquid AND categorised dry-granular billed the granule density:
    //       `1 cup maple syrup` 204 g here against the owner's 240 g;
    //   (3) the QUERY name no longer classifies the food. This copy tested
    //       `RE.test(candidate.name) || RE.test(parsed.name)` for both the
    //       liquid check and the category; the owner takes the FIRST NON-EMPTY
    //       name, which is the matched record's. Widening the owner to weigh
    //       every name is a real behaviour change with its own gate — see the
    //       KNOWN DIVERGENCE note on `resolveVolumeGrams()` — and is not this.
    const volumeDensity = resolveVolumeGrams(candidate.name, parsed?.name);
    const volumeToGrams: Record<string, number> = {
        ...pickVolumeUnits(volumeDensity.perUnit, FDC_VOLUME_UNIT_SPELLINGS),
        ...FDC_MICRO_VOLUME_GRAMS,
    };

    let grams: number = 100 * qty;
    let servingDescription: string = `${grams.toFixed(1)}g`;
    // Telemetry: which branch below billed the grams (MappingEventLog.servingTier).
    //
    // This is an INITIALIZER, not a tier any branch chooses. Until 2026-08-17 the
    // resolving branches overwrote it and the FALLBACK arms did not, so a
    // size-estimate failure, a piece-estimate failure, a low-count failure, an
    // ambiguous-unit failure and a genuinely unknown unit all reached
    // MappingEventLog as the same string `flat_100g_default` — five different
    // events, one label, no way to tell them apart after the fact. Every arm now
    // stamps its own name (`fdc_*_unresolved` / `fdc_unknown_unit`), so this value
    // is unreachable from buildFdcResult and survives only as the initializer.
    // `buildOffResult` still uses it as a real terminal tier; the 27 live
    // `flat_100g_default` events include BOTH lanes' history (re-derive:
    // `SELECT count(*) FROM "MappingEventLog" WHERE "servingTier"='flat_100g_default';`
    // → 27, measured 2026-08-17).
    let servingTier = 'flat_100g_default';

    if (unit && weightToGrams[unit]) {
        // Unit is a weight unit - convert qty to grams
        // e.g., "16 oz" → 16 * 28.35 = 453.6g
        grams = qty * weightToGrams[unit];
        servingDescription = `${grams.toFixed(1)}g`;
        servingTier = 'weight_unit';
    } else if (unit && volumeToGrams[unit]) {
        // Unit is a volume unit. Resolution order (Track 3, Jul 2026):
        //   (0) the record's OWN matching volume serving (USDA household
        //       measure, or a previously cached AI row) — deterministic and
        //       food-specific ("1.5 cups cooked quinoa" on fdc 168917 must
        //       bill 1.5 × the 185g usda_fdc cup row, never a fresh AI guess
        //       or the generic 240ml×density fallback; n-serv-06 flap);
        //   (1) AI estimation for food-specific density;
        //   (2) hardcoded density fallback.
        const fdcId = parseInt(candidate.id.replace('fdc_', ''), 10);
        let volumeResolved = false;

        if (!isNaN(fdcId)) {
            const ownVolume = await findOwnFdcVolumeServing(fdcId, unit);
            if (ownVolume) {
                grams = qty * ownVolume.perUnitGrams;
                servingDescription = `${qty} ${unit}`;
                volumeResolved = true;
                servingTier = ownVolume.genuine ? 'fdc_label_volume' : 'fdc_volume_cached';
                logger.info('fdc.volume_own_serving', {
                    foodName: candidate.name, unit,
                    gramsPerUnit: ownVolume.perUnitGrams,
                    totalGrams: grams,
                    genuine: ownVolume.genuine,
                });
            }
        }

        if (!volumeResolved && !isNaN(fdcId)) {
            try {
                const { insertFdcAiServing } = await import('../../usda/fdc-ai-backfill');
                const aiResult = await insertFdcAiServing(fdcId, 'volume', { targetUnit: unit });
                // Use the grams the estimator computed for THIS unit. The old code
                // re-read fdcServing by `orderBy id desc`, which ignored `unit` and
                // grabbed an arbitrary AI serving — for honey (tbsp/tsp/cup all AI)
                // that surfaced "1 tsp"=7g for a tbsp query. (n-serv-05)
                if (aiResult.success && aiResult.grams && aiResult.grams > 0) {
                    grams = qty * aiResult.grams;
                    servingDescription = `${qty} ${unit}`;
                    volumeResolved = true;
                    servingTier = 'fdc_volume_ai';
                    logger.info('fdc.volume_ai_estimated', {
                        foodName: candidate.name, unit, gramsPerUnit: aiResult.grams, totalGrams: grams,
                    });
                }
            } catch (err) {
                logger.warn('fdc.volume_ai_failed', { foodName: candidate.name, unit, error: (err as Error).message });
            }
        }

        if (!volumeResolved) {
            // Fallback to hardcoded density estimate
            grams = qty * volumeToGrams[unit];
            servingDescription = `${qty} ${unit}`;
            servingTier = 'volume_unit';
            logger.info('fdc.volume_hardcoded_fallback', {
                foodName: candidate.name, unit, gramsPerUnit: volumeToGrams[unit], totalGrams: grams,
            });
        }
    } else if (isSizeQualifier(unit)) {
        // Unit is a size qualifier (small/medium/large). Resolution order
        // (Lane G, 2026-08-17), mirroring the volume branch above:
        //   (0) the record's OWN matching size row — a USDA household measure,
        //       deterministic and food-specific;
        //   (1) getOrCreateFdcSizeServings(), which is a live-USDA-search-then-LLM
        //       estimate scaled by hardcoded ratios and reads no local row at all.
        const fdcId = parseInt(candidate.id.replace('fdc_', ''), 10);

        const ownSize = await findOwnFdcSizeServing(fdcId, unit);
        if (ownSize) {
            grams = qty * ownSize.perUnitGrams;
            // The row's OWN description, verbatim: /api/nlp/parse hands this to
            // resolveFoodDetails() as `matchedServingDescription`, which flags
            // `isDefault` by exact case-insensitive label match. A synthesized
            // "1 medium (118g each)" can never match; the row's own label does.
            servingDescription = ownSize.description;
            servingTier = ownSize.genuine ? 'fdc_own_size_serving' : 'fdc_own_size_cached';
            logger.info('fdc.size_own_serving', {
                foodName: candidate.name, size: unit,
                gramsPerUnit: ownSize.perUnitGrams, totalGrams: grams,
                description: ownSize.description, genuine: ownSize.genuine,
            });
        } else {
            const sizes = await getOrCreateFdcSizeServings(fdcId, candidate.name);
            const gramsPerUnit = sizes && unit ? sizes[unit] : undefined;

            if (gramsPerUnit != null) {
                grams = qty * gramsPerUnit;
                servingDescription = `${qty} ${unit} (${gramsPerUnit}g each)`;
                servingTier = 'fdc_size_qualifier';
                logger.info('fdc.size_qualifier_resolved', {
                    foodName: candidate.name,
                    size: unit,
                    gramsPerUnit,
                    totalGrams: grams,
                });
            } else if (sizes) {
                // THE ESTIMATOR ANSWERED, BUT NOT FOR THIS SIZE. Split out 2026-08-17
                // because `isSizeQualifier()` accepted ten spellings while
                // `getOrCreateFdcSizeServings()` returned a map keyed by nine: an
                // `extralarge` request was accepted and never answered, so this arm
                // billed `qty * (undefined ?? 100)` while stamping the SAME
                // `fdc_size_qualifier` as a genuine resolution, and additionally
                // rendered the literal string "undefinedg each" to the user.
                //
                // THAT POPULATION IS GONE (2026-08-17, same day): the producer now
                // derives its acceptance set from its answer table, so no spelling
                // `isSizeQualifier()` admits can be missing from the map. This arm is
                // kept as the DEFENSIVE one — the map is a `Record<string, number>`
                // and this branch indexes it with a caller-supplied unit, so "answered,
                // but not for this key" stays structurally reachable and is worth a
                // name distinct from "the estimator failed". A vocabulary gap and a
                // working estimate are different events.
                //
                // The "undefinedg each" string is DELIBERATELY PRESERVED here, and the
                // extralarge fix did NOT touch it: `servingDescription` is on the wire
                // (`/api/nlp/parse` passes it to `resolveFoodDetails()` as
                // `matchedServingDescription`), so repairing the label is a separate,
                // measurable change with its own gate. What the fix changed is that
                // real traffic no longer REACHES this arm, not what it renders.
                grams = 100 * qty;
                servingDescription = `${qty} ${unit} (${gramsPerUnit}g each)`;
                servingTier = 'fdc_size_key_missing';
                logger.warn('fdc.size_qualifier_key_missing', {
                    foodName: candidate.name,
                    size: unit,
                    knownSizes: Object.keys(sizes),
                    fallbackGrams: grams,
                });
            } else {
                // The estimator itself failed (LLM error, or a `status` other than
                // success). Distinct from the arm above, which got an answer that did
                // not cover the requested spelling.
                grams = 100 * qty;
                servingDescription = `${grams.toFixed(1)}g (estimated)`;
                servingTier = 'fdc_size_unresolved';
                logger.warn('fdc.size_qualifier_fallback', {
                    foodName: candidate.name,
                    size: unit,
                    fallbackGrams: grams,
                });
            }
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
            const unitHint = parsed?.unitHint || '';

            // 0. The record's OWN serving row (Lane G, 2026-08-17). First, like the
            //    volume branch's rung (0): a USDA household measure beats every
            //    estimator below it and is the only rung here that replays.
            //
            //    Two attempts, in the order the request expresses:
            //      (a) the parsed COUNT unit, so "4 slice ham" can reach a real
            //          `slice` row rather than being told what a slice weighs;
            //      (b) `medium` as the per-piece proxy — the same editorial choice
            //          rung 3 below already makes with
            //          `getOrCreateFdcSizeServings()['medium']`, just sourced from
            //          the record instead of from a model. This is the arm
            //          `5 strawberries` (n-serv-31) takes.
            //
            //    Both are capped at COUNT_SERVING_MAX_GRAMS: the request names a
            //    count and no size, so a `piece` row that is a whole raw brisket
            //    must not answer it.
            //
            //    Ordering note: this now precedes the sub-piece default table at
            //    rung 1. That table currently bills NOTHING — `fdc_sub_piece_default`
            //    has 0 events in MappingEventLog (measured on the box 2026-08-17) —
            //    so the precedence question between them is live only in principle.
            const ownCountToken = unitHint || unit;
            const ownPiece =
                await findOwnFdcSizeServing(fdcId, ownCountToken, { maxPerUnitGrams: COUNT_SERVING_MAX_GRAMS })
                ?? await findOwnFdcSizeServing(fdcId, 'medium', { maxPerUnitGrams: COUNT_SERVING_MAX_GRAMS });

            if (ownPiece) {
                grams = qty * ownPiece.perUnitGrams;
                servingDescription = ownPiece.description;
                servingTier = ownPiece.genuine ? 'fdc_own_size_serving' : 'fdc_own_size_cached';
                resolved = true;
                logger.info('fdc.piece_own_serving', {
                    foodName: candidate.name, requestedUnit: ownCountToken || null,
                    gramsPerUnit: ownPiece.perUnitGrams, qty, totalGrams: grams,
                    description: ownPiece.description, genuine: ownPiece.genuine,
                });
            }

            // 1. Try deterministic sub-piece defaults first (cheaper & more reliable than AI)
            if (!resolved && unitHint) {
                try {
                    const { getSubPieceDefault } = await import('../../servings/default-count-grams');
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
                        servingTier = 'fdc_sub_piece_default';
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
                    const { estimateAmbiguousServing } = await import('../../ai/ambiguous-serving-estimator');
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
                        servingTier = 'fdc_piece_ai';
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
                    servingTier = 'fdc_medium_estimate';
                    logger.info('fdc.unitless_medium_resolved', {
                        foodName: candidate.name,
                        gramsPerUnit,
                        totalGrams: grams,
                    });
                } else {
                    // HIGH COUNT, nothing resolved: the sub-piece table had no entry,
                    // per-piece AI estimation failed or returned non-success, and the
                    // `medium` proxy was either skipped (branded goods are excluded by
                    // design two lines up) or itself failed. Named separately from the
                    // LOW COUNT arm below because the two reach 100 g through different
                    // ladders — this one has three rungs, that one has one.
                    grams = 100 * qty;
                    servingDescription = `${grams.toFixed(1)}g`;
                    servingTier = 'fdc_piece_unresolved';
                    logger.warn('fdc.unitless_fallback', {
                        foodName: candidate.name,
                        fallbackGrams: grams,
                    });
                }
            }
        } else {
            // LOW COUNT: "1 cucumber", "2 avocados" → "medium" estimation

            // Apply mini override identical to hydrateAndSelectServing
            const hasMiniModifier = parsed?.name?.toLowerCase().includes('mini');
            const targetSize = hasMiniModifier ? 'small' : 'medium';

            // 0. The record's OWN row (Lane G, 2026-08-17). A `mini` request tries
            //    the record's real `mini` row before its `small` one.
            //
            //    NO 0.8 FUDGE ON A REAL ROW. The estimator branch below multiplies
            //    `small` by 0.8 to approximate "mini", because it only ever has a
            //    scaled `medium` to work with. A row the record itself declares is
            //    a measurement, and scaling a measurement by a guess re-imports the
            //    guess this rung exists to remove. If the record has no `mini` row
            //    the rung falls through and the estimator's 0.8 applies exactly as
            //    it does today.
            //
            //    No gram ceiling here, unlike the high-count rung: "1 large
            //    spaghetti squash" really is the 800 g row, and the request names
            //    the size.
            const ownLowCount =
                (hasMiniModifier ? await findOwnFdcSizeServing(fdcId, 'mini') : null)
                ?? await findOwnFdcSizeServing(fdcId, targetSize);

            if (ownLowCount) {
                grams = qty * ownLowCount.perUnitGrams;
                servingDescription = ownLowCount.description;
                servingTier = ownLowCount.genuine ? 'fdc_own_size_serving' : 'fdc_own_size_cached';
                logger.info('fdc.unitless_own_serving', {
                    foodName: candidate.name, sizeUsed: targetSize,
                    gramsPerUnit: ownLowCount.perUnitGrams, totalGrams: grams,
                    description: ownLowCount.description, genuine: ownLowCount.genuine,
                });
            } else {
                const sizes = await getOrCreateFdcSizeServings(fdcId, candidate.name);

                if (sizes && sizes[targetSize]) {
                    const baseGramsPerUnit = sizes[targetSize]!;
                    // For "mini" modifier, reduce below "small" weight (mini ≈ 80% of small)
                    const gramsPerUnit = hasMiniModifier ? Math.round(baseGramsPerUnit * 0.8) : baseGramsPerUnit;

                    grams = qty * gramsPerUnit;
                    servingDescription = `${qty} ${hasMiniModifier ? 'mini' : targetSize} (${gramsPerUnit}g each)`;
                    servingTier = 'fdc_size_estimate';
                    logger.info('fdc.unitless_size_resolved', {
                        foodName: candidate.name,
                        sizeUsed: targetSize,
                        gramsPerUnit,
                        totalGrams: grams,
                    });
                } else {
                    // LOW COUNT, size estimation failed (or answered without the
                    // small/medium key this arm asks for). "1 cucumber" billed as 100 g.
                    grams = 100 * qty;
                    servingDescription = `${grams.toFixed(1)}g`;
                    servingTier = 'fdc_size_estimate_unresolved';
                    logger.warn('fdc.unitless_fallback', {
                        foodName: candidate.name,
                        fallbackGrams: grams,
                    });
                }
            }
        }
    } else if (unit && (isAmbiguousUnit(unit) || ['cup', 'cups', 'c', 'tbsp', 'tablespoon', 'tablespoons', 'tbs', 'tsp', 'teaspoon', 'teaspoons', 'floz', 'fl oz', 'fluid ounce', 'ml'].includes(unit.toLowerCase()))) {
        // AMBIGUOUS UNITS (egg, packet, container, etc.) - use AI estimation
        //
        // DELIBERATELY NOT GIVEN A RUNG (0) BY LANE G (2026-08-17), and the reason
        // is not scope. The data is there — 432 FdcServing rows are anchored on one
        // of this branch's units (can 167, package 111, container 80, packet 34,
        // …; box, 2026-08-17) — but two things separate it from branches 3 and 4:
        //
        //  - The defect Lane G removes is "a fresh estimate every request". It does
        //    not hold here: `getOrCreateAmbiguousServing()` is genuinely cached and
        //    stamps `count_unit_cached` on a hit, so this branch already replays.
        //    `getOrCreateFdcSizeServings()` is the one with no cache at all.
        //  - The vocabulary names PACKAGES, not portions. An FDC `container` or
        //    `can` row is a package weight, which is the class the volume matcher's
        //    density band exists to reject, and this branch's estimator carries
        //    clamps and floor guards (`GENERIC_UNKNOWN_MAX`, the portion-unit floor
        //    in ambiguous-serving-estimator.ts) that a raw row read would bypass.
        //
        // So it is a separate change with its own measurement, not a rider on this
        // one. Stated here rather than in a report so the next reader finds it.
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
            servingTier = ambiguousResult.status === 'cached' ? 'count_unit_cached' : 'count_unit_ai';
            logger.info('fdc.ambiguous_unit_resolved', {
                foodName: candidate.name,
                unit,
                gramsPerUnit,
                totalGrams: grams,
            });
        } else {
            // The ambiguous-unit estimator returned neither `success` nor `cached`.
            // Its two resolving siblings are `count_unit_ai` / `count_unit_cached`,
            // so this arm is the only one of the three that was previously invisible.
            grams = 100 * qty;
            servingDescription = `${grams.toFixed(1)}g (estimated)`;
            servingTier = 'count_unit_unresolved';
            logger.warn('fdc.ambiguous_unit_fallback', {
                foodName: candidate.name,
                unit,
                fallbackGrams: grams,
            });
        }
    } else {
        // TERMINAL ARM — a unit that reached none of the five branches above:
        // not a weight, not a volume, not a size qualifier, not a count unit, not
        // ambiguous. Nothing was attempted and nothing failed, which is why it is
        // named for the input rather than for an unresolved estimate. The comment
        // this replaces read "Unknown units (slices, pieces, etc.)" and was wrong
        // about its own examples: `slice`/`piece` are matched by branch 4's list
        // and cannot arrive here.
        grams = 100 * qty;
        servingDescription = `${grams.toFixed(1)}g`;
        servingTier = 'fdc_unknown_unit';
    }

    // === BARE QUERY INFLATION GUARD (FDC) ===
    if (parsed && !parsed.unit && parsed.qty === 1) {
        try {
            const { getBareQueryDefault } = await import('../../ai/ambiguous-serving-estimator');
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
                servingTier = 'bare_query_default';
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
        servingTier,
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
// (inferDiscreteUnit moved to count-label.ts — shared with the bare-serving
// guard's discrete floor so there is exactly ONE discrete-noun lexicon.)

/**
 * True when an OFF search candidate's raw label serving enumerates >=2 of the
 * counted piece with a sane per-piece weight ("14 chips (28g)" for a chip
 * count, or the generic multi-piece counter "15 pieces (28g)"). Such SKUs carry
 * their own authoritative per-piece grams, so rerank prefers them over
 * null-serving SKUs that would fall to the generic seed.
 */
function candidateHasCountLabel(candidate: UnifiedCandidate, pieceNoun: string): boolean {
    if (candidate.source === 'fatsecret') {
        // fs servings are household measures — "1 cookie", "6 crackers" — so a
        // serving whose unit word IS the counted noun (or the generic piece
        // counter) carries an authoritative per-piece weight. Same noun list,
        // unit-word extraction and per-piece sanity band as the OFF label
        // check (servingLabelCountsPiece), except count >= 1 qualifies: an fs
        // "1 cookie" serving is genuinely per-piece, unlike an OFF "1 portion"
        // label.
        return !!candidate.servings?.some(s => {
            if (!(typeof s.grams === 'number' && s.grams > 0)) return false;
            const labelWord = extractLabelServingUnit(s.description);
            if (labelWord !== pieceNoun && !(labelWord && GENERIC_PIECE_WORDS.has(labelWord))) return false;
            const count = servingLeadingCount(s.description);
            const perPiece = s.grams / (count > 0 ? count : 1);
            return perPiece >= 0.2 && perPiece <= 500;
        });
    }
    if (candidate.source !== 'openfoodfacts') return false;
    const raw = candidate.rawData as { servingSize?: string | null; servingGrams?: number | null } | undefined;
    return servingLabelCountsPiece(raw?.servingSize, raw?.servingGrams, pieceNoun);
}

/**
 * Explicit weight/volume units bill deterministically from grams/ml, so a
 * record's serving-label richness is irrelevant to those requests. Everything
 * else — unitless ("1 red bull"), counts, container words ("can", "bar",
 * "sleeve") — resolves through the record's own serving data, where a
 * label-less winner falls to flat_100g_default and mis-bills.
 */
const EXPLICIT_MEASURE_UNIT_RE = /^(g|gram|grams|oz|ounce|ounces|lb|lbs|pound|pounds|kg|kilogram|kilograms|cup|cups|tbsp|tablespoon|tablespoons|tsp|teaspoon|teaspoons|ml|milliliter|milliliters|l|liter|liters|floz|fl\s*oz|fluid\s*ounces?|pint|pints|quart|quarts|gallon|gallons)$/i;
function requestBillsByServing(parsed: ParsedIngredient | null): boolean {
    return !(parsed?.unit && EXPLICIT_MEASURE_UNIT_RE.test(parsed.unit.trim()));
}

/**
 * True when the candidate carries genuine gram-quantified serving data:
 * an OFF label servingGrams, or any FDC serving with grams. Feeds the
 * rerank SERVING_LABEL_BOOST tie-break (PR D pt2) so a serving-less record
 * can't win a near-tie and flatten a serving-billed request to 100g —
 * the parity sweep's "red bull lost its can" class.
 */
function candidateHasServingData(candidate: UnifiedCandidate): boolean {
    if (candidate.source === 'openfoodfacts') {
        const raw = candidate.rawData as { servingGrams?: number | null } | undefined;
        return typeof raw?.servingGrams === 'number' && raw.servingGrams > 0;
    }
    if (candidate.source === 'fdc') {
        return !!candidate.servings?.some(s => typeof s.grams === 'number' && s.grams > 0);
    }
    // fs lane candidates carry inline gram-quantified servings ("1 bar" 60g) —
    // exactly the serving shape SERVING_LABEL_BOOST exists to reward.
    if (candidate.source === 'fatsecret') {
        return !!candidate.servings?.some(s => typeof s.grams === 'number' && s.grams > 0);
    }
    return false;
}

// ============================================================
// Volume-serving matching (cooked-grain volume preference, Track 3 Jul 2026)
// ============================================================

// Requested-volume-unit → serving-description stems. FDC household measures
// store "cup" / "1 cup" / "0.25 cup, sliced"; tbsp rows may spell "tablespoon".
// Lane B1b (2026-08-17) added the large volume units so a `1 quart milk` request
// can reach a genuine USDA "1 quart" household-measure row (SR Legacy carries
// them for milk, juices, broths) instead of skipping straight to the AI rung.
// The stems are the LONG words only — a bare `l` stem would match inside too
// many descriptions — and the millilitres are the owner's `VOLUME_UNIT_ML`
// values in `src/lib/units/volume-density.ts`.
const VOLUME_UNIT_STEMS: Record<string, string[]> = {
    cup: ['cup'], cups: ['cup'],
    tbsp: ['tbsp', 'tablespoon'], tablespoon: ['tbsp', 'tablespoon'], tablespoons: ['tbsp', 'tablespoon'],
    tsp: ['tsp', 'teaspoon'], teaspoon: ['tsp', 'teaspoon'], teaspoons: ['tsp', 'teaspoon'],
    floz: ['fl oz', 'fluid ounce'], 'fl oz': ['fl oz', 'fluid ounce'],
    l: ['liter', 'litre'], liter: ['liter', 'litre'], liters: ['liter', 'litre'],
    litre: ['liter', 'litre'], litres: ['liter', 'litre'],
    pint: ['pint'], pints: ['pint'],
    quart: ['quart'], quarts: ['quart'],
    gallon: ['gallon'], gallons: ['gallon'],
};
const VOLUME_UNIT_ML: Record<string, number> = {
    cup: 240, cups: 240,
    tbsp: 15, tablespoon: 15, tablespoons: 15,
    tsp: 5, teaspoon: 5, teaspoons: 5,
    floz: 30, 'fl oz': 30,
    l: 1000, liter: 1000, liters: 1000, litre: 1000, litres: 1000,
    pint: 473.176, pints: 473.176,
    quart: 946.353, quarts: 946.353,
    gallon: 3785.41, gallons: 3785.41,
};

/** True when the requested unit is one the volume-serving matcher understands. */
function isMatchableVolumeUnit(unit: string): boolean {
    return VOLUME_UNIT_STEMS[unit.toLowerCase().trim()] != null;
}

/** True when a serving description names the requested volume unit ("0.5 cup (126 g)" for "cup"). */
function servingDescriptionMatchesVolumeUnit(description: string | null | undefined, unit: string): boolean {
    if (!description) return false;
    const stems = VOLUME_UNIT_STEMS[unit.toLowerCase().trim()];
    if (!stems) return false;
    return stems.some(s => new RegExp(`\\b${s.replace(' ', '\\s+')}s?\\b`, 'i').test(description));
}

/** Leading count of a serving description ("0.25 cup" → 0.25, "1/2 cup" → 0.5, "cup" → 1). */
function servingLeadingCount(description: string): number {
    const frac = description.match(/^\s*(\d+)\s*\/\s*(\d+)/);
    if (frac) {
        const denom = parseFloat(frac[2]);
        return denom > 0 ? parseFloat(frac[1]) / denom : 1;
    }
    const m = description.match(/^\s*(\d+(?:\.\d+)?)/);
    if (!m) return 1;
    const n = parseFloat(m[1]);
    return Number.isFinite(n) && n > 0 ? n : 1;
}

// Density plausibility band for trusting a volume serving (g/ml). Foods span
// ~0.1 (puffed cereal) to ~1.45 (honey); anything outside is a corrupt row
// (e.g. a whole-package weight stored under a "cup" description).
const VOLUME_SERVING_MIN_DENSITY = 0.1;
const VOLUME_SERVING_MAX_DENSITY = 1.6;

/**
 * The record's OWN volume serving matching the requested unit, per-unit
 * (n-serv-06): the USDA cooked-quinoa "cup"=185g row must beat both a fresh
 * AI estimate and the generic 240ml×density fallback. Genuine (non-AI) rows
 * win over previously cached AI rows; either makes resolution deterministic
 * across runs. Density-banded so corrupt rows can't smuggle package weights.
 *
 * TIE-BREAK (2026-08-17): the read is ordered on `description` asc, `id` asc —
 * the same explicit `orderBy` the size sibling `findOwnFdcSizeServing()` has
 * carried since it shipped. A genuine row still beats an AI row whatever the
 * order; among several genuine rows that match the unit and pass the density
 * band (strawberries fdc_167762 carry `cup, halves` 152 g, `cup, pureed` 232 g,
 * `cup, sliced` 166 g and `cup, whole` 144 g), the FIRST BY DESCRIPTION wins —
 * `cup, halves` — where before it was whichever row the database returned
 * first. That is a real behaviour change on ties, not a no-op: a record whose
 * physical row order differed from its description order can now bill a
 * different one of its own rows. It is deterministic either way from here on.
 */
export async function findOwnFdcVolumeServing(
    fdcId: number,
    unit: string,
): Promise<{ perUnitGrams: number; genuine: boolean } | null> {
    const mlPerUnit = VOLUME_UNIT_ML[unit.toLowerCase().trim()];
    if (!mlPerUnit || !isMatchableVolumeUnit(unit)) return null;
    let rows: Array<{ description: string; grams: number | null; isAiEstimated: boolean | null }>;
    try {
        const { prisma } = await import('../../db');
        rows = await prisma.fdcServing.findMany({
            where: { fdcId },
            select: { description: true, grams: true, isAiEstimated: true },
            orderBy: [{ description: 'asc' }, { id: 'asc' }],
        });
    } catch {
        return null;
    }
    const matches = rows
        .filter(r => r.grams != null && r.grams > 0 && servingDescriptionMatchesVolumeUnit(r.description, unit))
        .map(r => {
            const count = servingLeadingCount(r.description);
            return {
                perUnitGrams: (r.grams as number) / (count > 0 ? count : 1),
                genuine: !r.isAiEstimated,
            };
        })
        .filter(m => {
            const density = m.perUnitGrams / mlPerUnit;
            return density >= VOLUME_SERVING_MIN_DENSITY && density <= VOLUME_SERVING_MAX_DENSITY;
        });
    if (matches.length === 0) return null;
    return matches.find(m => m.genuine) ?? matches[0];
}

// ============================================================
// Size / count-serving matching (Lane G, 2026-08-17)
//
// The sibling of the volume matcher above, for branches 3 and 4 of
// buildFdcResult. Same shape, same reason: the record's OWN FdcServing row is
// deterministic and food-specific, and until now only the VOLUME branch read
// one. Branches 3 and 4 went straight to `getOrCreateFdcSizeServings()`, which
// despite its name touches no database, ignores its `fdcId` except for logging,
// and scales one `estimateAmbiguousServing()` answer by hardcoded ratios
// (small 0.70 / large 1.40 / xl 1.60 / mini 0.55). That estimator's own first
// step is a LIVE HTTP search of the remote USDA API BY NAME, which can land on
// a different fdcId than the mapper picked; if it misses, a model answers.
//
// Measured consequence (box, 2026-08-17): `5 strawberries` resolves to
// fdc_167762 "Strawberries, raw", whose own rows include `medium (1-1/4" dia)`
// = 12 g — a row the parse response ALREADY LISTS in its own servingOptions —
// while billing an LLM per-piece guess that came back 75/50/75 g on three
// probes ~90 s apart.
// ============================================================

/**
 * Requested token -> serving-description stems. The size half mirrors
 * `SIZE_QUALIFIERS` in ../../usda/fdc-ai-backfill (ten spellings, so `sm`/`med`/
 * `lg`/`xl` reach the same rows as their long forms); the count half mirrors
 * buildFdcResult branch 4's own unit list, so a `4 slice ham` request can reach
 * a real `slice` row.
 */
const SIZE_SERVING_STEMS: Record<string, string[]> = {
    mini: ['mini'],
    small: ['small'], sm: ['small'],
    medium: ['medium'], med: ['medium'],
    large: ['large'], lg: ['large'],
    'extra-large': ['extra large', 'extra-large'],
    extralarge: ['extra large', 'extra-large'],
    xl: ['extra large', 'extra-large'],
    slice: ['slice'], slices: ['slice'],
    piece: ['piece'], pieces: ['piece'],
    chunk: ['chunk'], chunks: ['chunk'],
    wedge: ['wedge'], wedges: ['wedge'],
    strip: ['strip'], strips: ['strip'],
    segment: ['segment'], segments: ['segment'],
};

/**
 * A USDA YIELD row, not a portion.
 *
 * `piece, cooked, excluding refuse (yield from 1 lb raw meat with refuse)` is
 * what 1 lb of raw meat cooks down to — it is anchored on `piece` and it is not
 * a piece of anything. 187 of the 476 anchored count rows (39.3%) are this
 * shape, and they are the whole heavy tail: excluding them takes the count
 * population's >300 g band from 111 rows to 35 (measured on the box 2026-08-17;
 * re-derive with the two counts in the PR body). Zero of the 221 anchored SIZE
 * rows match, so the filter costs nothing on that rung and removes exactly the
 * class that would have billed "3 pieces of beef tenderloin" as 990 g.
 */
const FDC_YIELD_ROW_RE = /\byields?\b|\brefuse\b/i;

/**
 * Per-unit ceiling for the COUNT rung only.
 *
 * The eight rows above it are all raw beef/pork primals whose USDA "1 piece"
 * really is the whole cut — brisket flat half 1967 g, pork leg sirloin tip
 * roast 765 g. Honest data, implausible request: someone typing "3 pieces of
 * brisket" does not mean three briskets. There is a clean gap in the measured
 * distribution between 446 g and 514 g and the constant sits in it (post-yield
 * -filter counts, box 2026-08-17: 8 rows >500 g, 24 >400 g, 289 total).
 *
 * DELIBERATELY NOT APPLIED TO THE SIZE RUNG. There the user named the size, so
 * the 800 g `large` row on spaghetti squash is the correct answer to "1 large
 * spaghetti squash". The ceiling exists for requests that name a COUNT and no
 * size; failing it drops through to today's estimator, i.e. to the status quo.
 */
const COUNT_SERVING_MAX_GRAMS = 500;

/** Strips a leading count from a serving description ("1 medium" -> "medium"). */
function stripServingLeadingCount(description: string): string {
    return description.replace(/^\s*(?:\d+\s*\/\s*\d+|\d+(?:\.\d+)?)\s*/, '').trim();
}

/**
 * True when a serving description STARTS with one of `stems`.
 *
 * ANCHORED, NEVER A FREE SUBSTRING, AND THAT IS THE WHOLE DESIGN. A substring
 * test for "medium" matches 104 rows on the live table, of which 34 (32.7%) are
 * UNIT-qualified rather than size-qualified — `slice, medium` 28 g,
 * `leaf, medium` 7.5 g, `stalk, medium` 180 g, `head, medium (6" dia)` 539 g.
 * Those describe a medium SLICE, not a medium onion, and a free match would let
 * a 539 g cabbage head answer "1 medium tomato". Anchoring also gets the
 * converse right for free: `slice, medium` IS the correct answer to a `slice`
 * request, because there the stem is `slice` and it leads.
 *
 * Two more properties the anchor buys, both measured on the box 2026-08-17:
 *   - `extra small (less than 6" long)` correctly does NOT answer a `small`
 *     request (banana fdc_173944 carries both that and a real `small` row).
 *   - Anchored size matching has NO ties at all: every (fdcId, size token) group
 *     has exactly one row — large 72, medium 70, small 62, mini 11, extra 6.
 *     The free-substring version has 7 records carrying >=2 `%medium%` rows with
 *     a 67.4x spread. The ambiguity rule below therefore only ever fires on the
 *     COUNT rung, where 28 of 147 records (19%) do carry several `slice` rows.
 */
function servingDescriptionStartsWithStem(description: string | null | undefined, stems: string[]): boolean {
    if (!description) return false;
    const body = stripServingLeadingCount(description);
    return stems.some(s => {
        // Escape first, THEN loosen whitespace, so "extra large" also matches
        // "extra  large" without the escape pass reintroducing a literal space.
        const pattern = s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
        return new RegExp(`^${pattern}s?\\b`, 'i').test(body);
    });
}

/**
 * The record's OWN serving row for a size qualifier or a count unit, per unit.
 *
 * Returns null — DECLINING to the caller's existing estimator — whenever the
 * record does not name one row unambiguously. That is the deliberate failure
 * direction: a decline costs nothing (the caller behaves exactly as it does
 * today), whereas guessing between the record's own rows would invent a
 * preference the data does not express.
 *
 * SELECTION RULE, in order:
 *   1. anchored on the requested stem (above), grams > 0, not a yield row, and
 *      within `maxPerUnitGrams` when the caller passes one;
 *   2. genuine (`isAiEstimated === false`) rows shut out AI-written ones
 *      entirely — honey carries a real `tbsp` 21 g AND an AI `1 tbsp` 21 g, so
 *      without this the pick would depend on row order;
 *   3. among what survives, take the least-qualified CLASS: an exact bare row
 *      (`slice`) beats a `medium`-qualified one (`slice, medium`) beats anything
 *      else (`slice, thin` / `slice, thick`);
 *   4. if that class holds exactly one row, return it; otherwise return null.
 *
 * Rung 3's middle step is not a new editorial choice — it is the same one the
 * caller already makes, since branch 4's existing fallback reads
 * `getOrCreateFdcSizeServings()['medium']`. Worked examples from the live table:
 * bologna fdc_168101 {slice, slice medium, slice thick, slice thin} -> the bare
 * `slice` 28 g; bologna fdc_167685 {medium, thick, thin} with no bare row ->
 * `slice, medium` 28 g; sharp cheddar fdc_170899 {slice (1 oz), slice (2/3 oz),
 * slice (3/4 oz)} -> NULL, because the record genuinely does not say which.
 *
 * `orderBy` is explicit. The volume sibling above tie-breaks with
 * `matches.find(m => m.genuine) ?? matches[0]`, which was a database-order
 * dependency until 2026-08-17 (harmless only because its density band is
 * narrow); it now carries this same `orderBy`. Removing one source of
 * nondeterminism while importing another would be self-defeating, so the read
 * is ordered on `description` (unique per fdcId by the
 * `FdcServing_fdcId_description_key` constraint, hence a total order) with `id`
 * behind it.
 */
export async function findOwnFdcSizeServing(
    fdcId: number,
    token: string | null | undefined,
    opts: { maxPerUnitGrams?: number } = {},
): Promise<{ perUnitGrams: number; genuine: boolean; description: string } | null> {
    if (!token || !Number.isFinite(fdcId)) return null;
    const stems = SIZE_SERVING_STEMS[token.toLowerCase().trim()];
    if (!stems) return null;

    let rows: Array<{ description: string; grams: number | null; isAiEstimated: boolean | null }>;
    try {
        const { prisma } = await import('../../db');
        rows = await prisma.fdcServing.findMany({
            where: { fdcId },
            select: { description: true, grams: true, isAiEstimated: true },
            orderBy: [{ description: 'asc' }, { id: 'asc' }],
        });
    } catch {
        return null;
    }

    const candidates = rows
        .filter(r =>
            r.grams != null && r.grams > 0 &&
            !FDC_YIELD_ROW_RE.test(r.description) &&
            servingDescriptionStartsWithStem(r.description, stems))
        .map(r => {
            const count = servingLeadingCount(r.description);
            return {
                perUnitGrams: (r.grams as number) / (count > 0 ? count : 1),
                genuine: !r.isAiEstimated,
                description: r.description,
            };
        })
        .filter(m => opts.maxPerUnitGrams == null || m.perUnitGrams <= opts.maxPerUnitGrams);

    if (candidates.length === 0) return null;

    const genuine = candidates.filter(m => m.genuine);
    const pool = genuine.length > 0 ? genuine : candidates;

    const rank = (m: { description: string }): number => {
        const body = stripServingLeadingCount(m.description).toLowerCase();
        if (stems.some(s => body === s.toLowerCase())) return 0;      // the bare unit row
        if (/\bmed(ium)?\b/.test(body)) return 1;                     // the middle of thin/medium/thick
        return 2;
    };
    const best = Math.min(...pool.map(rank));
    const finalists = pool.filter(m => rank(m) === best);
    return finalists.length === 1 ? finalists[0] : null;
}

/**
 * True when a search candidate carries a serving matching the requested
 * volume unit. Feeds the rerank serving-shape flag for cooked-grain volume
 * requests (n-serv-06): among cooked candidates, one that OWNS a cup serving
 * must beat one that would fall back to generic volume density.
 */
export function candidateHasVolumeServing(candidate: UnifiedCandidate, unit: string): boolean {
    if (candidate.source === 'fdc') {
        return !!candidate.servings?.some(s =>
            typeof s.grams === 'number' && s.grams > 0
            && servingDescriptionMatchesVolumeUnit(s.description, unit));
    }
    if (candidate.source === 'openfoodfacts') {
        const raw = candidate.rawData as { servingSize?: string | null; servingGrams?: number | null } | undefined;
        return typeof raw?.servingGrams === 'number' && raw.servingGrams > 0
            && servingDescriptionMatchesVolumeUnit(raw?.servingSize, unit);
    }
    return false;
}

// Plausible single-retail-unit bands for package quantities. 'ml' is the
// beverage archetype (a bottle/can/pouch someone counts as one drink); 'g'
// is capped low so multi-serve family packages (a 432g Oreo package) never
// pass as one piece — only single-serve cups/sticks/bars do.
const PACKAGE_BAND: Record<'ml' | 'g', { min: number; max: number }> = {
    ml: { min: 100, max: 1000 },
    g: { min: 20, max: 250 },
};

function packageGramsInBand(qty: number | null | undefined, unitKind: string | null | undefined): number | null {
    if (qty == null || (unitKind !== 'ml' && unitKind !== 'g')) return null;
    const band = PACKAGE_BAND[unitKind];
    return qty >= band.min && qty <= band.max ? qty : null;
}

/**
 * Median same-brand package quantity from the OFF product_quantity backfill
 * (Cluster A pt2 Defect 3). Lets "1 gatorade" resolve to ~a bottle even when
 * the matched SKU itself lacks package data — its brand siblings know. The
 * unit class (ml vs g) is decided by MAJORITY VOTE across in-band siblings:
 * Chobani's hundreds of 150g cups must outvote its handful of half-gallon
 * drinkables, and Gatorade's ml bottles outvote its powder tubs. Requires
 * >=2 sibling SKUs in the winning class.
 */
async function borrowSiblingPackageGrams(
    brandName: string | null | undefined
): Promise<number | null> {
    const brand = brandName?.trim();
    if (!brand) return null;
    try {
        const { prisma } = await import('../../db');
        const rows = await prisma.$queryRaw<Array<{ unit: string; med: number | null; n: number }>>`
            SELECT "packageQuantityUnit" AS unit,
                   percentile_cont(0.5) WITHIN GROUP (ORDER BY "packageQuantity") AS med,
                   count(*)::int AS n
            FROM "OffFood"
            WHERE "brandName" ILIKE ${brand}
              AND (("packageQuantityUnit" = 'ml' AND "packageQuantity" BETWEEN ${PACKAGE_BAND.ml.min} AND ${PACKAGE_BAND.ml.max})
                OR ("packageQuantityUnit" = 'g'  AND "packageQuantity" BETWEEN ${PACKAGE_BAND.g.min} AND ${PACKAGE_BAND.g.max}))
            GROUP BY 1
            ORDER BY count(*) DESC`;
        const winner = rows[0];
        if (!winner?.med || winner.n < 2) return null;
        return winner.med;
    } catch {
        return null;
    }
}

/**
 * Median same-brand LABEL serving (bare-serving defaults, Track 3 Jul 2026).
 * Within a brand's line the single-serving size is near-constant (all 15
 * IQ Bar SKUs label 45g; 148 Snickers SKUs median 39.8g), so when the matched
 * SKU's own servingGrams is NULL, garbage, or the flat-100g placeholder, the
 * sibling median answers a bare qty-1 request deterministically from real
 * label data. Band-restricted to single-serving scale and excludes exact-100g
 * rows (the per-100g placeholder would otherwise dominate many brands).
 * Requires >=3 in-band siblings so a bogus pair can't set the median.
 */
async function borrowSiblingLabelServing(
    brandName: string | null | undefined,
    selfBarcode: string,
): Promise<{ grams: number; samples: number } | null> {
    const brand = brandName?.trim();
    if (!brand || brand.length < 2) return null;
    try {
        const { prisma } = await import('../../db');
        const rows = await prisma.$queryRaw<Array<{ med: number | null; n: number }>>`
            SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY "servingGrams") AS med,
                   count(*)::int AS n
            FROM "OffFood"
            WHERE "brandName" ILIKE ${brand}
              AND barcode <> ${selfBarcode}
              AND "servingGrams" BETWEEN ${BARE_LABEL_MIN_GRAMS} AND ${BARE_LABEL_MAX_GRAMS}
              AND "servingGrams" <> 100`;
        const row = rows[0];
        if (!row?.med || row.n < 3) return null;
        return { grams: row.med, samples: row.n };
    } catch {
        return null;
    }
}

/**
 * Median NAME-GROUP label serving — the brandless twin of
 * borrowSiblingLabelServing (N1, item #16, Aug 2026). A brandless OFF row
 * ("Asparagus", "Big Mac") has 58.1% NULL servingGrams against branded rows'
 * 17.7% (measured 2026-08-05, `GROUP BY brandName IS NULL` over OffFood), and
 * the brand-keyed borrow above is structurally unreachable for it:
 * brandForBorrow falls back to the food name's FIRST TOKEN, so 'Asparagus'
 * queries `brandName ILIKE 'Asparagus'` and matches nothing.
 *
 * DELIBERATELY A SEPARATE FUNCTION, not a key-mode argument on the brand
 * borrow. MappingEventLog.servingTier is the only post-deploy instrument we
 * have, and merging the two mechanisms under one tier string makes the split
 * unmeasurable — the serving-cascade-divergence failure shape.
 *
 * Predicate notes, all measured 2026-08-05 and NOT free to "optimise":
 *  - `lower(name)`, not a case-sensitive `name =`. The indexed form is ~2,800x
 *    faster (0.132 ms vs 369 ms) but loses 43.7% of raise events, and 'a big
 *    mac' drops to n=2 and fails the n>=3 minimum. The seq scan is the price.
 *  - `duplicateOfBarcode`/`corruptReason` NULL: a name key concentrates
 *    near-duplicates by construction (dedupe-off-mark.ts marks rows sharing an
 *    exact name), so 18.9% of in-band siblings in the affected name groups
 *    carry one of these marks vs 10.9% corpus-wide.
 *  - The 3 g floor looks inert because the CALLER is raise-only against a 100 g
 *    floor, so the accepted OUTPUT range is (100, 400]. It is NOT inert on the
 *    INPUT rows, where it keeps sub-3 g garbage out of the median. Do not
 *    delete half this band. MAX=400 still binds (largest firing medians
 *    350/355).
 *  - `n >= 3`: n=3 carries 22.2% of RAISE events and only 5.1% of LOWER events,
 *    and 'a big mac' sits at exactly n=3. Raising to 5 costs 205 RAISE events.
 */
async function borrowNameSiblingLabelServing(
    foodName: string | null | undefined,
    selfBarcode: string,
): Promise<{ grams: number; samples: number; p25: number; p75: number } | null> {
    const nm = foodName?.trim();
    if (!nm || nm.length < 2) return null;
    try {
        const { prisma } = await import('../../db');
        const rows = await prisma.$queryRaw<
            Array<{ med: number | null; n: number; p25: number | null; p75: number | null }>
        >`
            SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY "servingGrams") AS med,
                   count(*)::int AS n,
                   percentile_cont(0.25) WITHIN GROUP (ORDER BY "servingGrams") AS p25,
                   percentile_cont(0.75) WITHIN GROUP (ORDER BY "servingGrams") AS p75
            FROM "OffFood"
            WHERE lower(name) = lower(${nm})
              AND barcode <> ${selfBarcode}
              AND "duplicateOfBarcode" IS NULL
              AND "corruptReason" IS NULL
              AND "servingGrams" BETWEEN ${BARE_LABEL_MIN_GRAMS} AND ${BARE_LABEL_MAX_GRAMS}
              AND "servingGrams" <> 100`;
        const row = rows[0];
        if (!row?.med || row.n < 3) return null;
        // p25/p75 come from the same aggregate as `med`, so a non-null med over
        // n >= 3 rows in a [3, 400] band implies both are non-null and >= 3. The
        // fallbacks exist so a NULL can never silently read as a TIGHT group
        // (p75 = Infinity, p25 = 0 both force isTightNameGroup false).
        return {
            grams: row.med,
            samples: row.n,
            p25: row.p25 ?? 0,
            p75: row.p75 ?? Number.POSITIVE_INFINITY,
        };
    } catch {
        return null;
    }
}

/**
 * Interquartile spread of a name group, as a RATIO so it is scale-free (a
 * cheese group at 28 g and a chicken group at 112 g are comparable).
 *
 * The threshold exists to separate two populations the RAISE-ONLY clamp at
 * rung (E) treats identically:
 *  - MIXTURES, which is what the clamp was justified on: `hot chocolate`
 *    (p75/p25 2.13, powder sachets vs made-up mugs), `pasta` (2.06, dry vs
 *    cooked). Their median is not a serving size, it is the midpoint of two
 *    different products, and billing it is worse than the floor.
 *  - CONVENTIONAL LABEL SERVINGS, which are near-uniform: `Broccoli florets`
 *    n=130 all 85 g (ratio 1.00), `Wide egg noodles` n=26 all 56 g (1.00),
 *    `Mature cheddar` n=17 all 30 g (1.00). For these the group median IS the
 *    label serving, and the 100 g floor is a bare literal outranking it.
 *
 * 1.5 measured 2026-08-05 over the 28-row #18 residual: it admits 20 and
 * excludes 8, and both raise-blocked exclusions (`hot chocolate`, `pasta`) are
 * the mixtures above. Re-derive with the p25/p75 query in
 * `sync-docs/reports/2026-08-05_the-raise-only-clamp-is-calibrated-on-the-wrong-population.md`.
 */
const NAME_GROUP_TIGHT_RATIO = 1.5;

/**
 * Exported for tests. A group is tight when its IQR ratio is <= the threshold.
 *
 * The `<= 0` and inverted-pair guards are load-bearing and each has a test that
 * dies without it (negative percentiles otherwise divide to a plausible ratio;
 * an inverted pair otherwise gets silently reordered into one). The `isFinite`
 * guard is deliberately redundant — verified by mutation on 2026-08-05, nothing
 * observes its removal, because every non-finite input already fails the checks
 * below or the comparison itself. It is kept because it is what makes the
 * Infinity sentinel in the borrow legible, and it is recorded as redundant here
 * so nobody later reads its presence as evidence of a case it handles alone.
 */
export function isTightNameGroup(p25: number, p75: number): boolean {
    if (!Number.isFinite(p25) || !Number.isFinite(p75)) return false;
    if (p25 <= 0 || p75 <= 0) return false;
    if (p75 < p25) return false;
    return p75 / p25 <= NAME_GROUP_TIGHT_RATIO;
}

// Exported for tests (tier cascade + bare-query guard wire-in).
export async function buildOffResult(
    candidate: UnifiedCandidate,
    parsed: ParsedIngredient | null,
    confidence: number,
    rawLine: string,
    /**
     * The HYDRATION allowance — its own pool, never the caller's last-resort
     * pool. This path was UNCAPPED before 2026-08-01 (the requestAiNutrition
     * call below passed no batch flag at all, so it was the one nutrition call
     * site the old module counter never saw); it was then briefly put on the
     * shared last-resort budget, which is worse than either extreme, because a
     * non-success outcome here makes this function `return null` and DELETE an
     * OFF candidate that already won retrieval. Under one shared pool, whether
     * that deletion happened depended on how many last-resort calls the other
     * items of the same `Promise.all` request had fired first — a
     * non-deterministic input to a STICKY FoodMapping row.
     * Optional so the existing four-arg test/probe callers keep compiling; they
     * get one per-call allowance each.
     */
    aiHydrationBudget: AiNutritionBudget = createAiNutritionBudget(AI_NUTRITION_HYDRATION_MAX_PER_REQUEST),
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
    // The density rule — liquid / paste / dry-granule category — is owned by
    // `resolveVolumeGrams()` in `src/lib/units/volume-density.ts`. This branch
    // carried a hand-copy of it until 2026-08-17 (lane B1a). It was the ONE
    // copy that had the paste tier, which is why the owner's cup/tbsp/tsp
    // constants came from here; measured cell-for-cell over 12 foods x 23 unit
    // keys, every cup/tbsp/tsp/dash/pinch value is identical to the copy it
    // replaces for every volume class, so this lane's 8,200 live `volume_unit`
    // events do not move.
    const volumeDensity = resolveVolumeGrams(candidate.name);
    const volumeToGrams: Record<string, number> = {
        ...pickVolumeUnits(volumeDensity.perUnit, OFF_VOLUME_UNIT_SPELLINGS),
        // PINNED, deliberately NOT converged, and the ONLY cell family where
        // this lane and the owner disagree: the owner scales ml/floz by the
        // same density it computed for cup/tbsp/tsp, and this lane bills them
        // flat. Converging is a CONSTANT change rather than a de-duplication —
        // the owner's own header says it belongs in its own commit with its own
        // gate — and it is not free in either direction. The owner is right
        // about `240 ml flour` (billed here at 240 g while `1 cup flour` of the
        // same food bills 127.2 g) and wrong about `250 ml red bull`, because
        // its LIQUID_RE misses cola, beer, coffee and energy drinks, so a
        // water-density beverage classifies SOLID and would bill 125 g. Those
        // 2 events are the only ml/floz traffic in the whole live `volume_unit`
        // population (8,200 events: cup 5,533, tbsp 2,059, tsp 606, ml 2,
        // floz 0 — measured 2026-08-17). The fix is on the classification side.
        'ml': 1, 'floz': 30, 'fl oz': 30,
    };

    let grams: number | null = null;
    let servingDescription: string | null = null;
    // Telemetry: which branch below billed the grams (MappingEventLog.servingTier).
    let servingTier: string | undefined;
    // Set when the item is a unitless integer count ("15 pretzels") for which no
    // per-piece weight could be resolved (no seed, no discrete-unit backfill, no
    // genuine label serving). Such counts must NOT bill the 100g no-serving
    // default per piece (15 x 100 = 1500g); the fallback bills one bounded
    // serving instead.
    let unitlessCountUnresolved = false;

    // Label serving unit info: e.g. label "2 scoops (46g)" → unit "scoop",
    // count 2, per-unit 23g. Divides multi-unit label servings so "2 scoops"
    // of a 46g/2-scoop product resolves to 46g, not 92g.
    const labelUnitCount = hydrated.servingUnitCount && hydrated.servingUnitCount > 0
        ? hydrated.servingUnitCount : 1;
    const labelUnitWord = extractLabelServingUnit(hydrated.servingDescription);
    const perLabelUnitGrams = hydrated.servingGrams && hydrated.servingGrams > 0
        ? hydrated.servingGrams / labelUnitCount : null;

    // THE RECORD'S OWN LABEL, WHEN THE REQUESTED UNIT IS THE LABEL'S UNIT AND
    // THAT UNIT IS A VOLUME UNIT (lane V2a, 2026-08-18). Non-null here demotes
    // the `volume_unit` class constant below so `label_unit_match` can bill it.
    //
    // WHY. `volumeToGrams` is a per-CLASS guess — liquid/paste/solid times a
    // density inferred from the NAME — and `resolveVolumeGrams()` takes only
    // name strings, so it cannot see the record. This record states the answer
    // for ITSELF. Until now the constant was tested first and the
    // `label_unit_match` branch below was UNREACHABLE for every volume unit: a
    // cereal whose own serving_size reads `1 cup (30 g)` billed 240 x 0.5 =
    // 120 g, 4x over, on the largest volume tier in the system (`volume_unit`,
    // 413 events / 7 days, 4.3% of all serving-tier traffic, all of it OFF).
    // The file already states this principle for PACKAGE_LIKE_UNITS below —
    // "the product's own label serving IS the thing the user asked for … trust
    // servingGrams over estimation" — and volume was simply never added to it.
    // No revision of the branch order carried a comment defending it.
    //
    // THE THREE GUARDS, all load-bearing:
    //
    // (1) `volumeToGrams[unit]` is RE-TESTED here. So this can only ever
    //     intercept a bill the `volume_unit` branch would have made, and the
    //     firing population is a strict subset of that tier. In particular
    //     `labelUnitWord`'s four other consumers cannot move:
    //     `usableBareLabelServing()` and the per-piece label branches all
    //     require NO unit — `isBareUnitlessQty1()` returns false the moment
    //     `parsed.unit` is set (bare-query-guard.ts:113) and the piece branches
    //     sit inside `else if (!unit && …)` — while this requires one twice.
    //
    // (2) THE DENSITY BAND, the same [VOLUME_SERVING_MIN_DENSITY,
    //     VOLUME_SERVING_MAX_DENSITY] `findOwnFdcVolumeServing()` puts on an
    //     FdcServing row, for the same reason and a stronger one: OFF labels
    //     are crowd-entered, so if USDA's curated rows need the band these need
    //     it more. A label reading `1 cup` against a 500 g serving implies
    //     2.08 g/ml — denser than honey, i.e. a package weight filed under a
    //     cup description. Reused rather than re-derived because it brackets
    //     every density `resolveVolumeGrams()` can itself produce — [0.36
    //     (oats), 1.0417 (paste)] — with more than 1.5x of slack on BOTH sides,
    //     so it can only refuse a label more extreme than the constant it then
    //     defers to. That bracketing is asserted, not asserted-by-comment, in
    //     `__tests__/off-label-volume-precedence.test.ts` block 5, which also
    //     pins these two constants through their other consumer.
    //
    // (3) A UNIT WITH NO `VOLUME_UNIT_ML` CELL IS REFUSED, not admitted
    //     unbanded — `ml`, `dash`, `pinch`. `dash`/`pinch` are ABSOLUTE cells
    //     (0.6 g / 0.3 g, "a pinch of anything is a pinch"), so a g/ml band is
    //     meaningless for them; holding `ml` out keeps the deliberate OFF
    //     flat-ml asymmetry pinned by `volume-unit-spellings.test.ts` block 4
    //     (`1000 ml flour` = 1000 g) bit-identical rather than quietly making
    //     it label-dependent. Costs 2 of this tier's 8,200 measured events.
    const labelVolumeUnitMl = unit ? VOLUME_UNIT_ML[singularizeUnit(unit)] : undefined;
    const ownLabelVolumeDensity = labelVolumeUnitMl && perLabelUnitGrams
        ? perLabelUnitGrams / labelVolumeUnitMl : null;
    const ownLabelBeatsVolumeConstant = !!(
        unit && labelUnitWord && perLabelUnitGrams
        && volumeToGrams[unit]
        && singularizeUnit(unit) === labelUnitWord
        && ownLabelVolumeDensity != null
        && ownLabelVolumeDensity >= VOLUME_SERVING_MIN_DENSITY
        && ownLabelVolumeDensity <= VOLUME_SERVING_MAX_DENSITY
    );

    // Bare-serving defaults (Track 3, Jul 2026): a digitless unitless qty-1
    // line asks for A SERVING. Deterministic resolution order:
    //   (1) the record's own in-band label serving ('bare_label_serving');
    //   (2) a count-noun piece when the NAME implies one (seed / discrete
    //       backfill branches below);
    //   (3) the same-brand sibling median label serving ('bare_sibling_serving');
    //   (4) bounded floor — never flat-100g for a discrete-piece name
    //       (wired in applyOffBareQueryGuard's REPLACE path).
    // The digit gate inside isBareUnitlessQty1 keeps "1 gatorade" / "3 almonds"
    // on the counted-resolution path — nothing below changes for them.
    const bareRequest = isBareUnitlessQty1(parsed, rawLine);
    const bareLabelGrams = bareRequest
        ? usableBareLabelServing(hydrated.servingGrams, labelUnitWord)
        : null;
    // Dose-measured categories (n-serv-37 sugar / n-serv-43 ghost pre workout
    // eval regressions): when the bare query IS a scoop/spoon-dosed category
    // (tail-anchored — "sugar", "ghost pre workout", "peanut butter"), the
    // own-label and sibling-median steps are SKIPPED so resolution flows to
    // the label/package tiers where the category CAP restores the tsp/scoop
    // dose default. Piece/tub foods (yoplait, snickers, pepper jack) are
    // unaffected: their categories are absent or oz/cup/can-based.
    const doseAnchored = bareRequest && isDoseAnchoredBareQuery(parsed?.name || '');

    // Units where the product's own label serving IS the thing the user asked
    // for ("1 container of yogurt" → the container size on the label). For these,
    // trust servingGrams over estimation.
    const PACKAGE_LIKE_UNITS = new Set([
        'serving', 'servings', 'portion', 'portions',
        'container', 'containers', 'packet', 'packets', 'package', 'packages',
        'pack', 'packs', 'bottle', 'bottles', 'jar', 'jars', 'pouch', 'pouches',
        'tub', 'tubs', 'box', 'boxes', 'bag', 'bags', 'sachet', 'sachets',
        'can', 'cans', 'carton', 'cartons',
    ]);

    // SKU's own net quantity (OFF product_quantity backfill, 207k rows).
    // Used ONLY when the label serving is absent — for multipack SKUs
    // product_quantity is the OUTER box (a 10-pouch Capri Sun = 1774ml), so
    // the label serving must always win when present. ml ≈ g is close enough
    // for beverages (±6%); PACKAGE_BAND keeps corrupt values and multi-serve
    // family packages out. When this SKU lacks package data, borrow the
    // same-brand median (Gatorade's siblings know a bottle is ~591ml).
    const packageGrams = packageGramsInBand(hydrated.packageQuantity, hydrated.packageQuantityUnit);
    // Brand for sibling-borrowing package sizes. OFF rows sometimes carry a
    // null brandName even for clearly branded products ("Celsius", "Chomps
    // original beef stick") — fall back to the food name's first token; the
    // borrow itself requires >=2 exact-brand-match SKUs with in-band package
    // data, which filters bogus guesses.
    const brandForBorrow = hydrated.brandName ?? (() => {
        const tok = (hydrated.foodName || '').trim().split(/\s+/)[0] ?? '';
        return tok.length >= 4 ? tok : null;
    })();
    let packageFallbackGrams: number | null = null;
    if (unit && PACKAGE_LIKE_UNITS.has(unit) && !(hydrated.servingGrams && hydrated.servingGrams > 0)) {
        packageFallbackGrams = packageGrams
            ?? await borrowSiblingPackageGrams(brandForBorrow);
    }

    if (unit && weightToGrams[unit]) {
        grams = qty * weightToGrams[unit];
        servingDescription = `${grams.toFixed(1)}g`;
        servingTier = 'weight_unit';
    } else if (unit && volumeToGrams[unit] && !ownLabelBeatsVolumeConstant) {
        // The per-CLASS density constant. Still the answer for every volume
        // request this record says nothing specific about — which is most of
        // them — but no longer the answer when the record's own label is stated
        // in the very unit that was asked for. See ownLabelBeatsVolumeConstant
        // above for the three guards on that demotion; when it is false this
        // branch is byte-for-byte what it has always been.
        grams = qty * volumeToGrams[unit];
        servingDescription = `${qty} ${unit}`;
        servingTier = 'volume_unit';
    } else if (unit && labelUnitWord && perLabelUnitGrams && singularizeUnit(unit) === labelUnitWord) {
        // Requested unit matches the product's OWN label serving unit — the label
        // is authoritative for THIS product. Use per-unit grams (label grams /
        // label unit-count) so a "2 scoops (46g)" tub yields 23g/scoop, not 46g.
        // Reached by VOLUME units too since 2026-08-18 (lane V2a) — a `1 cup
        // (30 g)` label bills 30 g here instead of 120 g above. The body did not
        // change to admit them: the divide by `labelUnitCount` that makes
        // "2 scoops (46g)" 23 g is the same one that makes "2 cups (480g)"
        // 240 g per cup.
        grams = qty * perLabelUnitGrams;
        servingDescription = `${qty} ${unit} (${perLabelUnitGrams.toFixed(1)}g each)`;
        servingTier = 'label_unit_match';
        logger.info('off.build_result.label_unit_matched', {
            foodId: candidate.id,
            unit,
            perUnitGrams: perLabelUnitGrams,
            labelUnitCount,
        });
    } else if (unit && PACKAGE_LIKE_UNITS.has(unit) && hydrated.servingGrams && hydrated.servingGrams > 0) {
        grams = qty * hydrated.servingGrams;
        servingDescription = `${qty} ${unit} (${hydrated.servingGrams}g each)`;
        servingTier = 'label_serving_package_unit';
    } else if (unit && PACKAGE_LIKE_UNITS.has(unit) && packageFallbackGrams != null) {
        // Package-like unit with NO label serving ("1 bottle gatorade" on a
        // SKU without servingGrams): the SKU's own net quantity — or the
        // same-brand median package — is the best available answer. Cluster A
        // pt2 Defect 3 (Jul 2026): these previously fell to the flat 100g
        // no-serving default.
        grams = qty * packageFallbackGrams;
        servingDescription = `${qty} ${unit} (${packageFallbackGrams.toFixed(0)}g each)`;
        servingTier = packageGrams != null ? 'package_quantity_own' : 'package_quantity_sibling';
        logger.info('off.build_result.package_quantity_fallback', {
            foodId: candidate.id,
            unit,
            packageGrams: packageFallbackGrams,
            ownLabel: packageGrams != null,
        });
    } else if (unit && (isAmbiguousUnit(unit) || classifyUnit(unit) === 'count')) {
        // Count/size/unknown units ("slice", "medium", "can", "knob", "rasher"):
        // deterministic count defaults + cached per-food servings + AI estimation.
        // brandForBorrow (not the raw, often-null brandName) so a "1 bar" on a
        // null-brand SKU can still reach the same-brand sibling-serving borrow
        // (count-noun sibling routing, Track 3 Jul 2026).
        const ambiguous = await getOrCreateAmbiguousServing(
            candidate.id, hydrated.foodName, unit, brandForBorrow
        );
        if ((ambiguous.status === 'success' || ambiguous.status === 'cached')
            && ambiguous.grams && ambiguous.grams > 0) {
            grams = qty * ambiguous.grams;
            servingDescription = `${qty} ${unit} (${ambiguous.grams.toFixed(1)}g each)`;
            servingTier = ambiguous.status === 'cached' ? 'count_unit_cached' : 'count_unit_ai';
            logger.info('off.build_result.unit_serving_resolved', {
                foodId: candidate.id,
                unit,
                perUnitGrams: ambiguous.grams,
                status: ambiguous.status,
            });
        } else {
            logger.warn('off.build_result.unit_serving_unresolved', {
                foodId: candidate.id,
                unit,
                error: ambiguous.error,
            });
        }
    } else if (!unit && parsed && Number.isInteger(parsed.qty) && parsed.qty >= 1) {
        // Unitless integer count ("3 baby carrots", "13 tortilla chips").
        const itemNameForCount = parsed.name || hydrated.foodName;

        // Bare-plural inversion (PR D pt3, A3): a digitless qty-1 plural
        // ("almonds", "goldfish") asks for A SERVING, not one piece —
        // per-piece resolution ((A) label count, (B) seed table, (C) discrete
        // unit backfill) would bill one almond (1.2g) or one grape (5g), so
        // all three are suppressed below. (D) package-count stays reachable:
        // the bare-query guard's CAP fixes its inflation. When the label
        // serving is a sane single-serving size, use it directly; otherwise
        // fall through to the label/floor defaults, where the bare-query
        // guard applies the category default.
        const barePluralRequest = isBarePluralRequest(parsed, rawLine, itemNameForCount);
        // Placeholder rejection (Track 3, Jul 2026): the flat-100g EU
        // per-100g pseudo-serving must not satisfy the plural band either —
        // "snickers" on a '1 portion (100 g)' SKU falls through to the
        // sibling-median step below instead of billing the placeholder.
        if (barePluralRequest && hydrated.servingGrams
            && hydrated.servingGrams >= 10 && hydrated.servingGrams <= 150
            && usableBareLabelServing(hydrated.servingGrams, labelUnitWord) != null) {
            grams = hydrated.servingGrams;
            servingDescription = `1 serving (${hydrated.servingGrams}g)`;
            servingTier = 'bare_plural_serving';
            logger.info('off.build_result.bare_plural_serving', {
                foodId: candidate.id,
                name: itemNameForCount,
                servingGrams: hydrated.servingGrams,
            });
        }

        // (1) OWN LABEL SERVING for a bare request (bare-serving defaults,
        // Track 3 Jul 2026): a digitless qty-1 line bills the record's own
        // single-serving-scale label directly, pre-empting every per-piece
        // divide below — "combos cheddar pretzel" must bill the 28g label,
        // not 28/9 per piece (A); "yoplait original strawberry" the 170g cup,
        // not the 12g strawberry seed (B). usableBareLabelServing already
        // rejected the flat-100g placeholder and garbage sub-3g metadata.
        // Dose-anchored categories skip this step: a sugar record's cup-
        // measure label must not outrank the 1-tsp default (n-serv-37).
        if (grams == null && !barePluralRequest && bareRequest && !doseAnchored
            && bareLabelGrams != null) {
            grams = bareLabelGrams;
            servingDescription = `1 serving (${bareLabelGrams}g)`;
            servingTier = 'bare_label_serving';
            logger.info('off.build_result.bare_label_serving', {
                foodId: candidate.id,
                name: itemNameForCount,
                servingGrams: bareLabelGrams,
            });
        }

        // (A) PRODUCT'S OWN LABEL COUNT — most authoritative. If the matched SKU's
        // label enumerates pieces ("14 chips (28g)", or the generic "15 pieces
        // (28g)" phrasing) and that piece is what the user is counting, derive
        // per-piece from the label (servingGrams / count). Self-adjusts per
        // product and uses count data present on ~64k OFF records that the
        // generic seed can only average. Gated tightly (packaged-snack piece
        // nouns + sane per-piece band; generic "pieces" additionally requires a
        // multi-piece label) so "13 chips" never divides by a "1 container
        // (170g)" label.
        const genericPieceNoun = labelUnitWord && GENERIC_PIECE_WORDS.has(labelUnitWord)
            && labelUnitCount >= 2 ? pieceNounInName(itemNameForCount) : null;
        const labelCountsUserPiece = labelUnitWord != null && (
            (LABEL_COUNT_PIECE_NOUNS.has(labelUnitWord) && labelPieceMatchesItem(labelUnitWord, itemNameForCount)) ||
            genericPieceNoun != null
        );
        if (
            grams == null &&
            !barePluralRequest &&
            perLabelUnitGrams != null && perLabelUnitGrams >= 0.2 && perLabelUnitGrams <= 500 &&
            labelCountsUserPiece
        ) {
            grams = qty * perLabelUnitGrams;
            servingDescription = `${qty} ${genericPieceNoun ?? labelUnitWord} (${perLabelUnitGrams.toFixed(1)}g each)`;
            servingTier = 'label_count_derived';
            logger.info('off.build_result.label_count_derived', {
                foodId: candidate.id,
                name: itemNameForCount,
                labelUnitWord,
                labelUnitCount,
                perPieceGrams: perLabelUnitGrams,
            });
        }

        // (B) GENERIC SEED TABLE — curated per-piece for common discrete items with
        // no usable label count (label serving for baby carrots is a ~100g portion,
        // not 1 carrot).
        if (grams == null && !barePluralRequest) {
            try {
                const { getDefaultCountServing } = await import('../../servings/default-count-grams');
                const countDefault = getDefaultCountServing(itemNameForCount, 'each');
                // Bare-request piece sanity (Track 3, Jul 2026): a digitless
                // qty-1 singular asks for A SERVING — a tiny per-piece seed
                // ("barebells caramel cashew" → the 1.5g cashew, bare
                // "almond" → 1.2g) must not answer it. Pieces >=20g (banana,
                // egg, bagel) ARE the serving and pass through.
                const bareTinyPiece = bareRequest && countDefault != null
                    && countDefault.grams < BARE_MIN_PIECE_SERVING_GRAMS;
                if (countDefault && countDefault.grams > 0 && !bareTinyPiece) {
                    grams = qty * countDefault.grams;
                    servingDescription = `${qty} each (${countDefault.grams.toFixed(1)}g each)`;
                    servingTier = 'seed_count_default';
                    logger.info('off.build_result.unitless_count_default', {
                        foodId: candidate.id,
                        name: itemNameForCount,
                        perPieceGrams: countDefault.grams,
                    });
                } else if (bareTinyPiece) {
                    logger.info('off.build_result.bare_tiny_piece_skipped', {
                        foodId: candidate.id,
                        name: itemNameForCount,
                        perPieceGrams: countDefault!.grams,
                    });
                }
            } catch {
                // fall through to discrete-unit backfill / label-serving / 100g defaults
            }
        }

        // No deterministic per-piece weight and no genuine label serving: if the
        // product names a discrete packaged item (a protein "bar", "cookie"...),
        // estimate that unit's weight via sibling-borrow / AI instead of the flat
        // 100g default (a 60g Quest bar must not log as 100g). For a bare
        // request this also runs when the record's serving is unusable (the
        // flat-100g placeholder / garbage band) — order step (2). Passes
        // brandForBorrow (not the raw, often-null brandName) so null-brand
        // SKUs can still reach the same-brand sibling-serving borrow.
        if (grams == null && !barePluralRequest
            && (!hydrated.servingGrams || hydrated.servingGrams <= 0
                || (bareRequest && bareLabelGrams == null))) {
            const discreteUnit = inferDiscreteUnit(parsed.name || hydrated.foodName);
            if (discreteUnit) {
                const amb = await getOrCreateAmbiguousServing(
                    candidate.id, hydrated.foodName, discreteUnit, brandForBorrow
                );
                if ((amb.status === 'success' || amb.status === 'cached') && amb.grams && amb.grams > 0) {
                    grams = qty * amb.grams;
                    servingDescription = `${qty} ${discreteUnit} (${amb.grams.toFixed(1)}g each)`;
                    servingTier = 'discrete_unit_backfill';
                    logger.info('off.build_result.discrete_unit_backfill', {
                        foodId: candidate.id,
                        unit: discreteUnit,
                        perUnitGrams: amb.grams,
                        status: amb.status,
                    });
                }
            }
        }

        // (C2) SAME-BRAND SIBLING MEDIAN LABEL SERVING — bare request whose
        // own label is unusable and whose name resolved no piece: borrow the
        // brand's median single-serving label ("snickers" on a placeholder-100
        // SKU → ~40g from 148 sibling bars; "barebells caramel cashew" → 55g).
        // Runs BEFORE the package fallback: a bare query prefers a sibling's
        // single-serving label over this SKU's multi-serve package weight
        // (airheads 85.78g pack class). Exception: an own ml-band package is
        // a discrete retail beverage ("gatorade" bottle) — drink-the-unit
        // semantics keep the package answer.
        // Plural bare requests may borrow ONLY on a real brand (snickers,
        // airheads): the name-token pseudo-brand ("Almonds" → brand 'almonds')
        // could match junk OFF brands for generic produce plurals.
        // Dose-anchored categories skip the borrow too: Ghost's 32.5g
        // two-scoop sibling median must not outrank the 1-scoop pre-workout
        // default (n-serv-43) — the package tiers + category CAP handle it.
        if (
            grams == null && bareRequest && !doseAnchored
            && (!barePluralRequest || hydrated.brandName != null)
            && bareLabelGrams == null && brandForBorrow
            && !(hydrated.packageQuantityUnit === 'ml' && packageGrams != null)
        ) {
            const sibling = await borrowSiblingLabelServing(
                brandForBorrow, candidate.id.replace(/^off_/, '')
            );
            if (sibling != null) {
                grams = sibling.grams;
                servingDescription = `1 serving (~${sibling.grams.toFixed(0)}g, brand median)`;
                servingTier = 'bare_sibling_serving';
                logger.info('off.build_result.bare_sibling_serving', {
                    foodId: candidate.id,
                    brand: brandForBorrow,
                    grams: sibling.grams,
                    samples: sibling.samples,
                });
            }
        }

        // (D) WHOLE-PACKAGE COUNT — "1 gatorade", "2 celsius": a unitless count
        // of a BRANDED packaged product that names no piece noun is a count of
        // retail units. Bill the SKU's own net quantity, or the same-brand
        // median package when this SKU lacks it (Cluster A pt2 Defect 3,
        // Jul 2026 — previously the flat capped-100g default). Gated to
        // branded, label-serving-less matches and PACKAGE_BAND sizes, so
        // "2 oreos" can never bill two 432g family packages.
        if (
            grams == null && brandForBorrow
            && (!hydrated.servingGrams || hydrated.servingGrams <= 0)
            && pieceNounInName(itemNameForCount) == null
        ) {
            const pkg = packageGrams
                ?? await borrowSiblingPackageGrams(brandForBorrow);
            if (pkg != null) {
                grams = qty * pkg;
                servingDescription = `${qty} package (${pkg.toFixed(0)}g each)`;
                servingTier = packageGrams != null ? 'package_count_own' : 'package_count_sibling';
                logger.info('off.build_result.package_count', {
                    foodId: candidate.id,
                    name: itemNameForCount,
                    perPackageGrams: pkg,
                    ownLabel: packageGrams != null,
                });
            }
        }

        // Still no per-piece weight for a counted item: flag it so the fallback
        // below bills a single bounded serving instead of 100g * count.
        if (grams == null) {
            unitlessCountUnresolved = true;
        }
    }

    if (grams == null || servingDescription == null) {
        if (hydrated.servingGrams && hydrated.servingGrams > 0) {
            // Genuine label serving exists: honor the count against it. For a
            // discrete item whose piece IS its serving this is correct ("2 rx
            // bars" -> 2 x 52g = 104g); the per-piece defect only bites when
            // there is NO serving at all (handled below).
            grams = qty * hydrated.servingGrams;
            servingDescription = `${qty} serving (${hydrated.servingGrams}g each)`;
            servingTier = 'label_serving_default';
        } else if (unitlessCountUnresolved) {
            // Unitless count with NO per-piece weight AND no label serving: we
            // cannot honor the count, so bill ONE bounded 100g serving rather
            // than 100g * count. This stops the long tail of unseeded count
            // foods from exploding into kilograms ("15 pretzels" was 1500g).
            grams = 100;
            servingDescription = `1 serving (count unresolved, 100.0g)`;
            servingTier = 'count_unresolved_floor';
            logger.info('off.build_result.unitless_count_unresolved_capped', {
                foodId: candidate.id,
                requestedQty: qty,
                billedGrams: grams,
            });
        } else {
            grams = 100 * qty;
            servingDescription = `${grams.toFixed(1)}g`;
            servingTier = 'flat_100g_default';
        }
    }

    // Bare-query serving guard (PR D pt3, Lever A): a bare unitless qty-1
    // request that the cascade above billed at package scale or a fabricated
    // floor is overridden to the category default. Runs AFTER the whole tier
    // cascade (no branch above changes); null keeps the cascade's result.
    const bareOverride = applyOffBareQueryGuard({
        grams,
        servingTier,
        parsed,
        rawLine,
        queryName: parsed?.name || '',
        foodName: hydrated.foodName,
        servingDescription,
    });
    if (bareOverride) {
        logger.info('off.build_result.bare_category_default', {
            foodId: candidate.id,
            previousTier: servingTier,
            previousGrams: grams,
            grams: bareOverride.grams,
        });
        grams = bareOverride.grams;
        servingDescription = bareOverride.servingDescription;
        servingTier = bareOverride.servingTier;
    }

    // (E) NAME-GROUP SIBLING MEDIAN, RAISE-ONLY. Reaching here still stamped
    // 'count_unresolved_floor' means every rung above AND the category lexicon
    // (applyOffBareQueryGuard runs first and stamps its own tier) had no answer:
    // no label, no package, no piece seed, no lexicon default. The 100 is a bare
    // literal, not data.
    //
    // This rung is deliberately BELOW the guard. At rung (C2) a borrow is
    // guard-EXEMPT ('bare_sibling_serving' is in none of CAP_TIERS /
    // HEAD_GATED_CAP_TIERS / REPLACE_TIERS) and therefore pre-empts
    // bare_category_default, label_serving_default and package_count_*; measured
    // 2026-08-05, that lowers 207 events, 196 of them `coca cola` 355 -> 275.
    //
    // RAISE-ONLY BY DEFAULT: a name group is usually a MIXTURE (asparagus 85 g,
    // blueberries 62.5 g, strawberries 65.0 g — dried/freeze-dried products
    // dominate), and the downward half is worse than the floor it would replace.
    //
    // The one exception is a TIGHT group (`isTightNameGroup`, p75/p25 <= 1.5),
    // which is not a mixture at all but a conventional label serving repeated
    // across near-identical SKUs. There the clamp is the defect: it pins a
    // 130-row group of `Broccoli florets` that all declare 85 g to a bare 100 g
    // literal. Lowering is allowed ONLY for those, and stamps a SEPARATE tier
    // so the two directions stay independently measurable — merging them would
    // repeat the serving-cascade-divergence mistake this rung's own borrow
    // function documents.
    //
    // A BARE PLURAL takes the tight test in BOTH directions, and that is the
    // whole of its admission rule. `isBarePluralRequest` exists to suppress
    // PER-PIECE resolution — label count, seed table, discrete-unit backfill,
    // the grapes-5g / m&ms-0.9g class — and its own contract says such a
    // request "must fall through to serving-scale tiers". This rung IS a
    // serving-scale tier: it borrows the median DECLARED SERVING of same-named
    // records. Applying a per-piece suppressor to it was over-broad.
    //
    // Tightness, not direction, is what makes a plural median safe, and that
    // was measured rather than argued (2026-08-05, over the 13 plural-blocked
    // rows of #18's residual): 7 are tight and every one of them is a
    // conventional serving — `Wide egg noodles` 56 g (2 oz dry, ratio 1.00),
    // `Broccoli florets` 85 g (1 cup, 1.00), `Cod fillets` 113 g (4 oz, 1.01),
    // `Chicken tenderloins` 112 g (1.01). The 6 dispersed ones are exactly the
    // mixtures the clamp was built for (`roasted red peppers` 4.33, `frozen
    // mozzarella sticks` 4.33). DIRECTION does not separate them — only 2 of
    // the 7 repairs are RAISES — so a direction rule admits mixtures and
    // rejects real servings in both directions at once.
    //
    // This is also what keeps the `grapes` pin green, and on the real corpus
    // rather than by accident: `Grapes` measures n=8, median 142 g, ratio 1.71
    // — genuinely a mixture of bunches and portions, so it is rejected for the
    // reason the clamp names. A bare relaxation bills it 142 g. Highest
    // admitted ratio is 1.29 and lowest rejected 1.69, so 1.5 sits in open
    // space here (it binds at 1.49 for the singular arm — a tighter margin).
    //
    // The plural arm stamps its own tier so the new population is countable
    // and revertible on its own. It needs no direction suffix: this rung only
    // runs on `count_unresolved_floor` + `bareRequest`, where `grams` is always
    // the flat 100 literal, so the tier's own grams read the direction (>100
    // raise, <100 lower) — which is how the singular pair reads live today.
    //
    // The tier gate structurally implies five of rung (C2)'s own clauses, which
    // are therefore NOT restated here: grams == null (by construction of the
    // branch that stamped the tier), bareLabelGrams == null (345 of 345 zone
    // records have servingGrams NULL or <= 0), !doseAnchored (a non-null
    // getBareQueryDefault would have fired the guard's REPLACE path and changed
    // the tier), the ml drink-the-unit exception (1 record / 1 event in the
    // zone), and "the guard already declined". All measured 2026-08-05.
    if (
        servingTier === 'count_unresolved_floor'
        // Excludes 113 digit-line floor events: for "15 pretzels" a 30 g median
        // billed once is WORSE than the floor.
        && bareRequest
        // Leaves 64 branded digitless floor events to rung (C2), which already
        // ran against their real brand and returned n < 3.
        && hydrated.brandName == null
    ) {
        // Recomputed rather than hoisted: barePluralRequest/itemNameForCount are
        // block-scoped inside the unitless-count branch, and hoisting them
        // changes rung-(C2) ordering. Computed inside the block, not in the
        // condition, because it is no longer a gate — only a policy selector.
        const barePlural = isBarePluralRequest(
            parsed, rawLine, parsed?.name || hydrated.foodName
        );
        const nameSib = await borrowNameSiblingLabelServing(
            hydrated.foodName, candidate.id.replace(/^off_/, '')
        );
        const tightGroup = nameSib != null && isTightNameGroup(nameSib.p25, nameSib.p75);
        // SINGULAR: raise unconditionally, lower only into a tight group (#252).
        // PLURAL:   tight group only, either direction.
        // `grams !== grams` is impossible to reach for the singular arm (both of
        // its disjuncts already imply a move) and is stated once here so the
        // plural arm cannot stamp a tier on a median that equals the floor.
        const admitted = nameSib != null
            && nameSib.grams !== grams
            && (barePlural ? tightGroup : (nameSib.grams > grams || tightGroup));
        if (nameSib != null && admitted) {
            const tier = barePlural
                ? 'bare_name_sibling_serving_plural'
                : nameSib.grams < grams
                    ? 'bare_name_sibling_serving_tight'
                    : 'bare_name_sibling_serving';
            grams = nameSib.grams;
            servingDescription = `1 serving (~${nameSib.grams.toFixed(0)}g, name median)`;
            servingTier = tier;
            logger.info(`off.build_result.${tier}`, {
                foodId: candidate.id,
                name: hydrated.foodName,
                grams: nameSib.grams,
                samples: nameSib.samples,
                p25: nameSib.p25,
                p75: nameSib.p75,
            });
        }
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
            servingTier,
        };
    }

    // 4. AI nutrition backfill (Atwater gate rejected label data)
    if (!AI_NUTRITION_BACKFILL_ENABLED) {
        logger.warn('off.build_result.no_nutrients_no_backfill', { foodId: candidate.id });
        return null;
    }

    const aiNutrition = await requestAiNutrition(hydrated.foodName, { rawLine, budget: aiHydrationBudget });
    if (aiNutrition.status !== 'success') {
        // Budget exhaustion is called out separately from every other AI
        // failure BECAUSE it is the only one whose cause is outside this
        // candidate: the record is fine, we simply ran out of allowance, and
        // the `return null` below silently hands the line to a different
        // record. That is the residual coupling the split allowance is meant to
        // make unreachable — so it is logged at audit level, and a non-zero
        // count of this event is the signal to raise
        // AI_NUTRITION_HYDRATION_MAX_PER_REQUEST / _PER_BATCH.
        if (aiNutrition.reason === 'nutrition_budget_exhausted') {
            logger.audit('off.build_result.hydration_budget_exhausted', {
                foodId: candidate.id,
                foodName: hydrated.foodName,
                spent: aiHydrationBudget.spent,
            });
        }
        logger.warn('off.build_result.ai_nutrition_failed', {
            foodId: candidate.id,
            reason: aiNutrition.reason,
        });
        return null;
    }

    return {
        // `source` here is the PIPELINE STAGE, not a provider claim — the parse
        // route derives provenance from the foodId prefix instead, which for an
        // `off_` id means Open Food Facts. Every macro below came from the model,
        // so `panelFromAi` is what stops that prefix from rendering an ODbL credit
        // over numbers OFF did not supply. Do not "fix" this by changing `source`:
        // resolveFoodDetails() never reads it.
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
        servingTier,
        panelFromAi: true,
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
    const { isDiscreteItem } = require('../serving-backfill');
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
    const { classifyUnit, isGenericServing } = require('../unit-type');

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
    // Genuinely-unknown (uncatalogued) units — e.g. "knob", "rasher", "glug",
    // "ramekin" — must never match an existing or generic serving. Force a null
    // return so the caller routes them to AI weight estimation (the ambiguous-unit
    // backfill), instead of this selector handing back a wrong generic 100g serving.
    if (isEstimableUnknownUnit(effectiveUnit)) {
        logger.info('selectServing.estimable_unknown_unit_forcing_ai', {
            effectiveUnit,
            foodName,
        });
        return null;
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
            const { inferCategoryFromName, categoryDensity } = require('../../units/density');
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

// Called by the mapper's staying admission/rerank code; exported as a list (not
// inline) so the function bodies stay byte-identical to the pre-extraction tree
// that winner-diff.ts's helpers hash pins.
export { candidateHasCountLabel, requestBillsByServing, candidateHasServingData, isMatchableVolumeUnit };
