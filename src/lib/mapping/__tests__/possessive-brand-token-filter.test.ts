import { filterCandidatesByTokens, deriveMustHaveTokens } from '../filter-candidates';
import type { UnifiedCandidate } from '../gather-candidates';

/**
 * Possessive brands are invisible to the required-token filter (warm batch 01,
 * Jul 2026) — the third apostrophe fork found in this pipeline, after the cache
 * key (PR #149) and the rerank brand matcher (PR #157).
 *
 * `tokenize()` splits on `[^\w]+`, which does not include the apostrophe, so
 * "Trader Joe's" yields `{trader, joe}`; the orphan `s` is dropped by the
 * `length > 2` filter. A brand-leading query normalizes to `trader joes`, whose
 * must-have tokens are `["trader","joes"]` (only the first two core tokens are
 * required), and `joes` matches nothing. The plural rescue cannot bridge it
 * either: `singularize('joes')` hits the `-oes` branch and returns `jo`.
 *
 * The consequence is not a demotion, it is an annihilation — the filter removes
 * the entire correct-brand catalogue *before* rerank, and the survivors are
 * whichever records happen to spell the brand without an apostrophe, whatever
 * food they are. Measured on the live corpus: `trader joes scandinavian
 * swimmers` went 12 candidates → 1, and that 1 was the wrong food.
 *
 * The fix folds apostrophes ADDITIVELY: the folded tokens join the token set
 * and the folded name is tested alongside the raw one. That is what the last
 * describe block pins — a fold that *substitutes* would drop `wendy's`-shaped
 * pairs that pass today, which is why it is not what shipped.
 */

function cand(name: string, brandName?: string, id = name): UnifiedCandidate {
    return { id, source: 'openfoodfacts', name, brandName, score: 0.5, rawData: {} };
}

const names = (r: { filtered: UnifiedCandidate[] }) => r.filtered.map(c => c.name).sort();

describe('the mechanism', () => {
    it("tokenizes a possessive brand into a token the query can never carry", () => {
        // Not an assertion about the fix — an assertion about why the bug exists.
        // If this ever changes, the fix below is solving a problem that moved.
        expect(deriveMustHaveTokens('trader joes scandinavian swimmers')).toEqual(['trader', 'joes']);
    });
});

describe('possessive-brand candidates survive the required-token filter', () => {
    it('keeps the correct-brand records that the apostrophe used to remove', () => {
        const candidates = [
            cand('Scandinavian Swimmers', "Trader Joe's"),
            cand('Super Sour Scandinavian Swimmers', "Trader Joe's"),
            cand('Gummy Fish Candy', 'Some Other Brand'),
        ];
        const result = filterCandidatesByTokens(candidates, 'trader joes scandinavian swimmers');

        expect(names(result)).toEqual(['Scandinavian Swimmers', 'Super Sour Scandinavian Swimmers']);
    });

    it('folds the typographic apostrophe too — the corpus carries both spellings', () => {
        const result = filterCandidatesByTokens(
            [cand('Cold Brew Coffee Concentrate', 'Trader Joe’s')],
            'trader joes cold brew',
        );
        expect(result.filtered).toHaveLength(1);
    });

    it('matches when the brand is embedded in the name and the brand field is empty', () => {
        const result = filterCandidatesByTokens(
            [cand("Trader Joe's Unexpected Cheddar Cheese")],
            'trader joes unexpected cheddar',
        );
        expect(result.filtered).toHaveLength(1);
    });

    it('works for other possessive brands, not just this one', () => {
        expect(
            filterCandidatesByTokens([cand('Ovengold Turkey Breast', "Boar's Head")], 'boars head ovengold').filtered,
        ).toHaveLength(1);
        expect(
            filterCandidatesByTokens([cand('Organic Baby Spinach', "Nature's Promise")], 'natures promise spinach')
                .filtered,
        ).toHaveLength(1);
    });
});

