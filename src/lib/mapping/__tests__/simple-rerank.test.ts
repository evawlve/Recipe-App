/**
 * Unit tests for stripPrepModifiers and nutrition tiebreaker
 * 
 * Validates that non-nutritional prep modifiers are stripped from
 * rerank queries while identity-changing modifiers are preserved.
 * Also tests the nutrition-based tiebreaker for score-tied candidates.
 */

import { stripPrepModifiers, simpleRerank, getCategoryChangePenalty, type RerankCandidate, type AiNutritionEstimate } from '../simple-rerank';
import { extractModifierConstraints, applyModifierConstraints } from '../modifier-constraints';

describe('stripPrepModifiers', () => {
    // === Prep words that SHOULD be stripped ===

    it('strips cutting words: "green peppers cut in strips" → "green peppers"', () => {
        expect(stripPrepModifiers('green peppers cut in strips')).toBe('green peppers');
    });

    it('strips "finely diced onion" → "onion"', () => {
        expect(stripPrepModifiers('finely diced onion')).toBe('onion');
    });

    it('strips "celery sliced" → "celery"', () => {
        expect(stripPrepModifiers('celery sliced')).toBe('celery');
    });

    it('strips "peeled and deveined shrimp" → "shrimp"', () => {
        expect(stripPrepModifiers('peeled and deveined shrimp')).toBe('shrimp');
    });

    it('strips "roughly chopped parsley" → "parsley"', () => {
        expect(stripPrepModifiers('roughly chopped parsley')).toBe('parsley');
    });

    it('strips "thinly sliced red onion" → "red onion"', () => {
        expect(stripPrepModifiers('thinly sliced red onion')).toBe('red onion');
    });

    it('strips multiple prep words: "seeded and diced jalapeño" → "jalapeño"', () => {
        expect(stripPrepModifiers('seeded and diced jalapeño')).toBe('jalapeño');
    });

    it('strips "cored and quartered apples" → "apples"', () => {
        expect(stripPrepModifiers('cored and quartered apples')).toBe('apples');
    });

    it('strips shape words: "chicken breast chunks" → "chicken breast"', () => {
        expect(stripPrepModifiers('chicken breast chunks')).toBe('chicken breast');
    });

    // === Identity modifiers that should NOT be stripped ===

    it('preserves "fire roasted tomatoes" (roasted is identity)', () => {
        // "fire" is not a prep word, "roasted" is identity-changing — both preserved
        expect(stripPrepModifiers('fire roasted tomatoes')).toBe('fire roasted tomatoes');
    });

    it('preserves "ground cinnamon"', () => {
        expect(stripPrepModifiers('ground cinnamon')).toBe('ground cinnamon');
    });

    it('preserves "dried cranberries"', () => {
        expect(stripPrepModifiers('dried cranberries')).toBe('dried cranberries');
    });

    it('preserves "frozen peas"', () => {
        expect(stripPrepModifiers('frozen peas')).toBe('frozen peas');
    });

    it('preserves "canned tomatoes"', () => {
        expect(stripPrepModifiers('canned tomatoes')).toBe('canned tomatoes');
    });

    it('preserves "smoked paprika"', () => {
        expect(stripPrepModifiers('smoked paprika')).toBe('smoked paprika');
    });

    // === No prep words — unchanged ===

    it('leaves "chicken breast" unchanged', () => {
        expect(stripPrepModifiers('chicken breast')).toBe('chicken breast');
    });

    it('leaves "brown sugar" unchanged', () => {
        expect(stripPrepModifiers('brown sugar')).toBe('brown sugar');
    });

    it('leaves "fat free milk" unchanged', () => {
        expect(stripPrepModifiers('fat free milk')).toBe('fat free milk');
    });

    // === Edge cases ===

    it('connector "and" preserved when not in prep context: "salt and pepper"', () => {
        expect(stripPrepModifiers('salt and pepper')).toBe('salt and pepper');
    });

    it('never returns empty string — falls back to original', () => {
        // If somehow all words are prep (unlikely), return original
        expect(stripPrepModifiers('diced')).toBe('diced');
    });

    it('handles extra whitespace gracefully', () => {
        expect(stripPrepModifiers('  finely   diced   onion  ')).toBe('onion');
    });
});

