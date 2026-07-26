import { filterCandidatesByTokens, deriveMustHaveTokens } from '../filter-candidates';
import type { UnifiedCandidate } from '../gather-candidates';

/**
 * THE PLURAL FORK, -o SUB-CLASS (Jul 2026).
 *
 * `canonicalizeCacheKey` singularizes every token before it stores
 * `FoodMapping.normalizedForm`, so "dorito" and "doritos" share ONE cache row.
 * `deriveMustHaveTokens` does NOT singularize, so the two spellings are admitted
 * through DIFFERENT required-token filters. Whichever spelling resolves cold
 * first writes the row both spellings then read.
 *
 * For most nouns the fork is harmless, because the required-token check already
 * expands `getSingularPluralVariants(token)` and the two spellings converge.
 * It does NOT converge for -o nouns, and the reason is one line:
 *
 *     pluralize():  if (word.endsWith('o')) return word + 'es';
 *
 * That is right for potato/tomato and wrong for every other English -o noun.
 * A required token `dorito` can only re-generate `doritoes`, never `doritos`.
 * Measured on the live OFF corpus (corrupt rows excluded): 10 records reachable
 * from `dorito`, 789 from `dorito`+`doritos` — and the 10 include "Beef Jerky
 * Dorito Flavour". Pool-constant run over a real 400-record pool: `dorito`
 * admitted 3, `doritos` admitted 152, Jaccard 2.0%.
 *
 * The fix adds the `-os` form ALONGSIDE `-oes`, never instead of it. That makes
 * it admit-only by inspection, not by measurement: the sole call site (inside
 * `mustHaveTokens.every(...)`) tests the variants as a disjunction where every
 * hit `return true`s, so a longer variant list cannot reject anything that
 * passes today. The `potato`/`tomato` block below is what pins "alongside" —
 * substituting would drop them, which is the exact mistake the possessive
 * token-filter work (PR #160) recorded.
 *
 * Scope, stated so nobody over-claims it: this closes the sub-class where the
 * token filter provably cannot bridge. It does NOT fix egg/eggs — the largest
 * observed divergence — because the filter already treats those as equivalent
 * (see the last describe block, which pins that as unchanged).
 */

function cand(name: string, brandName?: string, id = name): UnifiedCandidate {
    return { id, source: 'openfoodfacts', name, brandName, score: 0.5, rawData: {} };
}

const kept = (query: string, candidate: UnifiedCandidate): number =>
    filterCandidatesByTokens([candidate], query, { rawLine: query }).filtered.length;

describe('the mechanism', () => {
    // Not assertions about the fix — assertions about why the bug exists. If
    // either of these changes, the fix below is solving a problem that moved.
    it('does not singularize, so the two spellings carry different required tokens', () => {
        expect(deriveMustHaveTokens('dorito nacho cheese')).toEqual(['dorito', 'nacho']);
        expect(deriveMustHaveTokens('doritos nacho cheese')).toEqual(['doritos', 'nacho']);
    });

    it('the plural spelling was never the broken one — singularize() bridges that direction', () => {
        // `singularize('doritos')` → 'dorito', so a plural query already reached
        // singular-spelled records before this fix. Only singular→plural was broken.
        expect(kept('doritos', cand('Dorito Flavored Seasoning'))).toBe(1);
    });
});

