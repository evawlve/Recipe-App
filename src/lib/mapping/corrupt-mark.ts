/**
 * corrupt-mark.ts — shared logic for the OffFood.corruptReason marking system.
 *
 * Two corpus scans feed the marker (scripts/mark-corrupt-off.ts):
 *   - scripts/eval/detect-corrupt-panel.ts — records whose stored per-100g
 *     panel is really a per-serving panel (rescaling by 100/servingGrams
 *     lands on the same-name sibling median);
 *   - scripts/eval/detect-corrupt-nutrition.ts — per-field impossibilities
 *     and scale slips, plus the sibling-FREE panel-inflated-serving rule (the
 *     same per-serving-panel corruption as above, caught from the row alone for
 *     the name-space singletons the sibling median cannot reach): kcal above the physical ceiling, macro sums over
 *     100 g/100g, sodium above pure salt (the mg-entered-as-g family),
 *     kJ-values-in-the-kcal-field Atwater mismatches, and sodium sibling
 *     outliers (the mayonnaise 5.33 g/100g class from the 2026-07-21
 *     nutrition re-verify).
 * Retrieval then excludes marked rows (Typesense sync WHERE clause +
 * live-index purge + PG fallback filter) and the mapper escapes cache rows
 * that point at them.
 *
 * This module holds the pure decision rules so the marker script and jest can
 * share them, plus the runtime kill-switch used by the exclusion sites.
 *
 * Layering note: the curated 25-barcode denylist (corrupt-denylist.ts) stays a
 * separate rank-time layer. Several of its entries are current golden winners
 * for SEARCH cases (s-brand-05/08, n-sem-02 replacement, n-supp-10 twins), so
 * they must remain in the Typesense index for manual search; corruptReason
 * rows, by contrast, are removed from the index entirely.
 */

/** Kill-switch: set CORRUPT_RECORD_EXCLUSION=0 to stop filtering marked rows
 *  at the PG fallback and to disable the cache-row escape. Index-level
 *  exclusion (sync WHERE + purge) is data-level and not affected. */
export function isCorruptExclusionEnabled(): boolean {
    return process.env.CORRUPT_RECORD_EXCLUSION !== '0';
}

export type CorruptDirection =
    // detect-corrupt-panel.ts
    | 'panel-low'
    | 'panel-inflated'
    | 'panel-inflated-family'
    // detect-corrupt-nutrition.ts
    | 'panel-inflated-serving'
    | 'kcal-impossible'
    | 'macro-sum-impossible'
    | 'fiber-impossible'
    | 'sugars-impossible'
    | 'sodium-impossible'
    | 'sodium-implausible'
    | 'kj-as-kcal'
    | 'sodium-sibling-outlier';

/** Staleness re-check payload: which live field the marker must compare
 *  against the scan-time value before writing (the corpus may have changed).
 *  'macroSum' is computed as protein + fat + carbs from the live row. */
export interface CorruptScanCheck {
    field: 'calories' | 'sodium' | 'macroSum' | 'fiber' | 'sugars';
    value: number;
}

/** One entry of a detect-corrupt-*.ts scan output (results/corrupt-*-scan-*.json).
 *  Panel flags fill kcal100/rescaled/siblingMedian/groupSize; nutrition-scale
 *  flags carry the offending value in `value` (plus `ratio` where the rule is
 *  ratio-based) and always provide `check`. For sodium-sibling-outlier,
 *  siblingMedian/groupSize describe the sibling SODIUM distribution (g/100g),
 *  not kcal. */
export interface CorruptScanFlag {
    barcode: string;
    name: string;
    brandName: string | null;
    kcal100: number;
    servingGrams: number | null;
    tier: 'direct' | 'sibling-serving';
    direction: CorruptDirection;
    rescaled: number;
    siblingMedian: number;
    groupSize: number;
    triageConfirmed: boolean;
    value?: number;
    ratio?: number;
    check?: CorruptScanCheck;
    /** panel-inflated-serving only: the raw inputs the rule is computed from, so
     *  decideMark() can re-run the entire rule instead of trusting `value`. */
    panel?: ServingScalePanel;
    /** panel-inflated-family only: the group-quality measurements the family
     *  tier rests on, so decideMark() can re-derive the whole verdict from
     *  measurements rather than trusting the scan's conclusion. */
    family?: FamilyGroupEvidence;
}

