import { detectGrainCookingContext, isWrongCookingStateForGrain } from '../filter-candidates';
import { simpleRerank, type RerankCandidate } from '../simple-rerank';
import { isExplicitCookedGrainVolumeLine } from '../filter-candidates';

/**
 * Cooked-vs-dry grain fix (Jul 2026).
 *
 * A bare TRUE-grain name logged with an eaten-portion volume unit ("1 cup
 * white rice") prefers the cooked basis — softly: rerank ranks cooked records
 * up, but dry records are never hard-rejected (quinoa/oats have no cooked
 * record in the corpus).
 */

describe('detectGrainCookingContext softCooked', () => {
    it('volume-unit bare grain → soft cooked preference', () => {
        expect(detectGrainCookingContext('1 cup white rice', 'white rice'))
            .toEqual({ preferCooked: true, preferDry: false, softCooked: true });
        expect(detectGrainCookingContext('a bowl of oatmeal', 'oatmeal').softCooked).toBe(true);
    });

    it('explicit cooked keyword stays a HARD preference', () => {
        expect(detectGrainCookingContext('1 cup cooked rice', 'cooked rice'))
            .toEqual({ preferCooked: true, preferDry: false });
    });

    it('weight units stay dry (recipes weigh dry)', () => {
        expect(detectGrainCookingContext('200g rice', 'rice'))
            .toEqual({ preferCooked: false, preferDry: true });
    });

    it('dry-signal tokens stay dry', () => {
        expect(detectGrainCookingContext('2 cups dry rice', 'dry rice').softCooked).toBeUndefined();
        expect(detectGrainCookingContext('2 cups rice flour', 'rice flour').softCooked).toBeUndefined();
    });

    it('grain must be the head noun ("rice vinegar" is not a grain portion)', () => {
        expect(detectGrainCookingContext('1 cup rice vinegar', 'rice vinegar').softCooked).toBeUndefined();
    });

    it('legumes are not in scope (already resolve cooked)', () => {
        expect(detectGrainCookingContext('1 cup black beans', 'black beans').softCooked).toBeUndefined();
    });
});

describe('isWrongCookingStateForGrain under softCooked', () => {
    it('never hard-rejects dry candidates (quinoa/oats corpus gap)', () => {
        expect(isWrongCookingStateForGrain('1 cup white rice', 'white rice', 'Rice')).toBe(false);
        expect(isWrongCookingStateForGrain('1 cup quinoa', 'quinoa', 'uncooked quinoa')).toBe(false);
    });

    it('explicit cooked still rejects non-cooked candidates', () => {
        expect(isWrongCookingStateForGrain('1 cup cooked rice', 'cooked rice', 'Rice')).toBe(true);
    });
});

describe('rerank cooked-grain partition', () => {
    function cand(partial: Partial<RerankCandidate> & { id: string; name: string }): RerankCandidate {
        return { score: 0.5, source: 'openfoodfacts', ...partial };
    }

    it('cooked-named record beats a dry exact match on a volume-unit grain line', () => {
        const dry = cand({
            id: 'off_dry', name: 'White Rice', score: 0.9,
            nutrition: { kcal: 356, protein: 7, carbs: 80, fat: 0.6, per100g: true },
        });
        const cooked = cand({
            id: 'fdc_cooked', name: 'white rice cooked unenriched', source: 'fdc', score: 0.6,
            nutrition: { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, per100g: true },
        });
        const result = simpleRerank('white rice', [dry, cooked], undefined, '1 cup white rice');
        expect(result.winner?.id).toBe('fdc_cooked');
    });

    it('neutrally-named cooked-basis record (by nutrition) also qualifies', () => {
        const dry = cand({
            id: 'off_dry', name: 'White Rice', score: 0.9,
            nutrition: { kcal: 356, protein: 7, carbs: 80, fat: 0.6, per100g: true },
        });
        const cookedNeutral = cand({
            id: 'off_cooked', name: 'White Rice', score: 0.85,
            nutrition: { kcal: 162, protein: 3, carbs: 35, fat: 0.4, per100g: true },
        });
        const result = simpleRerank('white rice', [dry, cookedNeutral], undefined, '1 cup white rice');
        expect(result.winner?.id).toBe('off_cooked');
    });

    it('is inert on weight-unit lines (dry exact match keeps winning)', () => {
        const dry = cand({
            id: 'off_dry', name: 'White Rice', score: 0.9,
            nutrition: { kcal: 356, protein: 7, carbs: 80, fat: 0.6, per100g: true },
        });
        const cooked = cand({
            id: 'fdc_cooked', name: 'white rice cooked unenriched', source: 'fdc', score: 0.6,
            nutrition: { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, per100g: true },
        });
        const result = simpleRerank('white rice', [dry, cooked], undefined, '200g white rice');
        expect(result.winner?.id).toBe('off_dry');
    });

    it('falls back to normal ranking when no cooked candidate exists (quinoa class)', () => {
        const dryA = cand({
            id: 'fdc_dry', name: 'uncooked quinoa', source: 'fdc', score: 0.9,
            nutrition: { kcal: 368, protein: 14, carbs: 64, fat: 6, per100g: true },
        });
        const dryB = cand({
            id: 'off_dry', name: 'Quinoa Blend', score: 0.6,
            nutrition: { kcal: 360, protein: 13, carbs: 63, fat: 5.5, per100g: true },
        });
        const result = simpleRerank('quinoa', [dryA, dryB], undefined, '1 cup quinoa');
        expect(result.winner?.id).toBe('fdc_dry');
    });
});