describe('a singular -o query reaches the -s-spelled records', () => {
    // Every one of these is REJECTED without the fix.
    const wins: Array<[string, UnifiedCandidate]> = [
        ['dorito nacho cheese', cand('Doritos Nacho Cheese Flavored Tortilla Chips', 'Doritos')],
        ['cheeto crunchy', cand('Cheetos Crunchy Cheese Flavored Snacks', 'Cheetos')],
        ['tostito scoop', cand('Tostitos Scoops Tortilla Chips', 'Tostitos')],
        ['frito corn chips', cand('Fritos Original Corn Chips', 'Fritos')],
        ['cheerio', cand('Cheerios', 'General Mills')],
        ['churro', cand('Churros')],
        ['nacho', cand('Nachos')],
        ['fish taco', cand('Fish Tacos')],
        ['oiko greek yogurt', cand('Oikos Greek Nonfat Yogurt', 'Dannon')],
        ['combo cheddar pretzel', cand('Combos Cheddar Cheese Pretzel Baked Snacks', 'Combos')],
        ['avocado', cand('Avocados, Hass')],
        // Fixture note: 'Oreos Chocolate Sandwich Cookies' is NOT usable here —
        // it is removed by isMealProductMismatch, downstream of the token check,
        // so it would pass/fail for a reason unrelated to this fix. The blanket
        // FilterResult.reason ('removed_by_must_have_tokens') hides that; only
        // the debug:true log distinguishes them.
        ['oreo', cand('Oreos', 'Nabisco')],
    ];

    it.each(wins)('admits %s', (query, candidate) => {
        expect(kept(query, candidate)).toBe(1);
    });

    it('bridges through the -oes singularize branch too, not just the raw token', () => {
        // `joes` → singularize → `jo` → the new branch adds `jos`. The live
        // corpus carries a record literally spelled "trader jos"; without this
        // it is unreachable from any spelling of the brand. 10 OFF records gain
        // reachability this way and 9 of them ("Jos Louis", "Jos Andrés Foods")
        // stay rejected because `trader` is co-required — see the control below.
        expect(kept('trader joes potato chips', cand('Trader Jos Potato Chips'))).toBe(1);
    });
});

describe('negative controls — the new branch runs and must still reject', () => {
    // VACUITY NOTE. Each case below has a required token ending in -o (or whose
    // singularize output does), so `getSingularPluralVariants` DOES take the new
    // branch and the new `-os` string IS built and tested against the candidate.
    // The first three assert that non-vacuity directly: each pairs a candidate
    // that ONLY the new `-os` string can admit (so the branch provably ran and
    // provably produced that string) against a candidate that must still be
    // rejected. Without the pairing a "still rejected" assertion proves nothing,
    // because it also holds on a build where the branch does not exist.

    it('the -os form is word-bounded: "mangos" reaches Mangos, never Mangosteen', () => {
        expect(kept('mango', cand('Mangos Fresh Whole'))).toBe(1); // only reachable via the new string
        expect(kept('mango', cand('Mangosteen Juice'))).toBe(0);
    });

    it('"tacos" reaches Tacos, never Tabasco', () => {
        expect(kept('taco', cand('Tacos Al Pastor Kit'))).toBe(1);
        expect(kept('taco', cand('Tabasco Pepper Sauce', 'McIlhenny'))).toBe(0);
    });

    it('"burritos" reaches Burritos, never Burrata', () => {
        // 'Burritos Beef' would be wrong here: isMealProductMismatch removes it
        // downstream, for reasons unrelated to the token filter.
        expect(kept('burrito', cand('Bean Burritos'))).toBe(1);
        expect(kept('burrito', cand('Burrata Fresh Italian Cheese'))).toBe(0);
    });

    it('a second required token that is absent is still fatal', () => {
        // `dorito` matches this candidate outright, so the fixed branch runs for
        // `nacho`: variants now include `nachos`, none of which appear. Reject.
        expect(kept('dorito nacho cheese', cand('Beef Jerky Dorito Flavour', 'Jack Links'))).toBe(0);
    });

    it('the right food under the wrong brand is still removed', () => {
        // mustHave = ['dorito','nacho']; the fix gives `dorito` its 779 extra
        // records but this one is not among them.
        expect(kept('dorito nacho cheese', cand('Nacho Cheese Tortilla Rounds', 'Store Brand'))).toBe(0);
    });

    it('the -os variant does not waive the co-required brand token', () => {
        // "Jos Louis" is one of the 10 records `jos` newly reaches. It must
        // still fail, because `trader` is the other required token.
        expect(kept('trader joes sponge cake', cand('Jos Louis Sponge Cakes', 'Vachon'))).toBe(0);
    });
});