/** The family-tier reference distribution, as measured at scan time.
 *  `relMad` is median(|x - med|) / med over the family's kcal100 values — a
 *  dispersion measure that is robust to the corrupt members themselves. */
export interface FamilyGroupEvidence {
    /** family grouping key the row was scored against (audit trail only) */
    key: string;
    relMad: number;
    /** UNROUNDED family median. CorruptScanFlag.siblingMedian is rounded for
     *  display, and rounding a small median (a 0.3 kcal/100g diet-soda family)
     *  changes the verdict, so re-verification reads this field. */
    median: number;
}

/** Raw per-100g panel plus the row's own serving mass — the complete input set
 *  of the panel-inflated-serving rule. Carried on the flag so the marking script
 *  re-derives the verdict from measurements, never from the scan's conclusion. */
export interface ServingScalePanel {
    kcal100: number;
    servingGrams: number;
    protein: number;
    fat: number;
    carbs: number;
}

/** Physical ceiling for a trustworthy sibling median. Pure fat is ~900 kcal/100g;
 *  a group median above this means the SIBLINGS are corrupt (kJ-as-kcal family)
 *  and a panel-low flag against them is inverted — the flagged row is the sane one. */
export const MAX_TRUSTABLE_SIBLING_MEDIAN = 920;

/** panel-inflated flags lean entirely on the sibling distribution; small groups
 *  are dominated by a few bad rows. Triage review set this floor. */
export const MIN_INFLATED_GROUP_SIZE = 8;

// ---- panel-inflated-family thresholds (COARSER-GROUPING per-serving-panel rule) ----
//
// Same defect as `panel-inflated`: a per-SERVING / whole-container panel stored
// in the per-100g fields, so kcal100 sits ~servingGrams/100 ABOVE the family's
// true density. What differs is only HOW SIBLINGS ARE FOUND.
//
// `panel-inflated` groups by exact normalizeNameKey() equality, which is a
// token-SET identity: one extra brand or flavour token puts a row in its own
// group. Measured on the live corpus 2026-07-31 (scripts/eval/_probe_group_sizes
// methodology, reproduced by detect-corrupt-panel.ts's own pass-1 counters):
// 661,150 of 1,083,139 kcal-bearing rows (61.0%) sit in groups below MIN_GROUP=4
// and are therefore never signature-tested at all, rising monotonically with
// name length — 25.5% at one token to 98.3% at eight or more. The family tier
// groups on the row's DISCRIMINATIVE tokens instead, which reaches those rows.
//
// A coarser group is a WEAKER reference, so every threshold below is stricter
// than the exact-key tier's, and each one is set from a measured false-positive
// audit rather than by inspection (see detect-corrupt-panel.ts's header).

/** The family reference must be a real product family, not one fused ingredient
 *  word. Measured: allowing single-token families takes the flag set from 201 to
 *  731 rows, and the 530 additions are dominated by correct densities scored
 *  against a fused median (beef tenderloin 229 kcal/100g vs a `filet` median of
 *  132; root beer 45 kcal/100ml vs an `ale` median of 37). */
export const FAMILY_MIN_TOKENS = 2;
/** Larger than MIN_INFLATED_GROUP_SIZE's motivation but the same value: a coarse
 *  group needs at least as many members as an exact one before its median is
 *  load-bearing. */
export const FAMILY_MIN_GROUP = 8;
/** median(|x - med|)/med of the family's kcal100 values. A real product family is
 *  tight; a fused one is not, and fusion is this tier's whole failure mode.
 *  Measured: relaxing 0.10 -> 0.15 adds 36 rows of which the hand audit read the
 *  large majority as correct densities (normal-density burritos at 205 kcal/100g
 *  against a `carne con` median of 113, pork loin chops at 270 against 152). */
