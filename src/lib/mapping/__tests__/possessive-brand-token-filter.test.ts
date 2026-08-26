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
    it("requires the brand and the FOOD, not two tokens of the brand", () => {
        // Not an assertion about the fix — an assertion about why the bug exists.
        // If this ever changes, the fix below is solving a problem that moved.
        //
        // RE-ADJUDICATED 2026-08-14, deliberately, not silently. This pinned
        // ['trader','joes'] — both halves of the brand, no food token — as the
        // mechanism behind the apostrophe bug this file fixes. That reading was
        // right about the apostrophe and wrong about what it implied: requiring
        // ['trader','joes'] means ANY Trader Joe's product satisfies admission,
        // which is a second, brand-agnostic defect measured on 2026-08-14
        // (`kirkland signature mini croissants` -> a Mini Choc Hazelnut Beignet,
        // 4.9x under-billed). `keepAFoodToken()` now spends the second slot on the
        // food, so the brand still constrains admission AND the food is required.
        //
        // The apostrophe fix this file exists for is untouched and still load-bearing:
        // 'trader' only matches a "Trader Joe's" candidate because the fold puts
        // {trader, joes} into the candidate token set. The behavioural assertions
        // below are unchanged and still pass.
        //
        // RE-ADJUDICATED AGAIN 2026-08-25 (K2), deliberately, not silently:
        // ['trader','scandinavian'] -> ['trader','swimmers']. The 2026-08-14 reading above
        // was right that a food token must be required and wrong about WHICH one. Taking the
        // first food token spends the slot on the modifier, so this admitted any Trader Joe's
        // "Scandinavian" anything; the product is `Scandinavian Swimmers`, and its head noun
        // is what identifies it. Same correction, one word further along the line.
        expect(deriveMustHaveTokens('trader joes scandinavian swimmers')).toEqual(['trader', 'swimmers']);
    });

    it('leaves a query that already required a food token exactly as it was', () => {
        // Single-token brands were never affected — the food already had a slot.
        expect(deriveMustHaveTokens('costco mini croissants')).toEqual(['costco', 'croissants']);
        // Non-brand queries must not move at all.
        expect(deriveMustHaveTokens('grilled chicken breast')).toEqual(['grilled', 'chicken']);
    });

    it('leaves a bare brand query alone — there is no food token to require', () => {
        expect(deriveMustHaveTokens('kirkland signature')).toEqual(['kirkland', 'signature']);
    });

    it('KNOWN LIMIT: a two-brand query is still only HALF repaired', () => {
        // `sams club members mark chicken` detects `members mark`, so ['sams','club'] read as
        // non-brand tokens against that entry.
        //
        // RE-ADJUDICATED 2026-08-25 (K2): ['sams','club'] -> ['sams','chicken']. The half of
        // this limit that was about admitting ANY product is CLOSED — the head-noun rule spends
        // the second slot on the food whether or not slot 0 is a brand token, so a food token is
        // now required here too. The half that is NOT closed is the one this test was named for:
        // the brand constraint is still `sams`, a token of the WRONG lexicon entry, because
        // detectBrandInQuery() returns one brand per line. Multi-brand detection is still absent
        // and is still a brand-detector change the frozen-pool winner-diff cannot observe.
        expect(deriveMustHaveTokens('sams club members mark chicken')).toEqual(['sams', 'chicken']);
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
