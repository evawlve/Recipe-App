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
