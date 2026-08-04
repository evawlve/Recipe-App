/**
 * Brand macro-consensus outlier demotion (fs displacement hardening, Jul 2026).
 *
 * Under the decisive-brand gate, when >=3 same-brand nutrition-bearing
 * siblings mostly agree on the per-100g panel, a sibling whose protein/kcal
 * deviates hard from the median is plausible-wrong label data (the
 * "42% protein Quest bar" class — passes every absolute plausibility floor)
 * and gets CONSENSUS_OUTLIER_PENALTY. Source-agnostic by design.
 */

jest.mock('../../db', () => ({ prisma: {} }));

import { simpleRerank, type RerankCandidate } from '../simple-rerank';

const RAW_LINE = '1 quest protein bar chocolate chip';
const QUERY = 'quest chocolate chip protein bar';

function questBar(partial: Partial<RerankCandidate> & { id: string }): RerankCandidate {
    return {
        name: 'Chocolate Chip Cookie Dough Protein Bar',
        brandName: 'Quest Nutrition',
        score: 0.6,
        source: 'openfoodfacts',
        nutrition: { kcal: 333, protein: 34, carbs: 37, fat: 13, per100g: true },
        ...partial,
    };
}

function rerank(candidates: RerankCandidate[]) {
    return simpleRerank(QUERY, candidates, undefined, RAW_LINE, true, 'quest');
}

