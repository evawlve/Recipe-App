/**
 * Tests for the corrupt-mark trust rules (corrupt-mark.ts) — the pure
 * decision layer between detect-corrupt-panel.ts scan output and the
 * corruptReason writes performed by scripts/mark-corrupt-off.ts.
 */
import {
    decideMark,
    isCorruptExclusionEnabled,
    CorruptScanFlag,
    MAX_TRUSTABLE_SIBLING_MEDIAN,
    MIN_INFLATED_GROUP_SIZE,
    MAX_KCAL_100G,
    MAX_MACRO_SUM_100G,
    MAX_SODIUM_100G,
    SODIUM_IMPLAUSIBLE_100G,
    KJ_ATWATER_MIN_RATIO,
    KJ_MIN_KCAL,
    MIN_SODIUM_OUTLIER_GROUP,
    MIN_SODIUM_OUTLIER_RATIO,
    MIN_SODIUM_OUTLIER_G,
} from '../corrupt-mark';

function flag(overrides: Partial<CorruptScanFlag>): CorruptScanFlag {
    return {
        barcode: '0000000000000',
        name: 'Test Food',
        brandName: null,
        kcal100: 160,
        servingGrams: 30,
        tier: 'direct',
        direction: 'panel-low',
        rescaled: 533,
        siblingMedian: 540,
        groupSize: 12,
        triageConfirmed: false,
        ...overrides,
    };
}

describe('decideMark', () => {
    it('marks a classic per-serving-panel-as-per-100g record (panel-low, sane siblings)', () => {
        const d = decideMark(flag({ direction: 'panel-low', siblingMedian: 540, tier: 'direct' }));
        expect(d).toEqual({ mark: true, reason: 'panel-low:direct' });
    });

    it('marks panel-inflated records from large groups', () => {
        const d = decideMark(flag({
            direction: 'panel-inflated', tier: 'sibling-serving',
            kcal100: 900, rescaled: 270, siblingMedian: 265, groupSize: MIN_INFLATED_GROUP_SIZE,
        }));
        expect(d).toEqual({ mark: true, reason: 'panel-inflated:sibling-serving' });
    });

    it('reason string encodes direction and tier', () => {
        const d = decideMark(flag({ direction: 'panel-low', tier: 'sibling-serving' }));
        expect(d).toEqual({ mark: true, reason: 'panel-low:sibling-serving' });
    });

    it('skips panel-low flags whose sibling median is physically impossible (kJ-corrupt group)', () => {
        // Real case from the 2026-07-21 scan: "Honey mustard dressing & dip"
        // group median 939 kcal/100g — above pure fat. The SIBLINGS are the
        // corrupt rows; the flagged 300 kcal/100g record is the sane one.
        const d = decideMark(flag({
            direction: 'panel-low', kcal100: 300, servingGrams: 30,
            rescaled: 1000, siblingMedian: MAX_TRUSTABLE_SIBLING_MEDIAN + 19,
        }));
        expect(d).toEqual({ mark: false, skip: 'sibling_median_implausible' });
    });

    it('trusts panel-low at exactly the sibling-median ceiling', () => {
        const d = decideMark(flag({ direction: 'panel-low', siblingMedian: MAX_TRUSTABLE_SIBLING_MEDIAN }));
        expect(d.mark).toBe(true);
    });

    it('skips panel-inflated flags from small sibling groups', () => {
        const d = decideMark(flag({
            direction: 'panel-inflated', groupSize: MIN_INFLATED_GROUP_SIZE - 1,
            kcal100: 900, rescaled: 270, siblingMedian: 265,
        }));
        expect(d).toEqual({ mark: false, skip: 'inflated_group_too_small' });
    });

    it('does NOT apply the group-size floor to panel-low flags (direct serving evidence)', () => {
        const d = decideMark(flag({ direction: 'panel-low', groupSize: 4 }));
        expect(d.mark).toBe(true);
    });
});

