/**
 * Unit tests for the count-serving seed table (default-count-grams.ts).
 *
 * Anchored on golden n-mq-21: "3 real good chicken tenders" was billing
 * 3 × 112g (the whole multi-piece portion) = 336g. A per-piece seed makes a
 * counted tender resolve to ~37g, so 3 → 111g (within the golden 90-150 band).
 */

import { getDefaultCountServing } from '../default-count-grams';

describe('getDefaultCountServing — breaded chicken pieces (n-mq-21)', () => {
    it('resolves a per-piece weight for a multi-piece "portion" SKU', () => {
        const r = getDefaultCountServing('real good chicken tenders', 'each');
        expect(r).not.toBeNull();
        expect(r!.key).toBe('chicken tender');
        expect(r!.grams).toBe(37);
        // 3 tenders → 111g, not 336g — inside the golden n-mq-21 band [90,150].
        expect(r!.grams * 3).toBeGreaterThanOrEqual(90);
        expect(r!.grams * 3).toBeLessThanOrEqual(150);
    });

    it('matches tender/finger/nugget aliases', () => {
        expect(getDefaultCountServing('chicken fingers', 'each')!.key).toBe('chicken tender');
        expect(getDefaultCountServing('chicken strips', 'each')!.key).toBe('chicken tender');
        expect(getDefaultCountServing('chicken nuggets', 'each')!.key).toBe('chicken nugget');
    });

    it('does not hijack unrelated "strip"/"tender"/"tenderloin" foods', () => {
        expect(getDefaultCountServing('steak strips', 'each')).toBeNull();
        expect(getDefaultCountServing('beef tenderloin', 'each')).toBeNull();
    });
});

/**
 * Anchored on golden n-svk-05: "1 sleeve saltine crackers".
 *
 * A sleeve is a CONTAINER unit, so the 4g per-piece 'cracker' seed is barred
 * from answering it and the request fell through to the AI estimator — which
 * PERSISTS its draw. When the 2026-07-30 OFF refresh deleted every derived
 * OffServing row, the redraw returned 200g (it had been 150g) and upsertServing
 * made that permanent, so the case went from intermittently right to reliably
 * wrong. The deterministic rung below removes the estimator from this path.
 *
 * These tests exist to catch the two ways the rung can rot: silently ceasing to
 * match (back to the dice), or widening to foods it was never measured for.
 */
describe('getDefaultCountServing — cracker sleeves (n-svk-05)', () => {
    it('resolves a saltine sleeve deterministically, inside the golden band', () => {
        const r = getDefaultCountServing('Saltine crackers', 'sleeve');
        expect(r).not.toBeNull();
        expect(r!.grams).toBe(113);
        // The golden assertion for n-svk-05 is grams ∈ [70, 170]. Pin the band,
        // not just the value: a future re-estimate that stays in band is fine,
        // one that drifts out is the regression this case is about.
        expect(r!.grams).toBeGreaterThanOrEqual(70);
        expect(r!.grams).toBeLessThanOrEqual(170);
    });

    it('matches the bare brandless name too', () => {
        expect(getDefaultCountServing('Saltines', 'sleeve')?.grams).toBe(113);
    });

    it('REJECTS the 200g value that the persisted AI draw produced', () => {
        // The literal defect. If this ever passes at 200 the rung is bypassed.
        expect(getDefaultCountServing('Saltine crackers', 'sleeve')?.grams).not.toBe(200);
    });

    it('does NOT answer a sleeve for crackers it was never measured for', () => {
        // 113g is derived from a saltine box (453g / 4 sleeves). It is not a
        // general "cracker sleeve" constant, and must not become one.
        expect(getDefaultCountServing('Ritz crackers', 'sleeve')).toBeNull();
        expect(getDefaultCountServing('Graham crackers', 'sleeve')).toBeNull();
    });

    it('still returns the per-piece weight when the unit is a cracker, not a sleeve', () => {
        expect(getDefaultCountServing('Saltine crackers', 'cracker')?.grams).toBe(4);
    });
});