describe('brand macro-consensus outlier demotion', () => {
    it('fires on the exact n-mq-08 phrasing, where the flavor token breaks decisive adjacency', () => {
        // "1 quest chocolate chip protein bar": "quest" neighbors "chocolate",
        // so hasDecisiveBrandContext is false — the pass must not depend on it.
        const candidates = [
            questBar({ id: 'off_1', nutrition: { kcal: 333, protein: 33, carbs: 37, fat: 13, per100g: true } }),
            questBar({ id: 'off_2', nutrition: { kcal: 333, protein: 34, carbs: 37, fat: 13, per100g: true } }),
            questBar({ id: 'off_3', nutrition: { kcal: 333, protein: 35, carbs: 37, fat: 13, per100g: true } }),
            questBar({
                id: 'fs_42', source: 'fatsecret', score: 1.0,
                nutrition: { kcal: 350, protein: 42, carbs: 35, fat: 14, per100g: true },
            }),
        ];
        const result = simpleRerank(
            QUERY, candidates, undefined, '1 quest chocolate chip protein bar', true, 'quest');
        expect(result.sortedCandidates[0]?.id).not.toBe('fs_42');
    });

    it('demotes a plausible-wrong fs record that deviates from the OFF sibling consensus', () => {
        const candidates = [
            questBar({ id: 'off_1', nutrition: { kcal: 333, protein: 33, carbs: 37, fat: 13, per100g: true } }),
            questBar({ id: 'off_2', nutrition: { kcal: 333, protein: 34, carbs: 37, fat: 13, per100g: true } }),
            questBar({ id: 'off_3', nutrition: { kcal: 333, protein: 35, carbs: 37, fat: 13, per100g: true } }),
            // Exact-name fs record with inflated protein and a saturating lane
            // score — without the consensus pass it wins on ORIGINAL_SCORE.
            questBar({
                id: 'fs_42', source: 'fatsecret', score: 1.0,
                nutrition: { kcal: 350, protein: 42, carbs: 35, fat: 14, per100g: true },
            }),
        ];
        const result = rerank(candidates);
        expect(result.winner?.id).not.toBe('fs_42');
    });

    it('control: kill-switch RANK_BRAND_CONSENSUS=0 restores the fs win (proves the penalty flips it)', () => {
        process.env.RANK_BRAND_CONSENSUS = '0';
        try {
            const candidates = [
                questBar({ id: 'off_1', nutrition: { kcal: 333, protein: 33, carbs: 37, fat: 13, per100g: true } }),
                questBar({ id: 'off_2', nutrition: { kcal: 333, protein: 34, carbs: 37, fat: 13, per100g: true } }),
                questBar({ id: 'off_3', nutrition: { kcal: 333, protein: 35, carbs: 37, fat: 13, per100g: true } }),
                questBar({
                    id: 'fs_42', source: 'fatsecret', score: 1.0,
                    nutrition: { kcal: 350, protein: 42, carbs: 35, fat: 14, per100g: true },
                }),
            ];
            const result = rerank(candidates);
            expect(result.winner?.id).toBe('fs_42');
        } finally {
            delete process.env.RANK_BRAND_CONSENSUS;
        }
    });

    it('is source-agnostic: an OFF record deviating from an fs+OFF consensus is demoted too', () => {
        const candidates = [
            questBar({ id: 'fs_good', source: 'fatsecret', score: 0.7, nutrition: { kcal: 333, protein: 34, carbs: 37, fat: 13, per100g: true } }),
            questBar({ id: 'off_good', nutrition: { kcal: 340, protein: 35, carbs: 37, fat: 13, per100g: true } }),
            questBar({ id: 'off_good2', nutrition: { kcal: 333, protein: 33, carbs: 37, fat: 13, per100g: true } }),
            // kcal wildly off the pack (per-serving panel ingested as per-100g)
            questBar({ id: 'off_bad', score: 1.0, nutrition: { kcal: 500, protein: 34, carbs: 37, fat: 25, per100g: true } }),
        ];
        const result = rerank(candidates);
        expect(result.winner?.id).not.toBe('off_bad');
    });

    it('does NOT fire with fewer than 3 nutrition-bearing siblings', () => {
        const candidates = [
            questBar({ id: 'off_1', nutrition: { kcal: 333, protein: 34, carbs: 37, fat: 13, per100g: true } }),
            questBar({
                id: 'fs_42', source: 'fatsecret', score: 1.0,
                nutrition: { kcal: 350, protein: 42, carbs: 35, fat: 14, per100g: true },
            }),
        ];
        const result = rerank(candidates);
        expect(result.winner?.id).toBe('fs_42');
    });

    it('does NOT fire without decisive brand context', () => {
        // Same pool, but the caller detected no brand — generic queries have
        // legitimately diverse panels ("protein bar" spans many products).
        const candidates = [
            questBar({ id: 'off_1', nutrition: { kcal: 333, protein: 33, carbs: 37, fat: 13, per100g: true } }),
            questBar({ id: 'off_2', nutrition: { kcal: 333, protein: 34, carbs: 37, fat: 13, per100g: true } }),
            questBar({ id: 'off_3', nutrition: { kcal: 333, protein: 35, carbs: 37, fat: 13, per100g: true } }),
            questBar({
                id: 'fs_42', source: 'fatsecret', score: 1.0,
                nutrition: { kcal: 350, protein: 42, carbs: 35, fat: 14, per100g: true },
            }),
        ];
        const result = simpleRerank('chocolate chip protein bar', candidates, undefined, '1 chocolate chip protein bar');
        // Without the decisive-brand gate the overall confidence gate may
        // withhold the winner — the pass being inactive shows in the ORDER:
        // the outlier keeps its score lead.
        expect(result.sortedCandidates[0]?.id).toBe('fs_42');
    });

    it('does NOT demote when the pack itself disagrees (no majority near the median)', () => {
        // Panels spread wide: no consensus exists, so nobody is an outlier.
        const candidates = [
            questBar({ id: 'off_1', nutrition: { kcal: 333, protein: 20, carbs: 37, fat: 13, per100g: true } }),
            questBar({ id: 'off_2', nutrition: { kcal: 333, protein: 30, carbs: 37, fat: 13, per100g: true } }),
            questBar({ id: 'off_3', nutrition: { kcal: 333, protein: 45, carbs: 37, fat: 13, per100g: true } }),
            questBar({
                id: 'fs_42', source: 'fatsecret', score: 1.0,
                nutrition: { kcal: 333, protein: 60, carbs: 35, fat: 14, per100g: true },
            }),
        ];
        const result = rerank(candidates);
        expect(result.winner?.id).toBe('fs_42');
    });
});