describe('nutrition tiebreaker', () => {
    // Helper to create candidates that will score identically (same name, same score)
    function makeTiedCandidates(names: string[], kcals: number[]): RerankCandidate[] {
        return names.map((name, i) => ({
            id: `food_${i}`,
            name,
            brandName: `Brand${i}`,
            score: 1.0,
            source: 'fatsecret' as const,
            nutrition: {
                kcal: kcals[i],
                protein: 0,
                carbs: kcals[i] * 0.5,
                fat: 0,
                per100g: true,
            },
        }));
    }

    it('prefers candidate closest to AI calorie estimate when scores tie', () => {
        // Simulate rice vinegar: all named "Rice Vinegar", different brands/calories
        const candidates = makeTiedCandidates(
            ['Rice Vinegar', 'Rice Vinegar', 'Rice Vinegar'],
            [0, 167, 300]  // Kikkoman (plain), Marukan (light seasoned), Mizkan (seasoned)
        );
        const aiEstimate: AiNutritionEstimate = {
            caloriesPer100g: 18,
            proteinPer100g: 0,
            carbsPer100g: 4,
            fatPer100g: 0,
            confidence: 0.85,
        };

        const result = simpleRerank('rice vinegar', candidates, aiEstimate);
        expect(result).not.toBeNull();
        // food_0 (0 kcal) is closest to 18 kcal estimate (deviation=18)
        // food_1 (167 kcal) deviation=149, food_2 (300 kcal) deviation=282
        expect(result!.winner.id).toBe('food_0');
    });

    it('falls through to ID tiebreaker when no AI estimate is provided', () => {
        const candidates = makeTiedCandidates(
            ['Rice Vinegar', 'Rice Vinegar'],
            [0, 300]
        );

        const result = simpleRerank('rice vinegar', candidates, undefined);
        expect(result).not.toBeNull();
        // Without AI estimate, should fall through to ID tiebreaker (food_0 < food_1)
        expect(result!.winner.id).toBe('food_0');
    });

    it('skips nutrition tiebreaker when AI confidence is below gate', () => {
        const candidates = makeTiedCandidates(
            ['Rice Vinegar', 'Rice Vinegar'],
            [300, 0]  // food_0 is farther from estimate, but should win by ID if tiebreaker skips
        );
        const lowConfEstimate: AiNutritionEstimate = {
            caloriesPer100g: 18,
            proteinPer100g: 0,
            carbsPer100g: 4,
            fatPer100g: 0,
            confidence: 0.50,  // Below NUTRITION_CONFIDENCE_GATE (0.70)
        };

        const result = simpleRerank('rice vinegar', candidates, lowConfEstimate);
        expect(result).not.toBeNull();
        // food_0 wins by ID tiebreaker (nutrition tiebreaker skipped)
        expect(result!.winner.id).toBe('food_0');
    });
});

describe('count-labeled SKU preference (Cluster A pt2)', () => {
    // Identically-named OFF candidates: the null-serving one is generic (earns
    // the NO_BRAND +0.05), the count-labeled one is branded. Only the boost
    // (+0.08) can flip the winner, so these tests isolate it exactly.
    function makeChipCandidates(): RerankCandidate[] {
        return [
            {
                id: 'off_null_serving',
                name: 'Tortilla Chips',
                score: 1.0,
                source: 'openfoodfacts' as const,
            },
            {
                id: 'off_count_label',
                name: 'Tortilla Chips',
                brandName: 'BrandB',
                score: 1.0,
                source: 'openfoodfacts' as const,
                countLabelMatch: true,
            },
        ];
    }

    it('prefers the count-labeled SKU when preferCountLabeled is set', () => {
        const result = simpleRerank(
            'tortilla chips', makeChipCandidates(), undefined, '13 tortilla chips',
            undefined, undefined, true
        );
        expect(result.winner).not.toBeNull();
        expect(result.winner!.id).toBe('off_count_label');
    });

    it('boost is inert when preferCountLabeled is not set', () => {
        const result = simpleRerank(
            'tortilla chips', makeChipCandidates(), undefined, 'tortilla chips'
        );
        expect(result.winner).not.toBeNull();
        // Generic (brandless) candidate keeps its NO_BRAND edge.
        expect(result.winner!.id).toBe('off_null_serving');
    });

    it('boost does not overcome a clearly better name match', () => {
        const candidates: RerankCandidate[] = [
            {
                id: 'off_exact',
                name: 'Tortilla Chips',
                score: 1.0,
                source: 'openfoodfacts' as const,
            },
            {
                id: 'off_bloated_count_label',
                name: 'Zesty Ranch Flavored Party Mix Snack Blend',
                brandName: 'BrandC',
                score: 1.0,
                source: 'openfoodfacts' as const,
                countLabelMatch: true,
            },
        ];
        const result = simpleRerank(
            'tortilla chips', candidates, undefined, '13 tortilla chips',
            undefined, undefined, true
        );
        expect(result.winner).not.toBeNull();
        expect(result.winner!.id).toBe('off_exact');
    });
});

