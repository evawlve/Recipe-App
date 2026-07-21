/**
 * corrupt-mark.ts — shared logic for the OffFood.corruptReason marking system.
 *
 * Two corpus scans feed the marker (scripts/mark-corrupt-off.ts):
 *   - scripts/eval/detect-corrupt-panel.ts — records whose stored per-100g
 *     panel is really a per-serving panel (rescaling by 100/servingGrams
 *     lands on the same-name sibling median);
 *   - scripts/eval/detect-corrupt-nutrition.ts — per-field impossibilities
 *     and scale slips: kcal above the physical ceiling, macro sums over
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
    // detect-corrupt-nutrition.ts
    | 'kcal-impossible'
    | 'macro-sum-impossible'
    | 'sodium-impossible'
    | 'sodium-implausible'
    | 'kj-as-kcal'
    | 'sodium-sibling-outlier';

/** Staleness re-check payload: which live field the marker must compare
 *  against the scan-time value before writing (the corpus may have changed).
 *  'macroSum' is computed as protein + fat + carbs from the live row. */
export interface CorruptScanCheck {
    field: 'calories' | 'sodium' | 'macroSum';
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
}

/** Physical ceiling for a trustworthy sibling median. Pure fat is ~900 kcal/100g;
 *  a group median above this means the SIBLINGS are corrupt (kJ-as-kcal family)
 *  and a panel-low flag against them is inverted — the flagged row is the sane one. */
export const MAX_TRUSTABLE_SIBLING_MEDIAN = 920;

/** panel-inflated flags lean entirely on the sibling distribution; small groups
 *  are dominated by a few bad rows. Triage review set this floor. */
export const MIN_INFLATED_GROUP_SIZE = 8;

// ---- detect-corrupt-nutrition.ts thresholds (corpus-mark tier) ----
// These sit deliberately ABOVE the rank/save-time gate bounds in
// macro-plausibility.ts (kcal 900, macro sum 105): a corruptReason mark
// permanently removes the record from the index, so the corpus tier takes
// extra label-rounding slack where the physics allows it.

/** Pure fat is ~900 kcal/100g; nothing edible exceeds it. 905 allows rounding. */
export const MAX_KCAL_100G = 905;
/** Protein + fat + carbs cannot exceed 100 g per 100 g; 105 allows label rounding. */
export const MAX_MACRO_SUM_100G = 105;
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

export type MarkDecision =
    | { mark: true; reason: string }
    | {
          mark: false;
          skip:
              | 'sibling_median_implausible'
              | 'inflated_group_too_small'
              | 'value_below_threshold'
              | 'outlier_group_too_small'
              | 'outlier_below_thresholds';
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
