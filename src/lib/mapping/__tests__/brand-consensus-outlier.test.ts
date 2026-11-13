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

    // Consensus exemption for a different named variant (F3-E). Each pool below
    // is a real panel set; the exemption must fire only when the majority is
    // demonstrably another named product.
    describe('exempts a flagged outlier only when the majority is a different named variant', () => {
        it('keeps the exact Atomic Classic Wings: the majority is a different named product sharing a sauce token', () => {
            const W_QUERY = 'wingstop classic wings atomic';
            const W_RAW = 'wingstop 8 classic wings atomic';
            const wing = (partial: Partial<RerankCandidate> & { id: string }): RerankCandidate => ({
                name: 'Atomic Boneless Wings',
                brandName: 'Wingstop',
                score: 0.84,
                source: 'fatsecret',
                nutrition: { kcal: 250, protein: 11.8, carbs: 14, fat: 15, per100g: true },
                ...partial,
            });
            const pool: RerankCandidate[] = [
                wing({
                    id: 'fs_73817903', name: 'Atomic Classic Wings', score: 0.856,
                    nutrition: { kcal: 231, protein: 25.6, carbs: 2.6, fat: 14, per100g: true },
                }),
                wing({ id: 'fs_73818104', name: 'Atomic Boneless Wings' }),
                wing({ id: 'fs_tenders', name: 'Atomic Chicken Tenders', nutrition: { kcal: 252, protein: 12, carbs: 14, fat: 15, per100g: true } }),
                wing({ id: 'fs_sandwich', name: 'Atomic Chicken Sandwich', nutrition: { kcal: 248, protein: 11.5, carbs: 15, fat: 14, per100g: true } }),
            ];
            const result = simpleRerank(W_QUERY, pool, undefined, W_RAW, true, 'wingstop');
            expect(result.winner?.id).toBe('fs_73817903');
        });

        it('whey line: Cosmic Cookies & Cream stays consensus-demoted when it has the highest input score', () => {
            const q = 'optimum nutrition cookies and cream';
            const raw = '1 scoop optimum nutrition cookies and cream';
            const on = (id: string, name: string, kcal: number, protein: number, carbs: number, fat: number, score = 0.8, source: RerankCandidate['source'] = 'openfoodfacts'): RerankCandidate =>
                ({ id, name, brandName: 'Optimum Nutrition', score, source, nutrition: { kcal, protein, carbs, fat, per100g: true } });
            const pool: RerankCandidate[] = [
                on('off_0748927051162', 'Gold Standard 100% Whey Cookies And Cream', 369.7, 72.7, 9.1, 4.5),
                on('fs_14026941', 'Opti-Bar - Cookies & Cream', 417, 33.33, 33.33, 15, 0.8, 'fatsecret'),
                on('fs_296335', 'Gold Standard 100% Whey - Cookies & Cream', 364, 72.73, 9.09, 4.55, 0.8, 'fatsecret'),
                on('fs_36829454', 'Protein Ridges Sour Cream', 436, 38.46, 38.46, 12.82, 0.8, 'fatsecret'),
                on('fs_23190967', 'Gold Standard 100% Whey - Banana Cream', 419, 77.42, 12.9, 4.84, 0.8, 'fatsecret'),
                on('fs_71558726', 'Gold Standard 100% Whey - Strawberries & Cream', 387, 77.42, 9.68, 6.45, 0.8, 'fatsecret'),
                on('off_5061062522294', 'Cosmic Cookies & Cream', 312.1, 30.3, 36.4, 8.5, 1.0),
                on('off_0748927055771', '100% Whey Protein Cookies & Cream', 387.1, 77.4, 9.7, 4.8),
                on('off_0045529589575', 'Pure pro 35 hi-protein shake cookies & cream flavor', 47, 9.86, 1.13, 0.28),
            ];
            const r = simpleRerank(q, pool, undefined, raw, true, 'optimum nutrition');
            expect(r.winner?.id).not.toBe('off_5061062522294');
        });

        it('a 42 g "Cookies and Cream Protein Bar" is still demoted when the OFF majority omits "protein"', () => {
            const q = 'quest cookies and cream protein bar';
            const mk = (id: string, name: string, protein: number, score = 0.6, source: RerankCandidate['source'] = 'openfoodfacts'): RerankCandidate =>
                ({ id, name, brandName: 'Quest Nutrition', score, source, nutrition: { kcal: 333, protein, carbs: 37, fat: 13, per100g: true } });
            const r = simpleRerank(q, [
                mk('off_1', 'Cookies & Cream Bar', 33), mk('off_2', 'Quest Bar Cookies and Cream', 34), mk('off_3', 'Cookies & Cream', 35),
                mk('fs_42', 'Cookies and Cream Protein Bar', 42, 1.0, 'fatsecret'),
            ], undefined, '1 quest cookies and cream protein bar', true, 'quest');
            expect(r.winner?.id).not.toBe('fs_42');
        });

        it("Annie's 9-record pool: the 151 kcal Shells record stays demoted (a coverage count would exempt it)", () => {
            const pool: RerankCandidate[] = [
                {id:"off_0013562119219",name:"Shells and white cheddar mac and cheese",brandName:"Annie's",score:12.65,source:"openfoodfacts",nutrition:{kcal:150.9433898925781,protein:5.660377502441406,carbs:19.33962249755859,fat:5.660377502441406,per100g:true}},
                {id:"off_0013562123537",name:"Annies White Chedder Mac And Cheese",brandName:"Annie's",score:9.7,source:"openfoodfacts",nutrition:{kcal:385.9649047851562,protein:12.28070163726807,carbs:64.91227722167969,fat:8.771929740905762,per100g:true}},
                {id:"fs_8879648",name:"White Cheddar Macaroni & Cheese",brandName:"Annie's Homegrown",score:1.14,source:"fatsecret",nutrition:{kcal:386,protein:12.28,carbs:64.91,fat:8.77,per100g:true}},
                {id:"fs_624228",name:"Shells & White Cheddar Macaroni & Cheese",brandName:"Annie's Homegrown",score:1.1159999999999999,source:"fatsecret",nutrition:{kcal:366,protein:12.68,carbs:70.42,fat:4.23,per100g:true}},
                {id:"fs_1499219",name:"Microwavable Mac & Cheese",brandName:"Annie's Homegrown",score:1.0919999999999999,source:"fatsecret",nutrition:{kcal:361,protein:14.75,carbs:63.93,fat:7.38,per100g:true}},
                {id:"fs_38890158",name:"Organic Vegan Mac, Cheddar Flavor",brandName:"Annie's Homegrown",score:1.0679999999999998,source:"fatsecret",nutrition:{kcal:366,protein:11.27,carbs:69.01,fat:4.23,per100g:true}},
                {id:"fs_2237172",name:"White Cheddar Bunnies",brandName:"Annie's Homegrown",score:1.044,source:"fatsecret",nutrition:{kcal:533,protein:10,carbs:60,fat:26.67,per100g:true}},
                {id:"fs_20380500",name:"Rice Pasta and Cheddar",brandName:"Annie's Homegrown",score:1.02,source:"fatsecret",nutrition:{kcal:386,protein:8.77,carbs:70.18,fat:7.02,per100g:true}},
                {id:"fs_19343115",name:"Organic White Cheddar Squares",brandName:"Annie's Homegrown",score:0.9959999999999999,source:"fatsecret",nutrition:{kcal:500,protein:10,carbs:60,fat:23.33,per100g:true}},
            ];
            const r = simpleRerank("annie's white cheddar mac and cheese", pool, undefined, "annie's white cheddar mac and cheese", true, "annie's");
            expect(r.winner?.id).not.toBe('off_0013562119219');
        });
    });
});
