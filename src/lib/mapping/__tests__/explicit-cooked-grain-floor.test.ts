import { simpleRerank, toRerankCandidate, type AiNutritionEstimate } from '../simple-rerank';

/**
 * Explicit-cooked grain lines keep the cooked-grain preference (C6970 s396, 2026-10-27).
 *
 * `detectGrainCookingContext()` returns `{ preferCooked: true }` WITHOUT `softCooked` for any
 * line carrying a cooking keyword, so before this change `simpleRerank()` gave `1 cup cooked oats`
 * none of the boost / partition / 0.75 floor its soft twin `1 cup oats` gets. A dry estimate
 * (389 kcal `rolled oats`, AiNormalizeCache) then sank every cooked candidate, confidence fell to
 * 0.596 < MIN_RERANK_CONFIDENCE 0.70, and the caller served retrieval rank 1 (Konjac Cooked Rice
 * oats, 105 kcal/100 g) — golden n-cook-06.
 *
 * The four candidates are the live rerank pool of `1 cup cooked oats`, copied VERBATIM from the
 * winner-diff snapshot s202 (row10-density/snap-pop.json, 2026-10-18) and inlined so CI needs no
 * snapshot file. Re-derive the numbers below: run this suite.
 */

const POOL = [
    { id: 'fs_112745332', name: 'Steel Cut Oats (Cooked)', brandName: null, foodType: 'Generic', score: 0.9719999999999999, source: 'fatsecret' as const, nutrition: { kcal: 73, protein: 3.1, carbs: 12, fat: 1.5, per100g: true } },
    { id: 'off_8801052053783', name: 'Konjac Cooked Rice oats', brandName: 'Lightly', foodType: null, score: 2.8, source: 'openfoodfacts' as const, nutrition: { kcal: 105, protein: 3, carbs: 21, fat: 2.130000114440918, per100g: true } },
    { id: 'off_0884912006165', name: 'Post, slow cooked steel cut oats with apples & cinnamon', brandName: 'Post', foodType: null, score: 2.5, source: 'openfoodfacts' as const, nutrition: { kcal: 101, protein: 4.039999961853027, carbs: 19.19000053405762, fat: 0.7599999904632568, per100g: true } },
    { id: 'off_0884912006134', name: 'Post, slow cooked steel cut oats with real sausage & cheddar cheese', brandName: 'Post', foodType: null, score: 2.4, source: 'openfoodfacts' as const, nutrition: { kcal: 111, protein: 6.059999942779541, carbs: 11.61999988555908, fat: 4.550000190734863, per100g: true } },
];

function pool() {
    return POOL.map(c => toRerankCandidate({ ...c, countLabelMatch: undefined, servingLabelMatch: undefined }));
}

/** Estimate B: the dry `rolled oats` AiNormalizeCache row (minted 2026-10-18 18:05Z). */
const DRY_OATS_ESTIMATE: AiNutritionEstimate = {
    caloriesPer100g: 389, proteinPer100g: 16.9, carbsPer100g: 66.3, fatPer100g: 6.9, confidence: 0.95,
};

describe('explicit-cooked grain volume line keeps the cooked-grain preference', () => {
    it('1 cup cooked oats + the dry estimate: Steel Cut Oats (Cooked) wins at the floor (was a 0.596 decline)', () => {
        const r = simpleRerank('oats', pool(), DRY_OATS_ESTIMATE, '1 cup cooked oats', false, undefined, false);
        expect(r.winner?.id).toBe('fs_112745332');
        expect(r.confidence).toBeGreaterThanOrEqual(0.75);
        expect(r.reason).toBe('cooked_grain_preference');
    });

    it('without the estimate the winner is unchanged (Steel Cut); the boost raises confidence 0.737 -> ~0.912', () => {
        const r = simpleRerank('oats', pool(), undefined, '1 cup cooked oats', false, undefined, false);
        expect(r.winner?.id).toBe('fs_112745332');
        expect(r.reason).toBe('cooked_grain_preference');
        // Crosses the 0.85 cache gate: this line becomes cacheable after the change.
        expect(r.confidence).toBeGreaterThanOrEqual(0.85);
    });

    it('control: the soft twin `1 cup oats` + the dry estimate already wins at the floor (unchanged)', () => {
        const r = simpleRerank('oats', pool(), DRY_OATS_ESTIMATE, '1 cup oats', false, undefined, false);
        expect(r.winner?.id).toBe('fs_112745332');
        expect(r.reason).toBe('cooked_grain_preference');
        expect(r.confidence).toBeGreaterThanOrEqual(0.75);
    });
});
