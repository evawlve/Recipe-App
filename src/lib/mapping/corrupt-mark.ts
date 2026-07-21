/**
 * corrupt-mark.ts — shared logic for the OffFood.corruptReason marking system.
 *
 * The corpus scan (scripts/eval/detect-corrupt-panel.ts) flags records whose
 * stored per-100g panel is really a per-serving panel (rescaling by
 * 100/servingGrams lands on the same-name sibling median). The marker
 * (scripts/mark-corrupt-off.ts) writes corruptReason for the trustworthy
 * subset of those flags; retrieval then excludes marked rows (Typesense sync
 * WHERE clause + live-index purge + PG fallback filter) and the mapper escapes
 * cache rows that point at them.
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

/** One entry of detect-corrupt-panel.ts scan output (results/corrupt-panel-scan-*.json). */
export interface CorruptScanFlag {
    barcode: string;
    name: string;
    brandName: string | null;
    kcal100: number;
    servingGrams: number | null;
    tier: 'direct' | 'sibling-serving';
    direction: 'panel-low' | 'panel-inflated';
    rescaled: number;
    siblingMedian: number;
    groupSize: number;
    triageConfirmed: boolean;
}

/** Physical ceiling for a trustworthy sibling median. Pure fat is ~900 kcal/100g;
 *  a group median above this means the SIBLINGS are corrupt (kJ-as-kcal family)
 *  and a panel-low flag against them is inverted — the flagged row is the sane one. */
export const MAX_TRUSTABLE_SIBLING_MEDIAN = 920;

/** panel-inflated flags lean entirely on the sibling distribution; small groups
 *  are dominated by a few bad rows. Triage review set this floor. */
export const MIN_INFLATED_GROUP_SIZE = 8;

export type MarkDecision =
    | { mark: true; reason: string }
    | { mark: false; skip: 'sibling_median_implausible' | 'inflated_group_too_small' };

/**
 * Decide whether a scan flag is trustworthy enough to mark.
 * Reason strings are stable identifiers ("panel-low:direct" etc.) so later
 * sweeps can distinguish mark generations by prefix match.
 */
export function decideMark(flag: CorruptScanFlag): MarkDecision {
    if (flag.direction === 'panel-low' && flag.siblingMedian > MAX_TRUSTABLE_SIBLING_MEDIAN) {
        return { mark: false, skip: 'sibling_median_implausible' };
    }
    if (flag.direction === 'panel-inflated' && flag.groupSize < MIN_INFLATED_GROUP_SIZE) {
        return { mark: false, skip: 'inflated_group_too_small' };
    }
    return { mark: true, reason: `${flag.direction}:${flag.tier}` };
}
