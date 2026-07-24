/**
 * Funnel taxonomy (sprint F1).
 *
 * The class IDs this module produces are stored in MappingEventLog.dropReason
 * and grouped by the nightly sweep, so the property that actually matters is
 * CARDINALITY: the vocabularies being reused were written for human-readable
 * logs and interpolate live measurements into their reason strings
 * (`atwater:kcal_412_exceeds_computed_388.5`). Stored raw, every row would carry
 * a unique "class" and the funnel table would be noise. These tests pin the
 * normalization that keeps a class a class.
 */

import { normalizeClassId, funnelReason, markSaveRejected, type FunnelSink } from '../funnel';

describe('normalizeClassId', () => {
    it('strips interpolated measurements but keeps the surrounding words', () => {
        // macro-plausibility: `atwater:kcal_${kcal}_exceeds_computed_${computed}`
        expect(normalizeClassId('atwater:kcal_412_exceeds_computed_388.5'))
            .toBe('atwater:kcal_exceeds_computed');
        expect(normalizeClassId('floor:produce_kcal_12.3_below_20'))
            .toBe('floor:produce_kcal_below');
        expect(normalizeClassId('bounds:kcal_over_900'))
            .toBe('bounds:kcal_over');
    });

    it('drops parenthesized detail from confidenceGate reasons', () => {
        expect(normalizeClassId('confidence_below_threshold(0.42)'))
            .toBe('confidence_below_threshold');
        expect(normalizeClassId('margin_too_small(0.03)'))
            .toBe('margin_too_small');
    });

    it('leaves an already-clean class ID untouched', () => {
        expect(normalizeClassId('category:protein_food_with_zero_protein'))
            .toBe('category:protein_food_with_zero_protein');
        expect(normalizeClassId('brand_mismatch')).toBe('brand_mismatch');
    });

    it('collapses distinct measurements of the SAME defect onto one class', () => {
        // This is the whole point: three rows, one class.
        const a = normalizeClassId('bounds:macro_sum_over_105g(112.4)');
        const b = normalizeClassId('bounds:macro_sum_over_105g(230.9)');
        const c = normalizeClassId('bounds:macro_sum_over_105g(101.1)');
        expect(new Set([a, b, c]).size).toBe(1);
    });

    it('caps segment count so a long path cannot grow unbounded', () => {
        expect(normalizeClassId('a:b:c:d:e')).toBe('a:b:c');
        expect(normalizeClassId('a:b:c:d:e', { maxSegments: 2 })).toBe('a:b');
    });

    it('falls back to "unknown" rather than emitting an empty class', () => {
        expect(normalizeClassId(undefined)).toBe('unknown');
        expect(normalizeClassId(null)).toBe('unknown');
        expect(normalizeClassId('')).toBe('unknown');
        expect(normalizeClassId('   ')).toBe('unknown');
        // A reason that is nothing but numbers has no class content left.
        expect(normalizeClassId('12345')).toBe('unknown');
    });

    it('bounds segment length', () => {
        const long = 'x'.repeat(200);
        for (const segment of normalizeClassId(long).split(':')) {
            expect(segment.length).toBeLessThanOrEqual(40);
        }
    });
});

describe('funnelReason', () => {
    it('namespaces the class under its stage', () => {
        expect(funnelReason('no_match', 'confidence_too_low'))
            .toBe('no_match:confidence_too_low');
        expect(funnelReason('no_candidates', 'dataset_gap'))
            .toBe('no_candidates:dataset_gap');
    });

    it('normalizes the class it is given', () => {
        expect(funnelReason('under_gate', 'confidence_below_threshold(0.42)'))
            .toBe('under_gate:confidence_below_threshold');
    });

    it('never produces a bare stage with a dangling colon', () => {
        expect(funnelReason('error')).toBe('error:unknown');
    });
});

describe('markSaveRejected', () => {
    it('downgrades an optimistically-saved line and records the blocking gate', () => {
        const sink: FunnelSink = { funnelStage: 'saved' };
        markSaveRejected(sink, 'brand_mismatch');
        expect(sink.funnelStage).toBe('save_rejected');
        expect(sink.dropReason).toBe('save_rejected:brand_mismatch');
    });

    it('keeps the macro-plausibility detail suffix as a groupable class', () => {
        const sink: FunnelSink = { funnelStage: 'saved' };
        markSaveRejected(sink, `implausible_macros:${normalizeClassId('floor:produce_kcal_12.3_below_20', { maxSegments: 2 })}`);
        // Full granularity in the stored column (Diego, 2026-07-24 decision 3);
        // the nightly table rolls this up to 'save_rejected:implausible_macros'.
        expect(sink.dropReason).toBe('save_rejected:implausible_macros:floor:produce_kcal_below');
    });

    it('is a no-op when no sink was passed (alias saves, direct callers)', () => {
        expect(() => markSaveRejected(undefined, 'brand_mismatch')).not.toThrow();
    });
});
