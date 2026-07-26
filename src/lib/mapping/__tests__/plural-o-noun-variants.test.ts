import { filterCandidatesByTokens, deriveMustHaveTokens } from '../filter-candidates';
import type { UnifiedCandidate } from '../gather-candidates';

/**
 * THE PLURAL FORK, -o SUB-CLASS (Jul 2026).
 *
 * `canonicalizeCacheKey` singularizes every token before it stores
 * `FoodMapping.normalizedForm`, so "dorito" and "doritos" share ONE cache row.
 * `deriveMustHaveTokens` does NOT singularize, so the two spellings are admitted
 * through DIFFERENT required-token filters. Whichever spelling resolves cold
 * first writes the row that both spellings then read.
 *
 * For most nouns the fork is harmless: the required-token check expands
 * `getSingularPluralVariants(token)` and the two spellings converge. It does not
 * converge for -o nouns, and the reason is one line in `pluralize()`:
 *
 *     if (word.endsWith('o')) return word + 'es';
 *
 * Right for potato/tomato, wrong for every other English -o noun. A required
 * token `dorito` could only ever re-generate `doritoes`. Corpus census (OFF,
 * corrupt rows excluded): doritoes 0 records vs doritos 783; cheetoes 0 vs
 * cheetos 512; tostitoes 0 vs tostitos 242. The rescue was a proven no-op.
 *
 * The fix appends the `-os` form ALONGSIDE `-oes`, never instead of it, and
 * derives it from the ORIGINAL query token only.
 *
 * READ THIS BEFORE EDITING THE FIXTURES — two ways this file has already been
 * fooled once:
 *
 *  1. NOT-VACUOUS. The union-vs-substitution block must not use potato/tomato:
 *     both are hardcoded in TOKEN_SYNONYMS (filter-candidates.ts:84-91) and are
 *     rescued no matter what `pluralize()` does. A mutation applying the exact
 *     substitution that block existed to forbid once left every test green.
 *     `mango` is the fixture instead — it is in no synonym table, and the live
 *     corpus has 167 rows word-matching "mangoes" against a separate population
 *     spelled "mangos". The potato/tomato cases below are kept only as
 *     regression pins and are explicitly NOT the union proof.
 *
 *  2. BINDING. A negative control only means something if the TOKEN GATE is what
 *     rejects the candidate. `FilterResult.reason` is a blanket label, so every
 *     control here is paired with a variant that satisfies the token said to be
 *     fatal and is then KEPT. Two candidates were dropped from this file for
 *     failing that check — "Beef Jerky Dorito Flavour" and "Joes Andrés Foods
 *     Paella" are rejected by gates downstream of the token check, so they could
 *     never have failed and proved nothing.
 *
 * Every control also runs in BOTH strict and relaxed mode. The caller's relaxed
 * retry (map-ingredient-with-fallback.ts:1598-1614) keeps only the LAST
 * must-have token, which is how a co-required token like `trader` disappears —
 * a control that only holds because of a co-required token is strict-only.
 */

function cand(name: string, brandName?: string, id = name): UnifiedCandidate {
    return { id, source: 'openfoodfacts', name, brandName, score: 0.5, rawData: {} } as UnifiedCandidate;
}

/** strict mode: the full must-have token list is required */
const kept = (query: string, candidate: UnifiedCandidate): number =>
    filterCandidatesByTokens([candidate], query, { rawLine: query }).filtered.length;

/** relaxed mode: the caller's retry, which keeps only the LAST must-have token */
const keptRelaxed = (query: string, candidate: UnifiedCandidate): number =>
    filterCandidatesByTokens([candidate], query, { rawLine: query, relaxed: true }).filtered.length;

describe('the mechanism', () => {
    // Not assertions about the fix — assertions about why the bug exists. If
    // either changes, the fix below is solving a problem that moved.
    it('does not singularize, so the two spellings carry different required tokens', () => {
        expect(deriveMustHaveTokens('dorito nacho cheese')).toEqual(['dorito', 'nacho']);
        expect(deriveMustHaveTokens('doritos nacho cheese')).toEqual(['doritos', 'nacho']);
    });

    it('the plural spelling was never the broken direction — singularize() bridges it', () => {
        // `singularize('doritos')` → 'dorito', so a plural query already reached
        // singular-spelled records. Only singular → plural was broken.
        expect(kept('doritos', cand('Dorito Flavored Seasoning'))).toBe(1);
    });

    it('relaxed mode really does drop every token but the last', () => {
        // Pins the premise of the strict/relaxed split used throughout this file.
        expect(deriveMustHaveTokens('trader joes')).toEqual(['trader', 'joes']);
        expect(deriveMustHaveTokens('trader joes sponge cake')).toEqual(['trader', 'joes']);
    });
});