export const FAMILY_MAX_REL_MAD = 0.10;
/** |kcal100 * 100/S - med| <= tol * med. The exact-key tier uses 0.30; the family
 *  tier's reference is weaker so it buys precision here. Measured on the audited
 *  62-row set: tightening 0.30 -> 0.15 removes 7 of 15 false positives for 5 true
 *  positives, moving the audited FP rate from 24% to ~17%. */
export const FAMILY_RESCALE_TOL = 0.15;
/** Stored kcal100 must exceed the family median by at least this factor. Shared
 *  with the exact-key tier so the two tiers detect the same shape. */
export const FAMILY_INFLATED_RATIO = 1.6;
/** Real EAN/UPC/GTIN barcodes are at most 14 digits and this corpus's real ones
 *  are <= 13. Longer barcodes are the OFF chain-restaurant import, which carries
 *  a DIFFERENT corruption (the panel DIVIDED by serving scale — see
 *  detect-panel-scale-divided.ts) whose repair runs the OPPOSITE direction. The
 *  audit found ~15 such rows (White Castle / Jersey Mike's / Dunkin') inside the
 *  loose family flag set; excluding them structurally is why no threshold has to
 *  try to tell the two families apart by value. */
export const MAX_REAL_GTIN_LENGTH = 13;
/** Serving-mass window, matching the exact-key tier: below 2 g or above 600 g the
 *  field is not a single eating occasion, and 90-110 g cannot distinguish a
 *  per-serving panel from a correct per-100g one at all. */
export const FAMILY_SERVING_MIN_G = 2;
export const FAMILY_SERVING_MAX_G = 600;
export const FAMILY_DEAD_ZONE_MIN_G = 90;
export const FAMILY_DEAD_ZONE_MAX_G = 110;

/**
 * MEASURED false-positive rate of the panel-inflated-family flag set on the
 * LIVE corpus — 9 of 31 rows, hand-audited 2026-07-31 against each row's own
 * macro panel and servingSize string (1 further row undecidable and excluded
 * from the ratio; counting it as a miss gives 32.3%).
 *
 * A constant with a test, deliberately, because this project has shipped a rule
 * that scored 100% on its fixture and false-evicted 73.8% of the real cache
 * (D1_FALSE_EVICT_RATE_REAL_CACHE in scripts/eval/correctness-screen.ts). A
 * future "the fixture is green, let's auto-mark these" now has to argue with a
 * number instead of with the fixture.
 *
 * WHY IT IS HIGHER THAN THE PRE-DEDUPE AUDIT (24% over 62 rows). Tier 2 only
 * ever sees rows tier 1 did not already decide, and the rows tier 1 catches are
 * the easy ones — juices, milks, single-container drinks. What is left is
 * enriched in the hard mode.
 *
 * THE FALSE-POSITIVE MODE, characterised so a reviewer can recognise it: a
 * PREPARED COMPOSITE DISH whose correct per-100g density genuinely runs 1.6-2.2x
 * a family median that plainer members dilute — Tesco nduja ravioli 223 vs a
 * `mascarpone nduja` median of 126, M&S roast potatoes 159 vs a `mari piper`
 * median of 83, Wallaby 2% Greek yogurt 76 vs a `lowfat milkfat` median of 46.
 * Every one of them has a NORMAL macro sum (20-45 g/100g); the true positives
 * almost all carry a macro sum impossible for their food type (Factor ready
 * meals at 94-103 g/100g, microwave rice at 91) or an impossible single macro
 * for a liquid (Core Power at 42 g protein/100 mL).
 *
 * CONSEQUENCE, and it is the operative one: this flag set is a REVIEW QUEUE,
 * not a mark list. decideMark() returning true means "the rule still holds on
 * today's measurements", never "this row is corrupt".
 */
export const FAMILY_TIER_AUDITED_FP_RATE = 9 / 31;

/** Why a row is NOT a panel-inflated-family candidate. Doubles as the
 *  MarkDecision skip code, so a refusal always names the failing condition. */