describe('decideMark — nutrition-scale directions (detect-corrupt-nutrition.ts)', () => {
    it('marks kcal above the physical ceiling', () => {
        // Real case from the 2026-07-21 sizing: "Bomb Burrito" at 81,818 kcal/100g.
        const d = decideMark(flag({ direction: 'kcal-impossible', value: 81818 }));
        expect(d).toEqual({ mark: true, reason: 'kcal-impossible:direct' });
    });

    it('re-verifies the kcal threshold from the flag value (stale/hand-edited scan defense)', () => {
        const d = decideMark(flag({ direction: 'kcal-impossible', value: MAX_KCAL_100G }));
        expect(d).toEqual({ mark: false, skip: 'value_below_threshold' });
    });

    it('marks macro sums over 100g/100g', () => {
        const d = decideMark(flag({ direction: 'macro-sum-impossible', value: MAX_MACRO_SUM_100G + 1 }));
        expect(d).toEqual({ mark: true, reason: 'macro-sum-impossible:direct' });
    });

    it('marks sodium above pure salt (mg-entered-as-g family)', () => {
        // Real case: beef jerky storing "1285.71 g" sodium — the mg value.
        const d = decideMark(flag({ direction: 'sodium-impossible', value: 1285.71 }));
        expect(d).toEqual({ mark: true, reason: 'sodium-impossible:direct' });
    });

    it('marks unguarded sodium in the implausible band', () => {
        // Real case: "Banoffee Pie" at 12.6 g sodium/100g (= 31 g salt).
        const d = decideMark(flag({ direction: 'sodium-implausible', value: 12.6 }));
        expect(d).toEqual({ mark: true, reason: 'sodium-implausible:direct' });
    });

    it('skips sodium-implausible at or below the band floor', () => {
        const d = decideMark(flag({ direction: 'sodium-implausible', value: SODIUM_IMPLAUSIBLE_100G }));
        expect(d).toEqual({ mark: false, skip: 'value_below_threshold' });
    });

    it('marks kJ-as-kcal Atwater mismatches', () => {
        // The n-mq-27 lemon class: 383 "kcal"/100g vs ~40 from macros (~9.6x).
        const d = decideMark(flag({ direction: 'kj-as-kcal', value: 383, ratio: 9.6 }));
        expect(d).toEqual({ mark: true, reason: 'kj-as-kcal:direct' });
    });

    it('skips kj-as-kcal below the ratio or kcal floors', () => {
        expect(decideMark(flag({ direction: 'kj-as-kcal', value: 383, ratio: KJ_ATWATER_MIN_RATIO - 0.1 })))
            .toEqual({ mark: false, skip: 'value_below_threshold' });
        expect(decideMark(flag({ direction: 'kj-as-kcal', value: KJ_MIN_KCAL - 1, ratio: 9.6 })))
            .toEqual({ mark: false, skip: 'value_below_threshold' });
    });

    it('marks the mayo-class sodium sibling outlier', () => {
        // off_9348905001434: mayonnaise sodium 5.33 g/100g vs sibling median ~0.6 (~8.9x).
        const d = decideMark(flag({
            direction: 'sodium-sibling-outlier', value: 5.33, ratio: 8.9,
            siblingMedian: 0.6, groupSize: 12,
        }));
        expect(d).toEqual({ mark: true, reason: 'sodium-sibling-outlier:direct' });
    });

    it('skips sibling outliers from small groups', () => {
        const d = decideMark(flag({
            direction: 'sodium-sibling-outlier', value: 5.33, ratio: 8.9,
            groupSize: MIN_SODIUM_OUTLIER_GROUP - 1,
        }));
        expect(d).toEqual({ mark: false, skip: 'outlier_group_too_small' });
    });

    it('skips sibling outliers below the ratio or absolute floors', () => {
        expect(decideMark(flag({
            direction: 'sodium-sibling-outlier', value: 5.33,
            ratio: MIN_SODIUM_OUTLIER_RATIO - 0.5, groupSize: 12,
        }))).toEqual({ mark: false, skip: 'outlier_below_thresholds' });
        expect(decideMark(flag({
            direction: 'sodium-sibling-outlier', value: MIN_SODIUM_OUTLIER_G - 0.1,
            ratio: 8.9, groupSize: 12,
        }))).toEqual({ mark: false, skip: 'outlier_below_thresholds' });
    });
});

describe('isCorruptExclusionEnabled', () => {
    const saved = process.env.CORRUPT_RECORD_EXCLUSION;
    afterEach(() => {
        if (saved === undefined) delete process.env.CORRUPT_RECORD_EXCLUSION;
        else process.env.CORRUPT_RECORD_EXCLUSION = saved;
    });

    it('defaults ON when unset', () => {
        delete process.env.CORRUPT_RECORD_EXCLUSION;
        expect(isCorruptExclusionEnabled()).toBe(true);
    });

    it('kill-switch: "0" disables', () => {
        process.env.CORRUPT_RECORD_EXCLUSION = '0';
        expect(isCorruptExclusionEnabled()).toBe(false);
    });

    it('any other value stays ON', () => {
        process.env.CORRUPT_RECORD_EXCLUSION = '1';
        expect(isCorruptExclusionEnabled()).toBe(true);
    });
});