describe('a singular -o query reaches the -s-spelled records', () => {
    // Every one of these returns 0 without the fix.
    const wins: Array<[string, UnifiedCandidate]> = [
        ['dorito', cand('Doritos Nacho Cheese Flavored Tortilla Chips', 'Doritos')],
        ['cheeto crunchy', cand('Cheetos Crunchy Cheese Flavored Snacks', 'Cheetos')],
        ['tostito scoop', cand('Tostitos Scoops Tortilla Chips', 'Tostitos')],
        ['oiko greek yogurt', cand('Oikos Greek Nonfat Yogurt', 'Dannon')],
        ['cheerio', cand('Cheerios', 'General Mills')],
        ['churro', cand('Churros')],
        ['taco', cand('Tacos Al Pastor Kit')],
        ['burrito', cand('Bean Burritos')],
        ['mango', cand('Mangos')],
        ['mango', cand('Dried Mangos')],
        ['avocado', cand('Avocados Hass')],
        ['oreo', cand('Oreos', 'Nabisco')],
    ];

    it.each(wins)('admits %s → %s', (query, candidate) => {
        expect(kept(query, candidate)).toBe(1);
        expect(keptRelaxed(query, candidate)).toBe(1);
    });
});

describe('union, not substitution — proved on a token outside TOKEN_SYNONYMS', () => {
    // `mango` is in no synonym table, so nothing else can rescue it. If a future
    // edit replaces `+ 'es'` with `+ 's'` instead of appending, the -oes half of
    // this block fails. That is the entire contract here.
    it('mango still reaches the -oes spelling', () => {
        expect(kept('mango', cand('Mangoes'))).toBe(1);
        expect(kept('mango', cand('Dried Mangoes'))).toBe(1);
        expect(keptRelaxed('mango', cand('Mangoes'))).toBe(1);
    });

    it('mango now ALSO reaches the -os spelling', () => {
        expect(kept('mango', cand('Mangos'))).toBe(1);
        expect(keptRelaxed('mango', cand('Mangos'))).toBe(1);
    });

    it('regression pins only — potato/tomato are synonym-rescued and prove nothing about the union', () => {
        expect(kept('potato', cand('Mashed Potatoes'))).toBe(1);
        expect(kept('tomato sauce', cand('Tomatoes Sauce'))).toBe(1);
        expect(kept('potatoes', cand('Potato Russet'))).toBe(1);
        expect(kept('tomatoes', cand('Tomato Vine Ripened'))).toBe(1);
    });
});

describe('the mangled-singular guard — the new form comes from the query token only', () => {
    // singularize() takes the -oes arm on 'joes' and returns 'jo'. Deriving the
    // -os form from that singular yields 'jos', which word-matches real OFF rows
    // ("Jos Louis", "Jos Gambinos", "jos andrs foods"). A round-trip check does
    // NOT catch it: pluralize('jo') is exactly 'joes'. Only refusing to derive
    // from the singular does. These four assertions fail if the guard is removed.
    it('a "joes" query does NOT reach "Jos"-spelled records, strict or relaxed', () => {
        const josLouis = cand('Jos Louis Sponge Cakes', 'Vachon');
        expect(kept('joes', josLouis)).toBe(0);
        expect(keptRelaxed('joes', josLouis)).toBe(0);
        // The multi-token form matters separately: relaxed reduces
        // ['trader','joes'] to ['joes'], so `trader` is no longer co-required and
        // cannot be what is doing the rejecting.
        expect(kept('trader joes', josLouis)).toBe(0);
        expect(keptRelaxed('trader joes', josLouis)).toBe(0);
        expect(kept('trader joes sponge cake', josLouis)).toBe(0);
        expect(keptRelaxed('trader joes sponge cake', josLouis)).toBe(0);
    });

    it('BINDING: the same record spelled "Joes" is kept, so the token gate is what rejected it', () => {
        expect(kept('joes', cand('Joes Louis Sponge Cakes', 'Vachon'))).toBe(1);
        expect(keptRelaxed('joes', cand('Joes Louis Sponge Cakes', 'Vachon'))).toBe(1);
        expect(kept('trader joes', cand('Trader Joes Louis Sponge Cakes', 'Vachon'))).toBe(1);
        expect(keptRelaxed('trader joes', cand('Trader Joes Louis Sponge Cakes', 'Vachon'))).toBe(1);
    });

    it('the guard has a cost, and this is it: an -oes-SPELLED query gains nothing', () => {
        // 'mangoes' → the -os form is not derived, because the only base that
        // could produce it is the mangled singular. Deliberate: that base is the
        // one that produces 'jos'. Pinned so the trade-off is visible, and so a
        // "generalization" back to [word, singular] fails here as well as above.
        expect(kept('mangoes', cand('Mangos'))).toBe(0);
        expect(keptRelaxed('mangoes', cand('Mangos'))).toBe(0);
        expect(kept('potatoes', cand('Potatos Red'))).toBe(0);
        // ...and the spellings that worked before still work.
        expect(kept('mangoes', cand('Mangoes'))).toBe(1);
        expect(kept('mangoes', cand('Mango'))).toBe(1);
    });
});