export type FamilyRejection =
    | 'family_evidence_missing'
    | 'family_barcode_not_real_gtin'
    | 'family_group_too_small'
    | 'family_median_implausible'
    | 'family_dispersion_too_high'
    | 'family_serving_out_of_window'
    | 'family_serving_in_dead_zone'
    | 'family_not_inflated_vs_median'
    | 'family_rescale_misses_median';

/** The measurements the panel-inflated-family verdict is computed from. Every
 *  field is a raw observation; nothing here is a conclusion of the scan. */
export interface FamilyScaleInputs {
    barcode: string;
    kcal100: number;
    servingGrams: number;
    familyMedian: number;
    groupSize: number;
    relMad: number;
}

/**
 * The panel-inflated-family rule. Returns null when the row IS a candidate,
 * otherwise the first failing condition.
 *
 * Exported as a named refusal rather than a boolean for the same reason
 * rejectPanelInflatedServing() is: both the scan and decideMark() re-run it, and
 * a named refusal is what makes the marker's re-verification auditable.
 */
export function rejectPanelInflatedFamily(
    input: FamilyScaleInputs | null | undefined
): FamilyRejection | null {
    if (
        !input ||
        typeof input.barcode !== 'string' || !input.barcode.length ||
        !isFinite(input.kcal100) || input.kcal100 <= 0 ||
        !isFinite(input.servingGrams) ||
        !isFinite(input.familyMedian) || input.familyMedian <= 0 ||
        !isFinite(input.groupSize) ||
        !isFinite(input.relMad) || input.relMad < 0
    ) {
        return 'family_evidence_missing';
    }
    if (input.barcode.length > MAX_REAL_GTIN_LENGTH) return 'family_barcode_not_real_gtin';
    if (input.groupSize < FAMILY_MIN_GROUP) return 'family_group_too_small';
    // The mass-INFLATED family (maraschino-cherry name groups with medians of
    // ~3200) is a different corruption in which the plausible-looking row is the
    // corrupt one. Testing it here inverts the verdict, so it stays excluded.
    if (input.familyMedian > MAX_TRUSTABLE_SIBLING_MEDIAN) return 'family_median_implausible';
    if (input.relMad > FAMILY_MAX_REL_MAD) return 'family_dispersion_too_high';
    if (input.servingGrams < FAMILY_SERVING_MIN_G || input.servingGrams > FAMILY_SERVING_MAX_G) {
        return 'family_serving_out_of_window';
    }
    if (input.servingGrams > FAMILY_DEAD_ZONE_MIN_G && input.servingGrams < FAMILY_DEAD_ZONE_MAX_G) {
        return 'family_serving_in_dead_zone';
    }
    if (input.kcal100 < FAMILY_INFLATED_RATIO * input.familyMedian) {
        return 'family_not_inflated_vs_median';
    }
    const rescaled = input.kcal100 * (100 / input.servingGrams);
    if (Math.abs(rescaled - input.familyMedian) > FAMILY_RESCALE_TOL * input.familyMedian) {
        return 'family_rescale_misses_median';
    }
    return null;
}

// ---- detect-corrupt-nutrition.ts thresholds (corpus-mark tier) ----
// These sit deliberately ABOVE the rank/save-time gate bounds in
// macro-plausibility.ts (kcal 900, macro sum 105): a corruptReason mark
// permanently removes the record from the index, so the corpus tier takes
// extra label-rounding slack where the physics allows it.

/** Pure fat is ~900 kcal/100g; nothing edible exceeds it. 905 allows rounding. */
export const MAX_KCAL_100G = 905;
/** Protein + fat + carbs cannot exceed 100 g per 100 g; 105 allows label rounding. */
export const MAX_MACRO_SUM_100G = 105;
/** No single gram-basis component (fiber, sugars) can exceed 100 g per 100 g. */
export const MAX_COMPONENT_100G = 105;
/** Pure salt is 39.3 g sodium/100g; no food can exceed it. */
export const MAX_SODIUM_100G = 39.4;
/** Only salts, bouillon/stock concentrates, and seasoning powders live above
 *  this; the detector name-guards those and flags the rest. */
