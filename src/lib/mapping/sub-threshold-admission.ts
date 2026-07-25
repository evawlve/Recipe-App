/**
 * Conditional admission of picks that sit just under the 0.85 cache-save gate
 * (funnel fix 4).
 *
 * The first funnel read (sync-docs/funnel_first_read_2026-07-24.md) measured
 * the silent `under_gate` population for the first time: of 100 blocked picks,
 * **56 were good data thrown away**, and the population is CLUSTERED just
 * under the bar rather than spread along it — 67 sit at >= 0.75, 99 at >= 0.60.
 * A confidence gate that discards a majority of good picks in its top decile is
 * not separating signal from noise there.
 *
 * But lowering the flat number is the wrong move, because the 44 bad ones fall
 * into three deterministically detectable classes:
 *
 *   1. cross-brand substitution — `buffalo wild wings traditional wings` ->
 *      Zaxby's, `chipotle burrito` -> Pollen + Grace, `chilis chips and salsa`
 *      -> Uncle Ray's.
 *   2. composite-dish undercount — `spaghetti and meatballs` -> meatballs
 *      alone, `arbys roast beef sandwich` -> the *No Bun* SKU.
 *   3. product-form slip — `meyer lemon` -> lemon syrup, `injera` -> crisps,
 *      `mac and cheese` -> dry raw macaroni.
 *
 * The observation that makes class 1 tractable: **good rows almost always have
 * the record's brand matching a brand token in the query.** So admission is
 * restricted to queries that decisively name a brand AND resolve to a record
 * carrying it. That admits the clean half (`a and w root beer` -> Root Beer
 * [A&W] at 0.81, `dymatize casein` -> Elite Casein [Dymatize] at 0.83) and
 * rejects every named member of class 1. Classes 2 and 3 are overwhelmingly
 * unbranded queries, so requiring a brand excludes them wholesale rather than
 * by trying to detect them.
 *
 * ## Why the brand requirement is a blast-radius guarantee, not just a filter
 *
 * This is the lesson of the abandoned fix 3 (PR #143), which widened a save
 * gate and silently repointed the eight most-used generic keys in the cache
 * (`egg`, `broccoli`, `chicken`, `salmon`, ...), breaking five golden cases.
 * The waiver had no structural bound on WHICH rows it could touch.
 *
 * Here there is one. `deriveMappingCacheKey` prefixes the cache key with the
 * brand under exactly this predicate — `hasDecisiveBrandContext` — and when it
 * declines to prefix, it is because the brand tokens are already present in the
 * key. Either way an admitted pick's key provably CONTAINS a brand token, so it
 * can never be the bare generic key (`egg`, `chicken`) that the golden set
 * asserts on. Admission cannot displace those rows because it cannot address
 * them.
 *
 * Everything admitted still faces all seven save gates in
 * `saveValidatedMapping` — this only decides what gets offered to them.
 */

import { hasDecisiveBrandContext, candidateMatchesTargetBrand } from './simple-rerank';
import { isAllZeroMacros } from './macro-plausibility';
import type { MacroPlausibilityInput } from './macro-plausibility';

/**
 * The floor for conditional admission.
 *
 * 0.75 is where the measured population stops being clustered: 67 of the 100
 * blocked picks sit at or above it. Below that the density keeps rising all the
 * way to 0.60 (99 of 100), which is a different regime — those are picks the
 * cascade is genuinely unsure about, not near-misses.
 */
export const SUB_THRESHOLD_SAVE_FLOOR = 0.75;

/** The long-standing gate this is a conditional relaxation of. */
export const SAVE_CONFIDENCE_THRESHOLD = 0.85;

export interface SubThresholdAdmissionInput {
    /** The raw user line, used for brand-context adjudication. */
    rawLine: string;
    confidence: number;
    /** Brand detection for the request (request-stable, pre-AI-upgrade). */
    brandDetection?: { isBranded?: boolean; matchedBrand?: string | null } | null;
    /** The picked record's name and brand field. */
    foodName: string;
    brandName?: string | null;
    /** Per-100g macros of the pick, or undefined when grams <= 0. */
    nutrientsPer100g?: MacroPlausibilityInput;
}

export interface SubThresholdAdmissionResult {
    admit: boolean;
    /** Populated only when admit is false, for funnel/debug attribution. */
    reason?:
    | 'above_threshold'
    | 'below_floor'
    | 'no_decisive_brand'
    | 'record_lacks_query_brand'
    | 'degenerate_macros'
    | 'no_macros';
}

/**
 * Decide whether a pick below the 0.85 gate may still be offered to the cache.
 *
 * Returns `admit: false` with `reason: 'above_threshold'` for picks at or above
 * the gate — those are already admitted by the caller's own check, and this
 * function deliberately does not claim them.
 */
export function assessSubThresholdAdmission(
    input: SubThresholdAdmissionInput,
): SubThresholdAdmissionResult {
    const { rawLine, confidence, brandDetection, foodName, brandName, nutrientsPer100g } = input;

    if (confidence >= SAVE_CONFIDENCE_THRESHOLD) return { admit: false, reason: 'above_threshold' };
    if (!(confidence >= SUB_THRESHOLD_SAVE_FLOOR)) return { admit: false, reason: 'below_floor' };

    // A brand the query asserts, not merely one the lexicon spotted. Several
    // grocery chains share a name with a plain food word ("sprouts"), so a bare
    // matchedBrand would admit unbranded whole-food queries — and with them the
    // ability to address a bare generic cache key.
    const brand = brandDetection?.isBranded
        ? brandDetection.matchedBrand?.trim().toLowerCase()
        : undefined;
    if (!brand || !hasDecisiveBrandContext(rawLine, brand)) {
        return { admit: false, reason: 'no_decisive_brand' };
    }

    // Class 1, cross-brand substitution: the query names a brand and the record
    // is a DIFFERENT company's product.
    if (!candidateMatchesTargetBrand(brandName ?? undefined, foodName, brand)) {
        return { admit: false, reason: 'record_lacks_query_brand' };
    }

    // Never widen the door for the degenerate-nutrition class that fix 1 closed.
    if (!nutrientsPer100g) return { admit: false, reason: 'no_macros' };
    if (isAllZeroMacros(nutrientsPer100g)) return { admit: false, reason: 'degenerate_macros' };

    return { admit: true };
}
