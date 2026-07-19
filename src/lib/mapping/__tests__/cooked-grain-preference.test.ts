import { detectGrainCookingContext, isWrongCookingStateForGrain } from '../filter-candidates';
import { simpleRerank, type RerankCandidate } from '../simple-rerank';

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
