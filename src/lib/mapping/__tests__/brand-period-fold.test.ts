import {
    candidateMatchesTargetBrand,
    foldBrandPunct,
    simpleRerank,
    toRerankCandidate,
    type RerankCandidate,
} from '../simple-rerank';

/**
 * A period inside a brand defeats both brand comparisons in the reranker
 * (2026-10-25, the `diet dr pepper` ranking row).
 *
 * The tokenizer splits on `[\s,()[\]{}]+`, so a record branded "Dr. Pepper"
 * yields the token `dr.` while the line and the detected brand say `dr pepper`.
 * Two costs, measured on the winner-gate snapshot with DEBUG_RERANK_SCORES:
 *   1. candidateMatchesTargetBrand() missed, so fs_51053 lost DECISIVE_BRAND_BOOST
 *      (0.35) and sorted below every `dr` candidate in the decisive partition —
 *      Arby's fs_127590169 "Diet Dr Pepper" qualifies through its NAME token `dr`;
 *   2. computeSimpleScore()'s brand-containment test failed ("dr. pepper" is not a
 *      substring of "diet dr pepper"), so the record took the non-matching branch:
 *      no +0.25 branded bonus and a -0.10 extra-token penalty for `dr.`.
 * Base: `1. Diet Dr Pepper total=1.445 base=1.095 … dbrand=0.35` vs
 *       `4. Diet Dr. Pepper total=1.045 base=0.995 … dbrand=0.00`.
 *
 * The two-candidate fixture below is the two records verbatim from the s368
 * winner-gate snapshot (`snap-two.json`, entry `diet dr pepper`, the fields
 * toRerankCandidate() reads), so the panels are real.
 */

const FS_51053 = toRerankCandidate({
    id: 'fs_51053',
    source: 'fatsecret',
    name: 'Diet Dr. Pepper',
    brandName: 'Dr. Pepper',
    score: 1.4249999999999998,
    foodType: 'Brand',
    nutrition: { kcal: 0, protein: 0, carbs: 0, fat: 0, per100g: true },
});

const FS_127590169 = toRerankCandidate({
    id: 'fs_127590169',
    source: 'fatsecret',
    name: 'Diet Dr Pepper',
    brandName: "Arby's",
    score: 1.2449999999999999,
    foodType: 'Brand',
});

/** fs_51053's computeSimpleScore() on the BASE tree (origin/master a213eff4),
 *  read from rerankPool by running this suite there on 2026-10-25. */
const BASE_FS_51053_BASE_SCORE = 0.995;

function rerankDietDrPepper() {
    return simpleRerank('diet dr pepper', [FS_51053, FS_127590169], undefined, 'diet dr pepper', true, 'dr pepper');
}

describe('foldBrandPunct', () => {
    it('removes a period that is not between two digits', () => {
        expect(foldBrandPunct('dr.')).toBe('dr');
        expect(foldBrandPunct('dr. pepper')).toBe('dr pepper');
        expect(foldBrandPunct('a.1.')).toBe('a1');
        expect(foldBrandPunct('mrs. dash')).toBe('mrs dash');
    });

    it('leaves a decimal alone', () => {
        expect(foldBrandPunct('1.5')).toBe('1.5');
        expect(foldBrandPunct('1.5 oz')).toBe('1.5 oz');
        expect(foldBrandPunct('12.5 fl. oz')).toBe('12.5 fl oz');
    });
});

describe('candidateMatchesTargetBrand — period folding', () => {
    it('matches a dotted record brand against the undotted detected brand', () => {
        expect(candidateMatchesTargetBrand('Dr. Pepper', 'Diet Dr. Pepper', 'dr pepper')).toBe(true);
        expect(candidateMatchesTargetBrand('Mrs. Dash', 'Mrs. Dash Original Blend', 'mrs dash')).toBe(true);
        expect(candidateMatchesTargetBrand('A.1.', 'A.1. Original Sauce', 'a1 sauce')).toBe(true);
    });

    it('is unchanged where the name already carries the undotted token', () => {
        expect(candidateMatchesTargetBrand("Arby's", 'Diet Dr Pepper', 'dr pepper')).toBe(true);
    });

    it('still rejects a different brand', () => {
        expect(candidateMatchesTargetBrand('Pepsi', 'Pepsi Zero Sugar', 'dr pepper')).toBe(false);
    });
});

describe('simpleRerank — diet dr pepper (s368 snapshot fixture)', () => {
    it('ranks the Dr. Pepper-brand 0 kcal record over the Arby\'s record', () => {
        const result = rerankDietDrPepper();
        expect(result.winner?.id).toBe('fs_51053');
    });

    it('raises fs_51053\'s base score by exactly the brand bonus plus the lifted penalty (0.25 + 0.10)', () => {
        const pool = rerankDietDrPepper().rerankPool;
        const row = pool.find(p => p.foodId === 'fs_51053');
        expect(row).toBeDefined();
        expect(Math.abs(row!.baseScore - BASE_FS_51053_BASE_SCORE - 0.35)).toBeLessThan(0.001);
    });

    it('gives fs_51053 the decisive-brand partition', () => {
        const top = rerankDietDrPepper().sortedCandidates[0];
        expect(top?.id).toBe('fs_51053');
    });
});

describe('simpleRerank — the containment arm is whole-token', () => {
    // "U.S." folds to `us`, which a bare substring test would find inside
    // "hummus". The candidate's base score must not move with its brand's
    // punctuation when the line does not name the brand.
    function baseScoreFor(brandName: string): number {
        const a: RerankCandidate = { id: 'a', name: 'Hummus', brandName, score: 0.8, source: 'openfoodfacts',
            nutrition: { kcal: 170, protein: 8, carbs: 14, fat: 10, per100g: true } };
        const b: RerankCandidate = { id: 'b', name: 'Classic Hummus', score: 0.7, source: 'openfoodfacts',
            nutrition: { kcal: 166, protein: 8, carbs: 14, fat: 9.6, per100g: true } };
        const pool = simpleRerank('hummus', [a, b], undefined, 'hummus', false, undefined).rerankPool;
        return pool.find(p => p.foodId === 'a')!.baseScore;
    }

    it('does not credit an initialism brand inside a longer word', () => {
        expect(baseScoreFor('U.S.')).toBeCloseTo(baseScoreFor('Zq'), 6);
    });
});