describe('negative controls — the new branch runs, produces the -os string, and must still reject', () => {
    // Each control pairs a rejection with a candidate that ONLY the new -os
    // string can admit. The paired case proves two things at once: the branch
    // ran (non-vacuity) and the token gate is what rejected the other one
    // (binding). Both halves are asserted in strict AND relaxed mode.

    it('word-bounded: "mangos" reaches Mangos, never Mangosteen', () => {
        expect(kept('mango', cand('Mangosteen Juice'))).toBe(0);
        expect(keptRelaxed('mango', cand('Mangosteen Juice'))).toBe(0);
        // BINDING + NON-VACUOUS: same name plus the -os spelling → kept. Returns
        // 0 on origin/master, so only the new string can be admitting it.
        expect(kept('mango', cand('Mangosteen Mangos Juice'))).toBe(1);
        expect(keptRelaxed('mango', cand('Mangosteen Mangos Juice'))).toBe(1);
    });

    it('"tacos" reaches Tacos, never Tabasco', () => {
        expect(kept('taco', cand('Tabasco Pepper Sauce', 'McIlhenny'))).toBe(0);
        expect(keptRelaxed('taco', cand('Tabasco Pepper Sauce', 'McIlhenny'))).toBe(0);
        expect(kept('taco', cand('Tabasco Tacos Pepper Sauce', 'McIlhenny'))).toBe(1);
        expect(keptRelaxed('taco', cand('Tabasco Tacos Pepper Sauce', 'McIlhenny'))).toBe(1);
    });

    it('"burritos" reaches Burritos, never Burrata', () => {
        expect(kept('burrito', cand('Burrata Fresh Italian Cheese'))).toBe(0);
        expect(keptRelaxed('burrito', cand('Burrata Fresh Italian Cheese'))).toBe(0);
        expect(kept('burrito', cand('Burrata Burritos Fresh'))).toBe(1);
        expect(keptRelaxed('burrito', cand('Burrata Burritos Fresh'))).toBe(1);
    });

    it('a co-required token that is absent is still fatal in STRICT mode', () => {
        // mustHave = ['dorito','nacho']. The wrong-brand record has `nacho` but
        // not `dorito`, and the fix does not waive it.
        expect(kept('dorito nacho cheese', cand('Nacho Cheese Tortilla Rounds', 'Store Brand'))).toBe(0);
        // BINDING + NON-VACUOUS: add the -os spelling of the missing token and it
        // is kept — 0 on origin/master, so the new string is what admits it.
        expect(kept('dorito nacho cheese', cand('Doritos Nacho Cheese Tortilla Rounds', 'Store Brand'))).toBe(1);
        // Stated, not hidden: relaxed keeps only the LAST token, so `dorito` is
        // no longer required and the wrong-brand record IS admitted. That is the
        // caller's pre-existing behaviour, unchanged by this fix — and the reason
        // the -o-token-is-last controls above exist.
        expect(keptRelaxed('dorito nacho cheese', cand('Nacho Cheese Tortilla Rounds', 'Store Brand'))).toBe(1);
    });
});

describe('untouched classes — tripwires for a future "generalization"', () => {
    // None of these involves an -o base, so the new branch cannot fire. They pass
    // identically before and after. They are here to catch someone moving the fix
    // into pluralize() itself, or substituting rather than appending.

    it('possessive brands still match — PR #157/#160 territory, y→ies untouched', () => {
        expect(kept("wendy's spicy chicken sandwich", cand('Spicy Chicken Sandwich', "Wendy's"))).toBe(1);
        expect(kept('trader joes chicken breast', cand('Chicken Breast', "Trader Joe's"))).toBe(1);
        expect(kept('trader joes scandinavian swimmers', cand('Scandinavian Swimmers', "Trader Joe's"))).toBe(1);
    });

    it('a brand that genuinely ends in s is unaffected', () => {
        expect(kept('pringles original', cand('Pringles Original Potato Crisps', 'Pringles'))).toBe(1);
    });

    it('the -ses hole in this module\'s shadow singularize() is exactly as it was', () => {
        // `singularize('cheeses')` here still yields 'chees' — the -ses guard from
        // PR #151 lives in normalization-rules.ts, not in this file. Pinned as-is,
        // not endorsed: separate defect, separate blast radius.
        expect(kept('cheese', cand('Assorted Cheeses'))).toBe(1);
        expect(kept('cheeses', cand('Cheddar Cheese'))).toBe(0);
    });

    it('egg/eggs is NOT fixed by this and must not be claimed as such', () => {
        // `singularize('eggs')` is 'egg' and `pluralize('egg')` is 'eggs', so the
        // filter already treats these as equivalent. The egg/eggs divergence (773
        // events, two records at 50 g vs 42 g per egg) is retrieval or rerank.
        expect(kept('egg', cand('Eggs', 'New Day Eggs'))).toBe(1);
        expect(kept('eggs', cand('Egg', 'Oakdell Egg Farm'))).toBe(1);
    });
});