export const SODIUM_IMPLAUSIBLE_100G = 10;
/** kJ-as-kcal stores 4.184x the true value; 3x keeps margin over fiber noise. */
export const KJ_ATWATER_MIN_RATIO = 3;
/** Below this kcal the Atwater ratio is dominated by rounding on tiny macros. */
export const KJ_MIN_KCAL = 100;
/** sodium-sibling-outlier trust floors (mayo class: 5.33 vs sibling ~0.6). */
export const MIN_SODIUM_OUTLIER_GROUP = 4;
export const MIN_SODIUM_OUTLIER_RATIO = 6;
export const MIN_SODIUM_OUTLIER_G = 2;

// ---- panel-inflated-serving thresholds (SIBLING-FREE per-serving-panel rule) ----
//
// The class: a per-SERVING panel stored in the per-100g fields. Same family as
// detect-corrupt-panel.ts's `panel-inflated`, but that rule needs a same-name
// sibling median (>= MIN_INFLATED_GROUP_SIZE members), and meal-kit / restaurant
// / deli items are overwhelmingly name-space SINGLETONS — a measured 45 of 65
// sampled members had no siblings at all. So the sibling median is structurally
// unavailable exactly where the class lives, and this rule replaces it with two
// absolute measurements the row carries on its own.
//
// Why this band exists at all (and why no per-field rule can see it): energy is
// 4P + 4C + 9F, so a 400-650 kcal SERVING of a mixed meal carries ~95-130 g of
// macronutrients. Written into the per-100g fields, that reads as a macro sum of
// 95-130 g/100g. Above 105 the existing macro-sum-impossible rule already takes
// it. The residual blind spot is precisely [95, MAX_MACRO_SUM_100G] — the slack
// MAX_MACRO_SUM_100G deliberately grants to label rounding (see its comment).
// This rule does NOT narrow that slack; it adds an independent second signal so
// the slack band can be acted on without touching the 105 threshold.
//
/** Lower edge of the near-anhydrous band. A per-100g panel whose macros sum to
 *  >= 95 g describes a food that is essentially water-free: refined oils, sugars,
 *  hard candy, syrup solids, milk/protein powders. Nothing else reaches it. */
export const MIN_DRY_MACRO_SUM_100G = 95;
/** The panel must be internally coherent — calories within 10% of 4P + 4C + 9F.
 *  Coherence is what makes the class invisible to every per-field rule: 59 of 65
 *  sampled members are Atwater-consistent, so nothing looks individually wrong.
 *  It is also affirmative evidence of a whole-panel SCALE slip rather than a
 *  single corrupt field (one bad field breaks the Atwater identity). */
export const ATWATER_CONSISTENT_TOL = 0.1;
/** Serving-mass window for a single eating occasion. Below the floor a panel
 *  slip cannot produce an absurd per-serving energy at all (and 100 g servings
 *  make the two readings identical — detect-corrupt-panel.ts skips the same
 *  90-110 g dead zone for that reason). Above the ceiling `servingGrams` is a
 *  PACKAGE mass, not a serving: 1 kg of rice, a 1 L oil bottle, a 583 g bag of
 *  cashews all imply thousands of kcal from a perfectly correct panel, so up
 *  there an absurd implied energy is evidence about servingGrams, not the panel.
 *  600 g is the same serving-plausibility ceiling detect-corrupt-panel.ts uses. */
export const SERVING_WINDOW_MIN_G = 110;
export const SERVING_WINDOW_MAX_G = 600;
/** Implied energy of one serving if the per-100g field is believed. Calibrated
 *  against the whole clean corpus (609,894 Atwater-consistent rows carrying a
 *  serving mass): p50 145, p90 359, p99 692, p99.9 1,616 kcal. 1,500 therefore
 *  sits at ~the 99.87th percentile. The largest LEGITIMATE single-serve item
 *  measured in the corpus is a Keto Brick at 999.7 kcal (141 g at 709 kcal/100g,
 *  a correct density); the largest legitimate families above it are mass-gainer
 *  scoops and very-high-calorie meal-replacement bottles, topping out at ~1,300
 *  kcal. 1,500 keeps ~200 kcal of headroom over the highest measured legitimate
 *  single serving. Lowering it to 1,000 nearly doubles the selection (180 vs 104
 *  rows) and pulls in those two legitimate families wholesale. */
