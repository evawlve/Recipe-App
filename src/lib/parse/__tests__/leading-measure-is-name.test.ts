/**
 * #307 — a leading mass/volume word that opens a FOOD NAME is not a measure.
 *
 * `pound cake slice` parsed to qty 1, unit lb, name `cake`: `normalizeUnitToken()`
 * maps `pound` to `lb` and MASS_IN_G.lb is 453.6, so the line billed a pound of
 * whatever `cake` resolved to. `leadingMeasureWordIsName()` in ingredient-line.ts
 * decides once, and all three consumption sites honour it.
 *
 * Every tuple here is exact. The CONTROL tuples were replayed on the shipped
 * parser (master `95d2dc4`) BEFORE the change and pinned as it produced them, so a
 * control failing means the rule reached a line it was scoped away from.
 *
 * Mutation receipts (run while building this, 2026-09-25):
 *   - guard only the first two sites (drop the after-parentheses guard): every
 *     target and named-cost pin reds (9 of 28) — the third site takes `pound` as
 *     the unit exactly as it did before. Dropping the second site's guard instead
 *     reds the same 9: its own `!startsWithUnit || i > 0` lets a declined
 *     startsWithUnit straight through.
 *   - disable the rule outright: the same 9 red.
 *   - drop the article capture (pass `false` for hadLeadingArticle): the
 *     `an ounce cheese` and `a pound cake` pins red. `a cup and a half of
 *     teriyaki chicken` stays green under that mutation because the rule also
 *     declines a connector follower — the connector clause is its own guard.
 *   - drop the connector clause: the `cup and a half of rice` pin reds.
 */

import { parseIngredientLine } from '../ingredient-line';

type Tuple = { qty: number; unit: string | null; name: string; unitHint: string | null };

function tuple(line: string): Tuple | null {
    const p = parseIngredientLine(line);
    if (!p) return null;
    return { qty: p.qty, unit: p.unit ?? null, name: p.name, unitHint: p.unitHint ?? null };
}

describe('#307 targets — the leading word is the food', () => {
    it.each<[string, Tuple]>([
        ['pound cake slice', { qty: 1, unit: null, name: 'pound cake', unitHint: 'slice' }],
        ['pound cake', { qty: 1, unit: null, name: 'pound cake', unitHint: null }],
        // The trailing count stays in the name, as the design states; it no longer
        // costs the line its identity or bills 453.6 g.
        ['pound cake 1 slice', { qty: 1, unit: null, name: 'pound cake 1', unitHint: 'slice' }],
        ['cup noodles', { qty: 1, unit: null, name: 'cup noodles', unitHint: null }],
    ])('%s', (line, expected) => {
        expect(tuple(line)).toEqual(expected);
    });

    it('keeps the qualifier strip working after the name', () => {
        expect(parseIngredientLine('pound cake, sliced')).toMatchObject({
            qty: 1, unit: null, name: 'pound cake', qualifiers: ['sliced'],
        });
    });
});

describe('#307 controls — byte-identical to the shipped parser', () => {
    it.each<[string, Tuple]>([
        // An explicit portion before the name: the rule never sees `pound` at [0].
        ['1 slice pound cake', { qty: 1, unit: 'slice', name: 'pound cake', unitHint: null }],
        ['2 lb pound cake', { qty: 2, unit: 'lb', name: 'pound cake', unitHint: null }],
        ['slice of pound cake', { qty: 1, unit: 'slice', name: 'pound cake', unitHint: null }],
        // The partitive `of` marks a genuine measure.
        ['cup of egg whites', { qty: 1, unit: 'cup', name: 'egg', unitHint: 'white' }],
        ['pinch of salt', { qty: 1, unit: 'pinch', name: 'salt', unitHint: null }],
        // An article stood in for the quantity (leadingArticlePrecedesUnit shifted it).
        ['a cup and a half of teriyaki chicken', { qty: 1.5, unit: 'cup', name: 'teriyaki chicken', unitHint: null }],
        ['an ounce of cheese', { qty: 1, unit: 'oz', name: 'cheese', unitHint: null }],
        ['an ounce cheese', { qty: 1, unit: 'oz', name: 'cheese', unitHint: null }],
        // KNOWN LIMIT, not a target: the article reading wins, so this still parses
        // as a pound of `cake`. Pinned so a change to it is deliberate.
        ['a pound cake', { qty: 1, unit: 'lb', name: 'cake', unitHint: null }],
        // Count words are out of scope (mass/volume only).
        ['squirt soda', { qty: 1, unit: 'squirt', name: 'soda', unitHint: null }],
        // Already a wrong parse today, and not this rule's: `quarter` is a fraction word.
        ['quarter pounder', { qty: 0.25, unit: null, name: 'pounder', unitHint: null }],
        // `half` is a multiplier, so `pound` is never at [0] and the rule never fires.
        ['half pound cake', { qty: 0.5, unit: 'lb', name: 'cake', unitHint: null }],
        // A quantity precedes, so the rule does not fire. Also a wrong parse today —
        // `1 pound cake` is genuinely ambiguous — and out of #307's scope.
        ['about 1 pound cake', { qty: 1, unit: 'lb', name: 'cake', unitHint: null }],
        // A follower that is not a word, or is a connector, keeps the measure reading.
        ['cup and a half of rice', { qty: 1.5, unit: 'cup', name: 'rice', unitHint: null }],
        ['cup plus 2 tbsp flour', { qty: 1.12325, unit: 'cup', name: 'flour', unitHint: null }],
        ['cup (8 oz) milk', { qty: 1, unit: 'cup', name: '8 oz milk', unitHint: null }],
        ['pounds of chicken', { qty: 1, unit: 'lb', name: 'chicken', unitHint: null }],
        // No follower: the unit-as-name fallback is unchanged.
        ['pound', { qty: 1, unit: 'lb', name: 'pound', unitHint: null }],
    ])('%s', (line, expected) => {
        expect(tuple(line)).toEqual(expected);
    });

    it('cup, packed, brown sugar', () => {
        expect(parseIngredientLine('cup, packed, brown sugar')).toMatchObject({
            qty: 1, unit: 'cup', name: 'brown sugar', qualifiers: ['packed'],
        });
    });
});

describe('#307 named costs — a digitless, article-less measure with no `of` is now a name', () => {
    // 0 of the 6,980-line organic census (Lane A S58) reads this way. Accepted as
    // stated costs; Lane A's pinned composite arm decides whether any of them is a
    // worse food, and reverses the rule if so.
    it.each<[string, Tuple]>([
        ['pound ground beef', { qty: 1, unit: null, name: 'pound ground beef', unitHint: null }],
        ['ounce cheese', { qty: 1, unit: null, name: 'ounce cheese', unitHint: null }],
        ['cup rice', { qty: 1, unit: null, name: 'cup rice', unitHint: null }],
        ['tbsp peanut butter', { qty: 1, unit: null, name: 'tbsp peanut butter', unitHint: null }],
    ])('%s', (line, expected) => {
        expect(tuple(line)).toEqual(expected);
    });
});
