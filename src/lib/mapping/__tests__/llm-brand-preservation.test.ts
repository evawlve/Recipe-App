import { detectBrandInQuery } from '../brand-detector';
import { hasDecisiveBrandContext, candidateMatchesTargetBrand } from '../simple-rerank';

/**
 * The decisiveness gate is the whole design ON THE SOLO PATH; on the composite
 * path the segmenter having named the brand is a second kind of evidence
 * (`brandReassertEvidence()` in quantity-word-brand.ts, 2026-09-05), under the
 * same quantity-word refusal. Without the gate, re-injecting a
 * detected brand into the AI-rewritten name rebuilds a REFUTED regression:
 * `bell pepper` matches the lexicon brand `bell` (Bell & Evans), the normalizer
 * rewrites the food to `capsicum`, and an unconditional prefix produced read/
 * write key `bell capsicum` — orphaning the live human-triage `capsicum` row
 * (golden n-mq-30). `deriveMappingCacheKey()`'s own header records this and
 * `cache-key-symmetry.test.ts` pins it.
 *
 * So this file asserts the gate separates the two symptoms BEFORE any fix
 * leans on it. If these ever converge, the brand-preservation repair must be
 * disabled, not re-tuned.
 */
describe('the decisiveness gate separates the two brand symptoms', () => {
    it('is DECISIVE for "one bar birthday cake" — a real brand in product context', () => {
        const det = detectBrandInQuery('one bar birthday cake');
        expect(det.matchedBrand).toBe('one');
        expect(hasDecisiveBrandContext('one bar birthday cake', det.matchedBrand!)).toBe(true);
    });

    it('is NOT decisive for "bell pepper" — a false-positive lexicon hit', () => {
        const det = detectBrandInQuery('bell pepper');
        expect(det.matchedBrand).toBe('bell');
        // The refuted case. A repair gated on this must never fire here.
        expect(hasDecisiveBrandContext('bell pepper', det.matchedBrand!)).toBe(false);
    });

    it('recognises a brand still present in the rewritten name', () => {
        expect(candidateMatchesTargetBrand(undefined, 'one bar birthday cake', 'one')).toBe(true);
        expect(candidateMatchesTargetBrand(undefined, 'birthday cake', 'one')).toBe(false);
    });

    it('folds apostrophes, so a possessive brand is not seen as dropped', () => {
        // The possessive fork has bitten this project repeatedly; a repair that
        // thought `jerrys` != `jerry's` would prepend a duplicate brand.
        expect(candidateMatchesTargetBrand(undefined, "ben and jerry's vanilla", "jerry's")).toBe(true);
    });
});