export const MIN_IMPLIED_SERVING_KCAL = 1500;

/** Why a row is NOT a panel-inflated-serving candidate. Doubles as the
 *  MarkDecision skip code, so a refusal always names the failing condition. */
export type ServingScaleRejection =
    | 'serving_scale_panel_missing'
    | 'macro_sum_outside_dry_band'
    | 'panel_not_atwater_consistent'
    | 'serving_outside_single_serving_window'
    | 'serving_grams_mirrors_calories'
    | 'implied_serving_kcal_below_threshold';

/** kcal of one serving implied by believing the per-100g field. */
export function impliedServingKcal(panel: ServingScalePanel): number {
    return (panel.kcal100 * panel.servingGrams) / 100;
}

/** Atwater estimate (4P + 4C + 9F) of the stored panel. */
export function atwaterKcal(panel: ServingScalePanel): number {
    return 4 * panel.protein + 4 * panel.carbs + 9 * panel.fat;
}

/**
 * The panel-inflated-serving rule, sibling-free and computed only from the row.
 * Returns null when the row IS a candidate, otherwise the failing condition.
 *
 * Deliberately NOT exported as a boolean: both the scan and decideMark() need
 * the reason, and a named refusal is what makes the marker's re-verification
 * auditable.
 */
export function rejectPanelInflatedServing(
    panel: ServingScalePanel | null | undefined
): ServingScaleRejection | null {
    if (
        !panel ||
        !isFinite(panel.kcal100) || panel.kcal100 <= 0 ||
        !isFinite(panel.servingGrams) || panel.servingGrams <= 0 ||
        !isFinite(panel.protein) || !isFinite(panel.fat) || !isFinite(panel.carbs)
    ) {
        return 'serving_scale_panel_missing';
    }
    const macroSum = panel.protein + panel.fat + panel.carbs;
    if (macroSum < MIN_DRY_MACRO_SUM_100G || macroSum > MAX_MACRO_SUM_100G) {
        return 'macro_sum_outside_dry_band';
    }
    const atwater = atwaterKcal(panel);
    if (atwater <= 0 || Math.abs(panel.kcal100 - atwater) > ATWATER_CONSISTENT_TOL * panel.kcal100) {
        return 'panel_not_atwater_consistent';
    }
    if (panel.servingGrams <= SERVING_WINDOW_MIN_G || panel.servingGrams > SERVING_WINDOW_MAX_G) {
        return 'serving_outside_single_serving_window';
    }
    // Measured ingest artifact: servingGrams carrying the calories value
    // (543 g / 543 kcal, 524/524, 564/564 ...). The serving field is provably
    // junk on those rows, so the implied energy says nothing about the panel.
    if (Math.abs(panel.servingGrams - panel.kcal100) < 1) {
        return 'serving_grams_mirrors_calories';
    }
    if (impliedServingKcal(panel) <= MIN_IMPLIED_SERVING_KCAL) {
        return 'implied_serving_kcal_below_threshold';
    }
    return null;
}

export type MarkDecision =
    | { mark: true; reason: string }
    | {
          mark: false;
          skip:
              | 'sibling_median_implausible'
              | 'inflated_group_too_small'
              | 'value_below_threshold'
              | 'outlier_group_too_small'
              | 'outlier_below_thresholds'
              | ServingScaleRejection
              | FamilyRejection;
      };

/**
 * Decide whether a scan flag is trustworthy enough to mark.
 * Reason strings are stable identifiers ("panel-low:direct" etc.) so later
 * sweeps can distinguish mark generations by prefix match.
 *
 * The nutrition-scale directions re-verify their threshold against the flag's
 * own `value` — a defense in depth so a hand-edited or stale scan file can
 * never mark a row the rule would not flag today.
 */
