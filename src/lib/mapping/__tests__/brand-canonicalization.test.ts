/**
 * TRIPWIRE for the brand detector's canonical pass.
 *
 * Three things here look like dead weight and are not. Each was measured, and
 * each has a false-positive class waiting behind it:
 *
 *  1. FOLD_UNSAFE. `green's` folds to `greens`, which is an ordinary food word.
 *     Without the guard the detector flags `collard greens` as branded.
 *  2. Canonicalization KEEPS single-letter tokens. An earlier revision reused
 *     the scan's `length > 1` filter and collapsed `s&w` to the bare token
 *     `and`, `san-j` to `san` and `sunny d` to `sunny` — which flagged
 *     `shrimp and grits`, `biscuits and gravy` and `half and half`. That is why
 *     the canonical pass runs over UNFILTERED query tokens.
 *  3. The n-gram ceiling is DERIVED from the lists. Hardcoding 3 again makes
 *     `jack in the box` unreachable, and the scan then falls through to the
 *     bare token `jumbo` — returning a WRONG brand rather than none.
 *
 * Measured 2026-08-31 over 4,102 corpus lines and 6,671 distinct real-traffic
 * rawLines: zero brands LOST on either.
 */
import { detectBrandInQuery, canonicalizeBrandKey } from '../brand-detector';

describe('brand detector — canonical pass', () => {
    it.each([
        ['dennys grand slam', "denny's"],
        ['applebees riblets', "applebee's"],
        ['chilis queso', "chili's"],
        ['jimmy johns turkey sub', "jimmy john's"],
        ['chick fil a chicken sandwich', 'chick-fil-a'],
        ['in n out double double', 'in n out'],
        ['noodles and company mac and cheese', 'noodles & company'],
        ['coca cola classic', 'coca-cola'],
        ['m and ms peanut', "m&m's"],
    ])('detects %s as %s', (line, brand) => {
        expect(detectBrandInQuery(line)).toEqual({ isBranded: true, matchedBrand: brand });
    });

    it('prefers the longest phrase, so a 4-token brand beats a bare food token', () => {
        // Was { isBranded: true, matchedBrand: 'jumbo' } under the 3-gram ceiling.
        expect(detectBrandInQuery('jack in the box jumbo jack'))
            .toEqual({ isBranded: true, matchedBrand: 'jack in the box' });
    });

    it('reaches entries the length>1 token filter used to shred', () => {
        // The documented "114 unreachable lexicon entries" class.
        expect(detectBrandInQuery('special k red berries').isBranded).toBe(true);
        expect(detectBrandInQuery('land o lakes butter').isBranded).toBe(true);
    });

    it.each([
        'collard greens',        // green's -> greens
        'micro greens',
        'power greens blend',
        'shrimp and grits',      // s&w -> "and", if single letters were dropped
        'biscuits and gravy',
        'half and half',
        'sunny side up eggs',    // sunny d -> "sunny"
        '2 tbsp olive oil',
        'grilled chicken breast',
    ])('does not flag %s as branded', (line) => {
        expect(detectBrandInQuery(line).isBranded).toBe(false);
    });

    it('canonicalizes possessives, separators and ampersands alike', () => {
        expect(canonicalizeBrandKey("denny's")).toBe('dennys');
        expect(canonicalizeBrandKey('chick-fil-a')).toBe('chick fil a');
        expect(canonicalizeBrandKey('noodles & company')).toBe('noodles and company');
    });

    it('keeps single-letter tokens, or s&w becomes the word "and"', () => {
        expect(canonicalizeBrandKey('s&w')).toBe('s and w');
        expect(canonicalizeBrandKey('special k')).toBe('special k');
    });
});
