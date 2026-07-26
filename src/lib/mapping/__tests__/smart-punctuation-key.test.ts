import { canonicalizeCacheKey, normalizeIngredientName } from '../normalization-rules';

/** normalizeIngredientName returns {cleaned, nounOnly, stripped}; the key is built from `cleaned`. */
const norm = (s: string): string => normalizeIngredientName(s).cleaned;

/**
 * iOS Smart Punctuation split every possessive brand into two cache spaces.
 *
 * `collapseSpaces` preserved only the STRAIGHT apostrophe: its strip is
 * `[^\w\s'%\-]`, so `’ ‘ ʼ ´` all became a SPACE. That ran upstream of
 * `canonicalizeCacheKey`, whose `['‘’ʼ`´]` fold exists precisely to collapse
 * possessives — by the time it ran the apostrophe was already gone and an
 * orphan `s` token was in its place.
 *
 * This is not a theoretical spelling. `ChunkyInput` is a bare React Native
 * `TextInput` with no `autoCorrect={false}`, and iOS Smart Punctuation is on by
 * default, so `’` is the DEFAULT spelling arriving from the mobile client. A
 * user typing "McDonald's fries" on an iPhone and a user typing it on a desktop
 * keyboard were reaching different cache rows.
 *
 * Measured live before the fix (write-guarded probe, stable across two runs):
 *   "amy's lentil soup"  -> fs_46343    Organic Lentil Soup        81.60 kcal
 *   "amy’s lentil soup"  -> off_00422…  Amy's Organic Lentil Soup  52.55 kcal
 * A different food and a 55% difference in what the user is billed, decided by
 * which keyboard they used.
 *
 * Same root cause as PR #149 (apostrophes splitting the key space), one layer
 * upstream of the fix that closed it.
 */

const SPELLINGS: Array<[string, string]> = [
    ['straight', "mcdonald's fries"],
    ['curly (iOS default)', 'mcdonald’s fries'],
    ['bare', 'mcdonalds fries'],
    ['modifier letter', 'mcdonaldʼs fries'],
    ['acute accent', 'mcdonald´s fries'],
    ['left single quote', 'mcdonald‘s fries'],
];

describe('every apostrophe glyph reaches one cache key', () => {
    it.each(SPELLINGS)('%s spelling agrees with the straight one', (_label, text) => {
        expect(canonicalizeCacheKey(norm(text)))
            .toBe(canonicalizeCacheKey(norm("mcdonald's fries")));
    });

    it('leaves no orphan "s" token in the key', () => {
        // The specific corruption: "mcdonald’s" -> "mcdonald s" -> key token "s".
        // Before the fix the curly spelling produced "fry mcdonald s".
        for (const [, text] of SPELLINGS) {
            const key = canonicalizeCacheKey(norm(text));
            expect(key.split(' ')).not.toContain('s');
        }
    });

    it('agrees for other possessive brands too', () => {
        for (const brand of ['arby', 'wendy', 'amy', 'trader joe']) {
            const straight = canonicalizeCacheKey(norm(`${brand}'s curly fries`));
            const curly = canonicalizeCacheKey(norm(`${brand}’s curly fries`));
            expect(curly).toBe(straight);
        }
    });
});

describe('the characters collapseSpaces was written to protect are untouched', () => {
    it('keeps the percent sign — "2% milk" is nutritionally distinct from "2 milk"', () => {
        expect(norm('2% milk')).toContain('%');
    });

    it('keeps hyphens in compound words', () => {
        expect(norm('all-purpose flour')).toContain('-');
    });

    it('still strips punctuation that is not an apostrophe', () => {
        // The fold must not turn into "preserve everything".
        expect(norm('chicken (boneless), diced')).not.toMatch(/[(),]/);
    });

    it('does not merge two words that were separated by real punctuation', () => {
        // "&" must still become a separator, not vanish into a merged token.
        // (A synonym rule also expands this to "salt black pepper" — the point
        // here is only that the two words did not fuse.)
        const n = norm('salt&pepper');
        expect(n).not.toContain('salt&pepper');
        expect(n.split(/\s+/)).toEqual(expect.arrayContaining(['salt', 'pepper']));
    });
});