export function decideMark(flag: CorruptScanFlag): MarkDecision {
    switch (flag.direction) {
        case 'panel-low':
            if (flag.siblingMedian > MAX_TRUSTABLE_SIBLING_MEDIAN) {
                return { mark: false, skip: 'sibling_median_implausible' };
            }
            return { mark: true, reason: `${flag.direction}:${flag.tier}` };
        case 'panel-inflated':
            if (flag.groupSize < MIN_INFLATED_GROUP_SIZE) {
                return { mark: false, skip: 'inflated_group_too_small' };
            }
            return { mark: true, reason: `${flag.direction}:${flag.tier}` };
        case 'panel-inflated-family': {
            // Same re-verification discipline as panel-inflated-serving: the rule
            // is re-run from the raw measurements the scan recorded, so a stale or
            // hand-edited scan file can only ever mark rows the rule still flags.
            const rejection = rejectPanelInflatedFamily(
                flag.family
                    ? {
                          barcode: flag.barcode,
                          kcal100: flag.kcal100,
                          servingGrams: flag.servingGrams ?? NaN,
                          familyMedian: flag.family.median,
                          groupSize: flag.groupSize,
                          relMad: flag.family.relMad,
                      }
                    : null
            );
            if (rejection) return { mark: false, skip: rejection };
            return { mark: true, reason: `${flag.direction}:${flag.tier}` };
        }
        case 'panel-inflated-serving': {
            // Strictest re-verification of the set: the whole rule is re-run from
            // the raw panel the scan recorded, so `value` (and any hand edit to
            // it) is decorative — a flag can only mark if the MEASUREMENTS still
            // satisfy every condition.
            const rejection = rejectPanelInflatedServing(flag.panel);
            if (rejection) return { mark: false, skip: rejection };
            return { mark: true, reason: `${flag.direction}:${flag.tier}` };
        }
        case 'kcal-impossible':
            if ((flag.value ?? 0) <= MAX_KCAL_100G) {
                return { mark: false, skip: 'value_below_threshold' };
            }
            return { mark: true, reason: `${flag.direction}:${flag.tier}` };
        case 'macro-sum-impossible':
            if ((flag.value ?? 0) <= MAX_MACRO_SUM_100G) {
                return { mark: false, skip: 'value_below_threshold' };
            }
            return { mark: true, reason: `${flag.direction}:${flag.tier}` };
        case 'fiber-impossible':
        case 'sugars-impossible':
            if ((flag.value ?? 0) <= MAX_COMPONENT_100G) {
                return { mark: false, skip: 'value_below_threshold' };
            }
            return { mark: true, reason: `${flag.direction}:${flag.tier}` };
        case 'sodium-impossible':
            if ((flag.value ?? 0) <= MAX_SODIUM_100G) {
                return { mark: false, skip: 'value_below_threshold' };
            }
            return { mark: true, reason: `${flag.direction}:${flag.tier}` };
        case 'sodium-implausible':
            if ((flag.value ?? 0) <= SODIUM_IMPLAUSIBLE_100G) {
                return { mark: false, skip: 'value_below_threshold' };
            }
            return { mark: true, reason: `${flag.direction}:${flag.tier}` };
        case 'kj-as-kcal':
            if ((flag.value ?? 0) < KJ_MIN_KCAL || (flag.ratio ?? 0) < KJ_ATWATER_MIN_RATIO) {
                return { mark: false, skip: 'value_below_threshold' };
            }
            return { mark: true, reason: `${flag.direction}:${flag.tier}` };
        case 'sodium-sibling-outlier':
            if (flag.groupSize < MIN_SODIUM_OUTLIER_GROUP) {
                return { mark: false, skip: 'outlier_group_too_small' };
            }
            if ((flag.value ?? 0) < MIN_SODIUM_OUTLIER_G || (flag.ratio ?? 0) < MIN_SODIUM_OUTLIER_RATIO) {
                return { mark: false, skip: 'outlier_below_thresholds' };
            }
            return { mark: true, reason: `${flag.direction}:${flag.tier}` };
    }
}