describe('the -oes plural is preserved — this is a union, not a substitution', () => {
    // potato/tomato are the ~4,445 / 3,529-record reason the -oes branch exists.
    // If a future edit replaces `+'es'` with `+'s'` instead of adding it, these
    // four fail. That is the whole contract of this block.
    it('potato still reaches Potatoes and now also reaches the -os misspelling', () => {
        expect(kept('potato', cand('Mashed Potatoes'))).toBe(1);
        expect(kept('potato', cand('Potatos, Red'))).toBe(1);
    });

    it('tomato still reaches Tomatoes and now also reaches the -os misspelling', () => {
        expect(kept('tomato sauce', cand('Tomatoes Sauce'))).toBe(1);
        expect(kept('tomato sauce', cand('Tomatos Sauce Classic'))).toBe(1);
    });

    it('the plural spellings still resolve back to the singular records', () => {
        expect(kept('potatoes', cand('Potato, Russet'))).toBe(1);
        expect(kept('tomatoes', cand('Tomato, Vine Ripened'))).toBe(1);
    });
});

describe('untouched classes — brands ending in s, the y→ies branch, and -ses', () => {
    // These are the singularize()/pluralize() mangling hazards adjacent to the
    // change. None of them involves an -o base, so the new loop cannot fire, and
    // every one of these passes identically before and after. They are here as
    // tripwires: if someone later "generalizes" the fix into pluralize() itself,
    // or substitutes rather than appends, this block is what catches it.

    it('possessive brands still match — PR #157/#160 territory, y→ies untouched', () => {
        expect(kept("wendy's spicy chicken sandwich", cand('Spicy Chicken Sandwich', "Wendy's"))).toBe(1);
        expect(kept("zaxby's chicken fingers", cand('Chicken Fingerz', "Zaxby's"))).toBe(1);
        expect(kept('trader joes chicken breast', cand('Chicken Breast', "Trader Joe's"))).toBe(1);
        expect(kept('trader joes scandinavian swimmers', cand('Scandinavian Swimmers', "Trader Joe's"))).toBe(1);
    });

    it('a brand that genuinely ends in s is unaffected', () => {
        expect(kept('pringles original', cand('Pringles Original Potato Crisps', 'Pringles'))).toBe(1);
        expect(kept('chomps beef stick', cand('Chomps Original Beef Stick', 'Chomps'))).toBe(1);
    });

    it('the -ses class is exactly as it was — this fix deliberately does not touch it', () => {
        // `singularize('cheeses')` in THIS module's shadow copy still yields
        // 'chees' (the -ses guard shipped in PR #151 lives in
        // normalization-rules.ts, not here). Pinned as-is, not endorsed: it is a
        // separate defect with its own blast radius.
        expect(kept('cheese', cand('Assorted Cheeses'))).toBe(1);
        expect(kept('cheeses', cand('Cheddar Cheese'))).toBe(0);
        expect(kept('molasses', cand('Blackstrap Molasses'))).toBe(1);
    });

    it('egg/eggs is NOT fixed by this and must not be claimed as such', () => {
        // The filter already treats these as equivalent — `singularize('eggs')`
        // is 'egg' and `pluralize('egg')` is 'eggs' — so the egg/eggs divergence
        // (773 events, two records at 50 g vs 42 g per egg) is retrieval or
        // rerank, not deriveMustHaveTokens. Both directions pass before AND
        // after; this asserts the fix changed nothing here.
        expect(kept('egg', cand('Eggs', 'New Day Eggs'))).toBe(1);
        expect(kept('eggs', cand('Egg', 'Oakdell Egg Farm'))).toBe(1);
    });
});
