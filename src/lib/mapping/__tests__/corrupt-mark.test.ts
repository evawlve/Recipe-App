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