/**
 * Generic-query consensus (2026-08-04). The pass used to require a detected
 * targetBrand, so the one mechanism for "this row disagrees with its
 * identically-named siblings" never ran for the generic queries that need it.
 * Measured: 29,394 unmarked OffFood rows sit >=1.6x or <=0.6x their
 * identically-named sibling median, 97.9% invisible to the panel-scale detector.
 */
describe('macro-consensus outlier demotion on generic (brand-less) queries', () => {
    const apple = (partial: Partial<RerankCandidate> & { id: string }): RerankCandidate => ({
        name: 'Apple',
        score: 0.6,
        source: 'openfoodfacts',
        nutrition: { kcal: 52, protein: 0.3, carbs: 14, fat: 0.2, per100g: true },
        ...partial,
    });

    // No targetBrand, no isBranded — the exact shape of the n-prod-01 failure.
    const rerankGeneric = (candidates: RerankCandidate[]) =>
        simpleRerank('apple', candidates, undefined, 'apple', false, undefined);

    it('demotes a kcal outlier among identically-named siblings (the n-prod-01 class)', () => {
        // KILLS the mutation: restoring `if (targetBrand && ...)` on the pass.
        const candidates = [
            apple({ id: 'off_bad', score: 1.0, nutrition: { kcal: 23.9, protein: 0.3, carbs: 6, fat: 0.2, per100g: true } }),
            apple({ id: 'off_1', nutrition: { kcal: 52, protein: 0.3, carbs: 14, fat: 0.2, per100g: true } }),
            apple({ id: 'off_2', nutrition: { kcal: 53, protein: 0.3, carbs: 14, fat: 0.2, per100g: true } }),
            apple({ id: 'off_3', nutrition: { kcal: 52.8, protein: 0.3, carbs: 14, fat: 0.2, per100g: true } }),
        ];
        const result = rerankGeneric(candidates);
        expect(result.winner?.id).not.toBe('off_bad');
    });

    it('groups siblings by normalizeNameKey, so plural and word order still match', () => {
        // KILLS the mutation: swapping normalizeNameKey for raw string equality.
        const candidates = [
            apple({ id: 'off_bad', score: 1.0, nutrition: { kcal: 23.9, protein: 0.3, carbs: 6, fat: 0.2, per100g: true } }),
            apple({ id: 'off_1', name: 'Apples' }),
            apple({ id: 'off_2', name: 'apple' }),
            apple({ id: 'off_3', name: 'Apple' }),
        ];
        expect(rerankGeneric(candidates).winner?.id).not.toBe('off_bad');
    });

    it('does NOT fire on a differently-named pack — siblings must share the query key', () => {
        // KILLS the mutation: dropping the name-key predicate so every scored
        // candidate counts as a sibling. These are all plausible DIFFERENT foods.
        const candidates = [
            apple({ id: 'off_bad', score: 1.0, name: 'Apple Juice', nutrition: { kcal: 46, protein: 0.1, carbs: 11, fat: 0.1, per100g: true } }),
            apple({ id: 'off_1', name: 'Apple Pie', nutrition: { kcal: 265, protein: 2, carbs: 37, fat: 12, per100g: true } }),
            apple({ id: 'off_2', name: 'Apple Sauce', nutrition: { kcal: 68, protein: 0.2, carbs: 18, fat: 0.1, per100g: true } }),
            apple({ id: 'off_3', name: 'Apple Chips', nutrition: { kcal: 243, protein: 1, carbs: 60, fat: 1, per100g: true } }),
        ];
        // None shares normalizeNameKey('apple'), so the pass must not run at all.
        // simpleRerank withholds a winner here (every candidate is bloated
        // against a bare "apple"), so — as elsewhere in this file — inactivity
        // shows in the ORDER: the highest-scoring candidate keeps its lead
        // instead of being demoted as a consensus outlier.
        expect(rerankGeneric(candidates).sortedCandidates[0]?.id).toBe('off_bad');
    });

});
