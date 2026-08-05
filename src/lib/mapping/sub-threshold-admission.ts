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
 * Class 1 is handled directly: when the query decisively names a brand, the
 * record must carry it. Classes 2 and 3 are not detectable this way — and,
 * measured, they do not need to be.
 *
 * ## The blast-radius guarantee is insert-only, NOT the brand requirement
 *
 * A first version of this fix required a brand on every admission, reasoning
 * that `deriveMappingCacheKey` prefixes the key with the brand under the same
 * `hasDecisiveBrandContext` predicate, so an admitted pick could never address
 * a bare generic key. The guarantee was sound. The fix was useless: warming 369
 * real seeds through it admitted **zero** rows, because the under-gate
 * population is overwhelmingly UNBRANDED — `ground beef 90/10` (0.78),
 * `ground turkey` (0.83), `canned tuna in water` (0.84), `shrimp and grits`
 * (0.75), `blueberry pancakes` (0.64). The funnel's own confirmed-good discards
 * (`ground turkey` -> 85% lean ground turkey, `baked salmon` -> Baked or
 * Broiled Salmon) are exactly the rows a brand requirement excludes.
 *
 * So the requirement is replaced with the guarantee it was standing in for.
 * The failure that closed fix 3 (PR #143) was DISPLACEMENT: a widened gate
 * repointed the eight most-used generic keys in the cache (`egg`, `broccoli`,
 * `chicken`, `salmon`, ...) and broke five golden cases. But the drops this fix
 * converts are cache MISSES — by construction there is no incumbent to lose.
 *
 * Hence `insertOnly`: an admitted sub-threshold pick may CREATE a cache row and
 * may never OVERWRITE one. A pick the cascade was only 78% sure of cannot
 * evict a row that some higher-confidence pick already earned, so no currently-
 * passing lookup can regress. The worst case is a new row on a key that
 * previously had none — still subject to all seven save gates, and visible to
 * the eval gate.
 *
 * Everything admitted still faces those gates; this only decides what gets
 * offered to them.
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

/**
 * The confidence written when simpleRerank() DECLINED to name a winner.
 *
 * Re-exported here, rather than declared here, so that all three save-gate
 * constants are importable — and assertable — from one module (T1 in
 * `__tests__/sub-threshold-admission.test.ts` pins 0.78 against the floor above
 * and the threshold above that). The value and the full derivation of why it is
 * 0.78 live in `./declined-confidence`, which is a LEAF module with no imports.
 *
 * It has to be a leaf: `gather-candidates.ts` needs the same constant for the
 * basic_produce_bypass exit, and importing it from THIS file closes the cycle
 * gather-candidates -> sub-threshold-admission -> simple-rerank ->
 * modifier-constraints -> gather-candidates, which leaves
 * MODIFIER_SYNONYM_GROUPS undefined at module-eval time. tsc and eslint pass
 * through that cycle; only the test suite catches it.
 */
export { RERANK_DECLINED_CONFIDENCE } from './declined-confidence';

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
    const queryAssertsBrand = !!brand && hasDecisiveBrandContext(rawLine, brand);

    // Class 1, cross-brand substitution: when the query DOES name a brand, the
    // record must be that company's product — `buffalo wild wings traditional
    // wings` must not cache Zaxby's. An unbranded query asserts no brand and so
    // has nothing to contradict; it is admitted on the insert-only guarantee.
    if (queryAssertsBrand && !candidateMatchesTargetBrand(brandName ?? undefined, foodName, brand!)) {
        return { admit: false, reason: 'record_lacks_query_brand' };
    }

    // Never widen the door for the degenerate-nutrition class that fix 1 closed.
    if (!nutrientsPer100g) return { admit: false, reason: 'no_macros' };
    if (isAllZeroMacros(nutrientsPer100g)) return { admit: false, reason: 'degenerate_macros' };

    return { admit: true };
}
