import { queryTokenCoverage, coverageTokens } from '../query-token-coverage';

describe('coverageTokens', () => {
    it('lowercases, strips punctuation, singularizes', () => {
        expect(coverageTokens('Grapes, Red!')).toEqual(['grape', 'red']);
    });

    it('drops single-character tokens', () => {
        expect(coverageTokens('a 2% milk')).toEqual(['milk']);
    });
});

describe('queryTokenCoverage', () => {
    it('is 1 for an exact single-token match', () => {
        expect(queryTokenCoverage('grapes', 'Grapes, raw')).toBe(1);
    });

    it('matches across plural/singular forms', () => {
        expect(queryTokenCoverage('grape', 'Grapes, red, seedless')).toBe(1);
    });

    it('does not count substring matches (grape vs grapefruit)', () => {
        expect(queryTokenCoverage('grape', 'Grapefruit, raw')).toBe(0);
    });

    it('is 0 when no query token appears — the ryse/rye case', () => {
        // "ryse" is one edit from "rye" but under the 6-char fuzzy floor,
        // so engine typo-expansion hits must NOT count as coverage
        expect(queryTokenCoverage('ryse blueberry muffin', 'light rye flour')).toBe(0);
    });

    it('is fractional for partial matches', () => {
        expect(queryTokenCoverage('ryse blueberry muffin', 'Blueberry Muffin Protein')).toBeCloseTo(2 / 3);
    });

    it('counts brand tokens toward coverage', () => {
        expect(queryTokenCoverage('ryse blueberry muffin', 'Blueberry Muffin Protein', 'RYSE')).toBe(1);
    });

    it('tolerates one typo on tokens of 6+ chars', () => {
        expect(queryTokenCoverage('chcken breast', 'Chicken, breast, raw')).toBe(1);
    });

    it('does not fuzzy-match short tokens', () => {
        expect(queryTokenCoverage('rice', 'Ride, imaginary product')).toBe(0);
    });

    it('returns 0 for an empty/unusable query', () => {
        expect(queryTokenCoverage('', 'Grapes, raw')).toBe(0);
        expect(queryTokenCoverage('a', 'Grapes, raw')).toBe(0);
    });

    it('handles diacritics', () => {
        expect(queryTokenCoverage('creme brulee', 'Crème Brûlée dessert')).toBe(1);
    });
});
