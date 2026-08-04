/**
 * First test coverage of the normalize gate's multi-ingredient branch.
 *
 * Plan Phase 2 #9. The change under test is data-only — 28 strings appended to
 * SINGLE_PRODUCT_EXCEPTIONS — but the assertions here are deliberately about the
 * BRANCH that fires, not about shouldCallLlm, because an exception does not make
 * the gate decline. It removes the forced RUN at branch 2 and lets the line fall
 * through to branches 3-8, any of which may still return shouldCallLlm: true.
 * Asserting `false` would pin a coincidence of the fixture's scores.
 *
 * Note there is no pre-existing suite for this module, so nothing here is a
 * regression baseline — llm-output-guard-wiring.test.ts jest.mocks the whole
 * module and never runs the real predicate.
 */

import { shouldNormalizeLlm } from '../normalize-gate';
import { UnifiedCandidate } from '../gather-candidates';
import { ModifierConstraints } from '../modifier-constraints';

const NO_CONSTRAINTS: ModifierConstraints = {
    requiredTokens: [],
    bannedTokens: [],
    penalties: [],
};

function candidate(over: Partial<UnifiedCandidate> = {}): UnifiedCandidate {
    return {
        id: 'off_test',
        source: 'openfoodfacts',
        name: 'test candidate',
        score: 0.7,
        rawData: {},
        ...over,
    };
}

/** The gate reads `reason`; branch 2 is the only one this change can move. */
const reasonFor = (line: string, cands = [candidate()]) =>
    shouldNormalizeLlm(line, cands, NO_CONSTRAINTS).reason;

const isMultiIngredient = (line: string) => reasonFor(line) === 'multi_ingredient_detected';

// The 28 strings added for #9, as they appear in the warm-plan corpus.
const NEWLY_EXEMPT = [
    'angies boomchickapop sweet and salty',
    "annie's shells and cheddar",
    'ben and jerry half baked',
    'blue diamond almonds wasabi and soy sauce',
    'dannon light and fit yogurt',
    'dave and busters pretzel dog',
    'dietz and watson turkey',
    'fit and active string cheese',
    'good and gather greek yogurt',
    'twisted tea half and half',
    'kikkoman teriyaki marinade and sauce',
    'kind bar dark chocolate nuts and sea salt',
    'lenny and larrys complete cookie',
    'lunchables turkey and cheddar',
    'm and ms peanut',
    'optimum nutrition gold standard whey cookies and cream',
    'nature valley oats and honey bar',
    'red baron thin and crispy pizza',
    'noodles and company mac and cheese',
    'now and later candy',
    'philadelphia chive and onion cream cheese',
    'planters trail mix nut and chocolate',
    'pret a manger avocado and tomato sandwich',
    'ruffles cheddar and sour cream',
    'tyson grilled and ready chicken breast strips',
    'vega protein and greens chocolate',
    'velveeta shells and cheese',
    'wonderful pistachios roasted and salted',
];

// The 26 the plan explicitly declines to chase — composite DISH names that need
// a different predicate. They must keep tripping the gate; this is the stated
// non-goal, pinned so a later "just add more strings" pass has to argue with it.
const STILL_MULTI_INGREDIENT = [
    'spaghetti and meatballs',
    'biscuits and gravy',
    'chicken and waffles',
    'shrimp and grits',
    'beef and broccoli',
    'red beans and rice',
    'sausage and peppers',
    'bagel and lox',
    'sweet and sour chicken',
    'prosciutto and melon',
];

describe('normalize gate — SINGLE_PRODUCT_EXCEPTIONS', () => {
    describe('the 28 strings added for plan #9', () => {
        it.each(NEWLY_EXEMPT)('no longer routes %s to branch 2', line => {
            expect(isMultiIngredient(line)).toBe(false);
        });

        it('lets an exempt line reach a decline when candidates are strong', () => {
            // End-to-end effect: without the exception this returns
            // multi_ingredient_detected regardless of how good the candidates are,
            // because branch 2 precedes every scoring branch.
            const strong = [
                candidate({ name: 'Greek Yogurt', brandName: 'Good & Gather', score: 0.93 }),
            ];
            const decision = shouldNormalizeLlm('good and gather greek yogurt', strong, NO_CONSTRAINTS);
            expect(decision.shouldCallLlm).toBe(false);
            expect(decision.reason).toBe('high_confidence_match');
        });
    });

    describe('the stated non-goal: composite dish names still need the LLM', () => {
        it.each(STILL_MULTI_INGREDIENT)('still routes %s to branch 2', line => {
            expect(isMultiIngredient(line)).toBe(true);
        });
    });

    describe('substring landmines — these die if a guard is weakened', () => {
        // SINGLE_PRODUCT_EXCEPTIONS is matched with bare String.includes(), no word
        // boundary. `m and m` was the spelling this change was derived as; it also
        // matches the middle of unrelated multi-ingredient lines. It ships as
        // `m and ms`. Each of these fails if someone shortens it back.
        it.each([
            'ham and mustard sandwich',
            'cream and milk',
            'turkey ham and mayo',
        ])('%s is not exempted by the m-and-ms entry', line => {
            expect(isMultiIngredient(line)).toBe(true);
        });

        it('exempts the M&M spelling the corpus actually carries', () => {
            expect(isMultiIngredient('m and ms crispy')).toBe(false);
        });
    });

    describe('pre-existing entries still hold', () => {
        it.each([
            'sour cream and onion chips',
            'mac and cheese',
            'peanut butter and jelly sandwich',
            'fish and chips',
        ])('%s is exempt', line => {
            expect(isMultiIngredient(line)).toBe(false);
        });

        it('does not exempt the reversed spelling of rice and beans', () => {
            // Documented brittleness: `rice and beans` is on the list, `red beans
            // and rice` is in the corpus and does not match it. Pinned so the
            // asymmetry is visible rather than surprising — the fix is a different
            // predicate, not the reversed string.
            expect(isMultiIngredient('red beans and rice')).toBe(true);
        });
    });

    describe('the branch this change cannot reach', () => {
        it('still forces the LLM when there are no candidates at all', () => {
            expect(shouldNormalizeLlm('good and gather greek yogurt', [], NO_CONSTRAINTS)).toEqual({
                shouldCallLlm: true,
                reason: 'no_candidates',
                confidence: 0.95,
            });
        });

        it('an exception short-circuits every pattern, not just /and/', () => {
            // Worth pinning because it is the structural risk in this list: the
            // exception loop returns before MULTI_INGREDIENT_PATTERNS is consulted,
            // so a new string can disable comma/&/plus detection too. Measured 0
            // such cases across the 2,280-seed corpus for these 28 strings.
            expect(isMultiIngredient('good and gather trail mix, granola')).toBe(false);
            expect(isMultiIngredient('trail mix, granola')).toBe(true);
        });
    });
});
