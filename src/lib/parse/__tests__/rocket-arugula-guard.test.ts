/**
 * FIX 2: the British "rocket" -> "arugula" produce synonym must stay out of
 * branded/flavor product names. "bucked up rocket pop pre workout" was being
 * normalized to "...arugula pop..." and then matched an "Arugula Lettuce"
 * record. The guard keeps genuine produce phrasing working.
 */
import { guardedRocketToArugula } from '../ingredient-line';
import { parseIngredientLine } from '../ingredient-line';

describe('guardedRocketToArugula', () => {
    it('rewrites genuine produce "rocket salad" -> "arugula salad"', () => {
        expect(guardedRocketToArugula('rocket salad')).toBe('arugula salad');
    });

    it('rewrites "wild rocket" -> "wild arugula"', () => {
        expect(guardedRocketToArugula('wild rocket')).toBe('wild arugula');
    });

    it('rewrites "rocket leaves" -> "arugula leaves"', () => {
        expect(guardedRocketToArugula('rocket leaves')).toBe('arugula leaves');
    });

    it('leaves a bare "rocket" -> "arugula" (produce)', () => {
        expect(guardedRocketToArugula('rocket')).toBe('arugula');
    });

    it('does NOT rewrite inside a branded line ("bucked up rocket pop pre workout")', () => {
        const out = guardedRocketToArugula('bucked up rocket pop pre workout');
        expect(out).toBe('bucked up rocket pop pre workout');
        expect(out).not.toContain('arugula');
    });

    it('does NOT rewrite "rocket pop" flavor even without a detected brand', () => {
        const out = guardedRocketToArugula('rocket pop');
        expect(out).toBe('rocket pop');
        expect(out).not.toContain('arugula');
    });

    it('is a no-op when the line has no "rocket" token', () => {
        expect(guardedRocketToArugula('spinach salad')).toBe('spinach salad');
    });
});

describe('parseIngredientLine end-to-end rocket handling', () => {
    it('keeps "rocket" in a branded flavor name (no arugula leak)', () => {
        const parsed = parseIngredientLine('1 scoop bucked up rocket pop pre workout');
        expect(parsed).not.toBeNull();
        expect(parsed!.name.toLowerCase()).toContain('rocket');
        expect(parsed!.name.toLowerCase()).not.toContain('arugula');
    });

    it('still converts produce "rocket" to arugula in the parsed name', () => {
        const parsed = parseIngredientLine('2 cups rocket');
        expect(parsed).not.toBeNull();
        expect(parsed!.name.toLowerCase()).toContain('arugula');
    });
});
