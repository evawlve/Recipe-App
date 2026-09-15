/**
 * PUNCH #114 (Lane A S51, 2026-09-15) — a rewrite whose `to` contains its `from` grows the
 * word it rewrote, and step 2's repeated-word dedupe has already run by then.
 * `collapseAdjacentRepeatedRuns()` now runs once, after every rewrite and bare-word default.
 *
 * The `normalizeIngredientName()` rows are MEASURED movers, not invented ones: every distinct
 * argument the shipped mapper handed the function for the 602 distinct `SegmentationCache`
 * tuples and the 8,141 distinct `MappingEventLog` rawLines (6,744 arguments, captured under a
 * write guard) was replayed through master `9d97675` and this branch, and exactly 15 moved —
 * every one an adjacent repeated run (`scripts/eval/punch-114-rewrite-replay/`). Master's
 * output is in each row's comment. They read the tracked `data/fatsecret/normalization-rules.json`,
 * which hashes identical to the box's copy.
 */
import { collapseAdjacentRepeatedRuns, normalizeIngredientName, clearRulesCache } from '../normalization-rules';

describe('collapseAdjacentRepeatedRuns', () => {
    it.each([
        ['light light corn syrup', 'light corn syrup'],
        ['vital wheat vital wheat vital wheat gluten', 'vital wheat gluten'],
        ['canned canned canned kidney beans', 'canned kidney beans'],
        ['garlic powder spice spice', 'garlic powder spice'],
        ['Rolled rolled oats', 'Rolled oats'],
    ])('%s -> %s', (input, expected) => {
        expect(collapseAdjacentRepeatedRuns(input)).toBe(expected);
    });

    it('returns the input untouched, whitespace included, when no run repeats', () => {
        expect(collapseAdjacentRepeatedRuns('dark  light corn syrup')).toBe('dark  light corn syrup');
        expect(collapseAdjacentRepeatedRuns('')).toBe('');
    });

    it('leaves a repeat that is not adjacent alone', () => {
        expect(collapseAdjacentRepeatedRuns('wheat vital wheat gluten')).toBe('wheat vital wheat gluten');
    });
});

describe('normalizeIngredientName — a rewrite no longer grows a word the line already carries (#114)', () => {
    beforeEach(() => clearRulesCache());

    it.each([
        ['light corn syrup', 'light corn syrup'], //            master: light light corn syrup
        ['rolled oats', 'rolled oats'], //                      master: rolled rolled oats (709 MEL events)
        ['dry rolled oats', 'dry rolled oats'], //              master: dry rolled rolled oats
        ['kidney beans', 'canned kidney beans'], //             master: canned canned kidney beans
        ['canned kidney beans', 'canned kidney beans'], //      master: canned canned canned kidney beans
        ['plain rice vinegar', 'plain rice vinegar'], //        master: plain plain rice vinegar
        ['pumpkin pie spice', 'pumpkin pie spice'], //          master: pumpkin pumpkin pie spice
        ['garlic powder spice', 'garlic powder spice'], //      master: garlic powder spice spice
        ['lasagna noodles', 'lasagna noodles'], //              master: lasagna noodles noodles
        ['vital wheat gluten', 'vital wheat gluten'], //        master: vital wheat vital wheat vital wheat gluten
        ['gluten', 'vital wheat gluten'], //                    master: vital wheat vital wheat gluten
    ])('%s -> %s', (input, expected) => {
        expect(normalizeIngredientName(input).cleaned).toBe(expected);
        expect(normalizeIngredientName(input).nounOnly).toBe(expected);
    });

    it('still applies a self-growing rewrite once where the line lacks the added words', () => {
        expect(normalizeIngredientName('corn syrup').cleaned).toBe('light corn syrup');
    });

    it('never reaches a brand-led product name, which returns before every rewrite', () => {
        // `in-n-out double double` is a menu item: collapsing it would change identity. The
        // brand-led early return in normalizeIngredientName() sits above the collapse.
        expect(normalizeIngredientName('in-n-out double double').cleaned.toLowerCase()).toContain('double double');
    });
});