/**
 * Explicit-cooked twin (C6970 s396, 2026-10-27): `isExplicitCookedGrainVolumeLine()` is true for
 * a line `detectGrainCookingContext()` reads as explicit-cooked (preferCooked, NOT softCooked)
 * whose head noun (last token of the normalized name) is a VOLUME_COOKED_GRAINS grain, logged by
 * an eaten-portion volume unit, with no dry signal. `simpleRerank()` gives such a line the same
 * cooked-grain boost / partition / 0.75 floor as the soft twin. Fixture-level pins live in
 * explicit-cooked-grain-floor.test.ts.
 */
describe('isExplicitCookedGrainVolumeLine', () => {
    it.each([
        ['1 cup cooked oats', 'oats', true],
        ['half a cup of cooked rolled oats', 'rolled oats', true],
        ['2 cups cooked quinoa', 'quinoa', true],
        ['a bowl of cooked rice', 'rice', true],
        // The cooking keyword list is matched by substring, so steamed/fried/baked lines count too.
        ['a bowl of steamed rice', 'rice', true],
        // Head-noun rule: the grain word is a modifier, not the food.
        ['steamed oat milk', 'oat milk', false],
        ['a cup of rice vinegar', 'rice vinegar', false],
        ['cooked rice flour', 'rice flour', false],
        // Weight unit: no volume unit, and `oz` is in GRAIN_DRY_SIGNAL_RE.
        ['4 oz of cooked pasta', 'pasta', false],
        ['100 g uncooked rice', 'rice', false],
        // Boundary: `uncooked` contains `cooked`, so detectGrainCookingContext() reads it
        // preferCooked; only the GRAIN_DRY_SIGNAL_RE clause (`uncooked`) makes this false.
        ['a cup of uncooked rice', 'rice', false],
    ])('%s (%s) -> %s', (rawLine, normalizedName, expected) => {
        expect(isExplicitCookedGrainVolumeLine(rawLine, normalizedName)).toBe(expected);
    });

    it('is never true on a soft-cooked line (the soft branch already owns it)', () => {
        expect(detectGrainCookingContext('1 cup oats', 'oats').softCooked).toBe(true);
        expect(isExplicitCookedGrainVolumeLine('1 cup oats', 'oats')).toBe(false);
    });
});

describe('rerank cooked-grain preference stays off dry and non-grain lines', () => {
    function cand(partial: Partial<RerankCandidate> & { id: string; name: string }): RerankCandidate {
        return { score: 0.5, source: 'openfoodfacts', ...partial };
    }

    it('100 g uncooked rice: no cooked_grain_preference reason', () => {
        const dry = cand({
            id: 'fdc_dry', name: 'uncooked rice', source: 'fdc', score: 0.9,
            nutrition: { kcal: 365, protein: 7.1, carbs: 80, fat: 0.7, per100g: true },
        });
        const cooked = cand({
            id: 'fdc_cooked', name: 'white rice cooked unenriched', source: 'fdc', score: 0.6,
            nutrition: { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, per100g: true },
        });
        const result = simpleRerank('rice', [dry, cooked], undefined, '100 g uncooked rice');
        expect(result.reason).not.toBe('cooked_grain_preference');
        expect(result.winner?.id).toBe('fdc_dry');
    });

    it('steamed oat milk: no cooked_grain_preference reason', () => {
        const milk = cand({
            id: 'off_milk', name: 'Oat Milk', score: 0.9,
            nutrition: { kcal: 46, protein: 1, carbs: 7, fat: 1.5, per100g: true },
        });
        const oats = cand({
            id: 'fs_oats', name: 'Steel Cut Oats (Cooked)', source: 'fatsecret', score: 0.6,
            nutrition: { kcal: 73, protein: 3.1, carbs: 12, fat: 1.5, per100g: true },
        });
        const result = simpleRerank('oat milk', [milk, oats], undefined, 'steamed oat milk');
        expect(result.reason).not.toBe('cooked_grain_preference');
        expect(result.winner?.id).toBe('off_milk');
    });

    it('boundary: the same cooked candidate DOES get the preference on `a cup of cooked rice`', () => {
        const dry = cand({
            id: 'off_dry', name: 'White Rice', score: 0.9,
            nutrition: { kcal: 356, protein: 7, carbs: 80, fat: 0.6, per100g: true },
        });
        const cooked = cand({
            id: 'fdc_cooked', name: 'white rice cooked unenriched', source: 'fdc', score: 0.6,
            nutrition: { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, per100g: true },
        });
        const result = simpleRerank('rice', [dry, cooked], undefined, 'a cup of cooked rice');
        expect(result.winner?.id).toBe('fdc_cooked');
        expect(result.reason).toBe('cooked_grain_preference');
    });
});