describe('serving-labeled record preference (PR D pt2)', () => {
    it('prefers the serving-labeled record between identically-named branded candidates', () => {
        // The parity-sweep "red bull" class: same name, same score — only the
        // serving label distinguishes them, and losing it bills 100g flat.
        const candidates: RerankCandidate[] = [
            {
                id: 'off_no_serving',
                name: 'Red Bull',
                brandName: 'BrandA',
                score: 1.0,
                source: 'openfoodfacts' as const,
            },
            {
                id: 'off_can_label',
                name: 'Red Bull',
                brandName: 'BrandB',
                score: 1.0,
                source: 'openfoodfacts' as const,
                servingLabelMatch: true,
            },
        ];
        const result = simpleRerank('red bull', candidates, undefined, '1 red bull');
        expect(result.winner).not.toBeNull();
        expect(result.winner!.id).toBe('off_can_label');
    });

    it('does not overcome a clearly better name match', () => {
        const candidates: RerankCandidate[] = [
            {
                id: 'off_exact',
                name: 'Red Bull',
                brandName: 'BrandA',
                score: 1.0,
                source: 'openfoodfacts' as const,
            },
            {
                id: 'off_bloated_with_label',
                name: 'Zesty Tropical Energy Drink Party Variety Pack',
                brandName: 'BrandB',
                score: 1.0,
                source: 'openfoodfacts' as const,
                servingLabelMatch: true,
            },
        ];
        const result = simpleRerank('red bull', candidates, undefined, '1 red bull');
        expect(result.winner).not.toBeNull();
        expect(result.winner!.id).toBe('off_exact');
    });

    it('does not override the generic-record preference on its own', () => {
        // Boost (+0.05) exactly matches NO_BRAND (+0.05): a branded record's
        // serving label alone must not beat an equally-good generic record —
        // the score ties and the brand tiebreaker keeps the generic winner.
        const candidates: RerankCandidate[] = [
            {
                id: 'off_generic',
                name: 'Peanut Butter',
                score: 1.0,
                source: 'openfoodfacts' as const,
            },
            {
                id: 'off_branded_with_label',
                name: 'Peanut Butter',
                brandName: 'BrandB',
                score: 1.0,
                source: 'openfoodfacts' as const,
                servingLabelMatch: true,
            },
        ];
        const result = simpleRerank('peanut butter', candidates, undefined, 'peanut butter');
        expect(result.winner).not.toBeNull();
        expect(result.winner!.id).toBe('off_generic');
    });
});

describe('getCategoryChangePenalty — the unmatched-share charge (A25, Aug 2026)', () => {
    const FLAT = 0.50;

    // === THE INVARIANT ===
    // When the candidate shares NO category-changing token with the query, the charge
    // is the full flat penalty — byte-identical to the pre-A25 behaviour. This is the
    // whole population the penalty was built for, and it must never soften.
    it.each([
        ['spinach', 'Spinach Noodles'],
        ['tomato', 'Tomato powder'],
        ['quinoa', 'Lentil Quinoa Rice Mix'],
        ['lemons', 'Lemon Peel'],
        ['fennel', 'Fennel Seed'],
        ['almond', 'Almond Flour'],
    ])('charges the FULL penalty when nothing in-set is shared: %s -> %s', (q, name) => {
        expect(getCategoryChangePenalty(q, name)).toBe(FLAT);
    });

    // === UNCHANGED: an in-set token the query spells is intentional ===
    it.each([
        ['garlic powder', 'Garlic Powder'],
        ['spinach pasta', 'Spinach Pasta'],
        ['chocolate chip cookies', 'Chocolate Chip Cookies'],
    ])('charges nothing when every in-set token is spelled: %s -> %s', (q, name) => {
        expect(getCategoryChangePenalty(q, name)).toBe(0);
    });

    // === THE A25 CASE ===
    // The query names its own category, so `chocolate`/`chip`/`bar` are exempt for
    // EVERY candidate. Under the old flat charge the five real protein bars paid 0.50
    // for `cookie` — their own flavour — and the granola bar, which had genuinely
    // changed category, paid nothing and won by 0.008.
    it('charges the real product only its unmatched share (1 of 4 in-set tokens)', () => {
        expect(getCategoryChangePenalty(
            'kirkland protein bar chocolate chip',
            'Chocolate chip cookie dough protein bar',
        )).toBeCloseTo(FLAT * (1 / 4), 10);
    });

    it('still charges the category-changed rival nothing — `granola` is not in the set', () => {
        expect(getCategoryChangePenalty(
            'kirkland protein bar chocolate chip',
            'Chocolate Chip Chewy Granola Bar',
        )).toBe(0);
    });

    // === SHAPE ===
    it('scales with the unmatched share: 2 of 3 costs more than 1 of 3', () => {
        // query spells `bar`; candidate adds `cookie` (+`cake`) which it does not.
        const oneOfTwo = getCategoryChangePenalty('protein bar', 'Cookie Bar');
        const twoOfThree = getCategoryChangePenalty('protein bar', 'Cookie Cake Bar');
        expect(oneOfTwo).toBeCloseTo(FLAT * (1 / 2), 10);
        expect(twoOfThree).toBeCloseTo(FLAT * (2 / 3), 10);
        expect(twoOfThree).toBeGreaterThan(oneOfTwo);
    });

    it('counts DISTINCT tokens — a repeated in-set word must not double-count', () => {
        expect(getCategoryChangePenalty('protein bar', 'Cookie Bar Cookie Bar'))
            .toBe(getCategoryChangePenalty('protein bar', 'Cookie Bar'));
    });

    it('never exceeds the flat penalty', () => {
        for (const name of ['Cookie Cake Brownie Pie Soup', 'Noodles Pasta Rice Bread', 'Plain Food']) {
            const p = getCategoryChangePenalty('protein bar', name);
            expect(p).toBeLessThanOrEqual(FLAT);
            expect(p).toBeGreaterThanOrEqual(0);
        }
    });
});