describe('folding must not become substring matching', () => {
    // NOTE ON VACUITY. The first two cases below carry NO apostrophe in the
    // candidate, so `hasApostrophe` is false and the folded path is never
    // entered — they pin the surrounding filter, not this change. They are kept
    // because that behaviour still has to hold, but they are not controls for
    // the fold. The cases after them are: each has an apostrophe-bearing
    // candidate, so the new path IS exercised, and each must still be rejected.
    it('still removes a record of the right food under the wrong brand', () => {
        const result = filterCandidatesByTokens(
            [cand('Scandinavian Swimmers Gummi Candy', "Haribo")],
            'trader joes scandinavian swimmers',
        );
        expect(result.filtered).toHaveLength(0);
    });

    it('does not let an apostrophe make one word match a different one', () => {
        // "one" must not reach "Toblerone" — the hazard the whole-token rule
        // exists to prevent, unchanged by folding.
        const result = filterCandidatesByTokens([cand('Toblerone Milk Chocolate')], "one's chocolate");
        expect(result.filtered).toHaveLength(0);
    });

    it('an apostrophe in the candidate does not waive a genuinely missing token', () => {
        // Non-vacuous: "Nature's Promise" folds, so the new branch runs. The
        // query leads with the food noun so `deriveMustHaveTokens` requires
        // `granola` — which this candidate does not have, folded or not.
        const result = filterCandidatesByTokens(
            [cand('Organic Baby Spinach', "Nature's Promise")],
            'granola natures promise',
        );
        expect(result.filtered).toHaveLength(0);
    });

    it('the token the fold creates does not match an unrelated word', () => {
        // "Mary's" folds to `marys`. That must admit a query for `marys`, and
        // nothing else: `rosemary` contains `mary` as a substring and must not
        // match, folded or otherwise.
        expect(
            filterCandidatesByTokens([cand('Chicken Breast', "Mary's Chicken")], 'marys chicken').filtered,
        ).toHaveLength(1);
        expect(
            filterCandidatesByTokens([cand('Chicken Breast', "Mary's Chicken")], 'rosemary chicken').filtered,
        ).toHaveLength(0);
    });
});

describe('the fold is additive — nothing that passes today may fail now', () => {
    // A substituting fold (candidate side only) turns "Wendy's" into the single
    // token `wendys`, which loses the `wendy` token that a possessive query
    // needs. `pluralize('wendy')` is `wendies`, so the plural rescue cannot
    // bridge it and the candidate is dropped. These pairs pass before the fix
    // and must still pass after it.
    const survivors: Array<[string, UnifiedCandidate]> = [
        ["wendy's spicy chicken sandwich", cand('Spicy Chicken Sandwich', "Wendy's")],
        ["arby's roast beef", cand('Roast Beef Classic', "Arby's")],
        ["denny's pancakes", cand('Buttermilk Pancakes', "Denny's")],
        ["zaxby's chicken fingers", cand('Chicken Fingerz', "Zaxby's")],
    ];

    it.each(survivors)('keeps %s', (query, candidate) => {
        expect(filterCandidatesByTokens([candidate], query).filtered).toHaveLength(1);
    });

    it('admits the apostrophe-free query for a possessive candidate', () => {
        // Moved out of the survivor list above: this one FAILS before the fix,
        // so it is a fix assertion, not a control, and leaving it in a block
        // whose stated contract is "passes before and after" made that block's
        // comment untrue.
        expect(
            filterCandidatesByTokens([cand('Chicken Breast', "Trader Joe's")], 'trader joes chicken breast').filtered,
        ).toHaveLength(1);
    });

    it('keeps an apostrophe-free candidate whose brand has no apostrophe at all', () => {
        // The no-apostrophe path must be byte-identical to today: the fold is
        // skipped entirely when the name contains no apostrophe.
        expect(
            filterCandidatesByTokens([cand('Trail Mix Sweet and Salty', 'Members Mark')], 'members mark trail mix')
                .filtered,
        ).toHaveLength(1);
    });
});
