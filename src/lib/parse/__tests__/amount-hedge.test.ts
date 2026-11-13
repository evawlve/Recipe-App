import { readLeadingAmountHedge, AMOUNT_HEDGE_FRACTION } from '../amount-hedge';

// The 16 distinct all-time MEL lines the reader fires on (census, 2026-10-19).
const ORGANIC = [
    'a little bit of the cheesecake',
    'a bit of broccoli',
    'a little bit of zucchini',
    'a bit of cheddar',
    'a little bit of cheese',
    'a little bit of onion',
    'a bit of chopped bell peppers',
    'little bit of zucchini',
    'a little bit of spinach',
    'a bit of leftover curry',
    'a little bit of pepper jack',
    'a bit of bell peppers',
    'a bit of avocado oil',
    'a little bit of turkey',
    'little bit of cheese',
    'a little bit of rice',
];

describe('readLeadingAmountHedge', () => {
    it('is half', () => {
        expect(AMOUNT_HEDGE_FRACTION).toBe(0.5);
    });

    it.each(ORGANIC)('fires on organic line: %s', (line) => {
        expect(readLeadingAmountHedge(line)).toBe(0.5);
    });

    it.each([
        'a little bit of half and half',
        'a bit of an onion',
        'A LITTLE BIT OF CHEESE',
        'a bit of everything bagel',
        '  a bit  of   onion',
    ])('fires on %s', (line) => {
        expect(readLeadingAmountHedge(line)).toBe(0.5);
    });

    it.each([
        // digit, stacking, own quantity or unit
        'a bit of 2 eggs',
        'a bit of 2 cups of rice',
        'a bit of a cup of rice',
        'a bit of a dozen eggs',
        'a bit of half a bagel',
        'a bit of a little bit of rice',
        'a bit over 2 cups of popcorn',
        'with a bit of avocado oil',
        'scrambled with a bit of chopped bell peppers',
        // not a hedge at all
        'a dozen eggs',
        'half a bagel',
        'a cup of rice',
        'a slice of pizza',
        'two eggs',
        'one egg',
        'a bit',
        'a bit of',
        '',
        // C2: quantity words the parser leaves unread
        'a little bit of a lot of cheese',
        'a bit of lots of cheese',
        'a bit of a few almonds',
        'a bit of few almonds',
        'a bit of several grapes',
        'a bit of a couple grapes',
        'a bit of couple grapes',
        'a bit of a pair of eggs',
        'a bit of pair of eggs',
        'a bit of a third of a pie',
        'a bit of half of a pie',
        'a bit of more rice',
        'a bit of some rice',
        'a bit of each',
        'a bit of both',
        'a bit of all of it',
    ])('declines: %s', (line) => {
        expect(readLeadingAmountHedge(line)).toBeNull();
    });

    it.each([
        'bit o honey',
        'bits of bacon',
        'little caesars pizza',
        'little debbie oatmeal pie',
        'little gem lettuce',
        'a little bites muffin',
        'a little cheese',
    ])('stays quiet on name collision: %s', (line) => {
        expect(readLeadingAmountHedge(line)).toBeNull();
    });
});