/**
 * SOLE-SURVIVOR GUARD (Sep 2026).
 *
 * `simpleRerank` returns early for pools of 0 and 1, so the main path always
 * starts from `candidates.length >= 2`. `applyModifierConstraints()` can then
 * reject every candidate BUT ONE. The all-rejected sibling has the
 * `fallbackScored` recovery; this one had none, so `scored[1]` was `undefined`
 * and the gap read threw `TypeError: Cannot read properties of undefined
 * (reading 'score')` -> HTTP 500. Reproduced on master `dae8162` with the
 * two candidates below and no other change.
 */
describe('simpleRerank sole-survivor guard', () => {
    const QUERY = 'unsweetened almond milk';

    function mk(id: string, name: string): RerankCandidate {
        return {
            id,
            name,
            brandName: null,
            score: 1.0,
            source: 'fatsecret',
            nutrition: { kcal: 30, protein: 1, carbs: 3, fat: 1, per100g: true },
        } as unknown as RerankCandidate;
    }

    // GUARDS THE PIN, not the code: every test below is only meaningful while
    // the query's constraints reject exactly one of the two candidates. If the
    // modifier vocabulary ever stops banning "sweetened", the pool no longer
    // narrows to one and the rest of this block would pass vacuously.
    it('the fixture really does narrow a 2-candidate pool to exactly 1', () => {
        const constraints = extractModifierConstraints(QUERY);
        const verdicts = ['Unsweetened Almond Milk', 'Sweetened Almond Milk'].map(name =>
            applyModifierConstraints({ name, brandName: null }, constraints).rejected
        );
        expect(verdicts).toEqual([false, true]);
    });

    it('does not throw when a 2-candidate pool scores exactly one', () => {
        expect(() =>
            simpleRerank(QUERY, [mk('keep', 'Unsweetened Almond Milk'), mk('drop', 'Sweetened Almond Milk')], undefined, QUERY)
        ).not.toThrow();
    });

    // The returned reason is the discriminator between the two designs that were
    // on the table. `gap := 0` (shipped) leaves the chain at `close_match`, which
    // is then renamed. `gap := top.score` would have been > 0.15 here and produced
    // `clear_winner` plus the +0.1 gap bonus.
    it('names the shape and withholds the gap bonus', () => {
        const res = simpleRerank(QUERY, [mk('keep', 'Unsweetened Almondmilk'), mk('drop', 'Sweetened Almond Milk')], undefined, QUERY);
        expect(res.winner).not.toBeNull();
        expect(res.reason).toBe('sole_survivor');
        expect(res.reason).not.toBe('clear_winner');
        // 0.5 + score*0.5 with no +0.1; the bonus would have pushed this over 0.9.
        expect(res.confidence).toBeLessThan(0.9);
    });

    it('does not overwrite a stronger reason', () => {
        const res = simpleRerank(QUERY, [mk('keep', 'Unsweetened Almond Milk'), mk('drop', 'Sweetened Almond Milk')], undefined, QUERY);
        expect(res.reason).toBe('exact_match');
    });

    // The guard must be inert wherever a runner-up exists.
    it('leaves a two-survivor pool untouched', () => {
        const res = simpleRerank(QUERY, [mk('a', 'Unsweetened Almond Milk'), mk('b', 'Unsweetened Almond Milk Original')], undefined, QUERY);
        expect(res.winner).not.toBeNull();
        expect(res.reason).toBe('exact_match');
        expect(res.reason).not.toBe('sole_survivor');
    });
});
