/**
 * s456 BB: tokensMatch() folds the admission layer's spelling variants
 * (bbq <-> barbecue), so a requested `barbecue` is not charged
 * VARIANT_QUALIFIER_PENALTY on a `BBQ` candidate (ASC rows 28/29).
 */

import { simpleRerank, type RerankCandidate } from '../simple-rerank';

const n = (k: number, p: number, c: number, f: number) => ({ kcal: k, protein: p, carbs: c, fat: f, per100g: true });

function pool(): RerankCandidate[] {
    return [
        { id: 'fs_76054370', name: 'Fritos', brandName: 'Port of Subs', source: 'fatsecret', score: 0.9 },
        { id: 'fs_71870258', name: 'Fritos', brandName: "Jersey Mike's", source: 'fatsecret', score: 0.9 },
        { id: 'fs_394171', name: 'Flavor Twists Honey BBQ', brandName: 'Fritos', source: 'fatsecret', score: 0.9, nutrition: n(571, 7.14, 57.14, 32.14), servingLabelMatch: true },
        { id: 'fs_3613451', name: 'Flavor Twists Honey BBQ (Package)', brandName: 'Fritos', source: 'fatsecret', score: 0.9, nutrition: n(547, 5.29, 58.2, 33.51), servingLabelMatch: true },
        { id: 'off_0060410078426', name: 'Honey BBQ Twists', brandName: 'Fritos', source: 'openfoodfacts', score: 0.9, nutrition: n(540, 6, 56, 32), servingLabelMatch: true },
        { id: 'off_0028400766371', name: 'Flavor Twists Honey BBQ', brandName: 'Fritos', source: 'openfoodfacts', score: 0.9, nutrition: n(571, 7.14, 57.1, 32.1), servingLabelMatch: true },
        { id: 'off_0028400060226', name: 'Fritos Flavor Twists Honey BBQ', brandName: 'Fritos', source: 'openfoodfacts', score: 0.9, nutrition: n(565, 7.07, 56.5, 31.8) },
    ];
}

function winner(q: string, raw: string): string | undefined {
    return simpleRerank(q, pool(), undefined, raw, true, 'Fritos').winner?.id;
}

describe('tokensMatch spelling fold (bbq <-> barbecue)', () => {
    it('POS: a requested `barbecue` picks the row its `bbq` twin picks (s457 R2: tokensMatch + coverage fold)', () => {
        expect(winner('fritos honey barbecue', 'One serving of Fritos honey barbecue')).toBe('off_0028400060226');
    });
    it('CONTROL: a requested `bbq` still picks its own row', () => {
        expect(winner('fritos honey bbq', 'One serving of Fritos honey bbq')).toBe('off_0028400060226');
    });
    it('NEG: bare `fritos` is unchanged', () => {
        expect(winner('fritos', 'One serving of Fritos')).toBe('fs_71870258');
    });
});

// Lay's: the 10-row rerank window of `lays barbecue chips` (s456 snap-fold.json), retrieval score capped at 1 by the reranker.
function laysPool(): RerankCandidate[] {
    return [
        { id: 'off_0028400690638', name: 'Barbecue chips', brandName: "Lay's", source: 'openfoodfacts', score: 2.9, nutrition: n(535.71, 7.14, 57.14, 32.14) },
        { id: 'fs_1928539', name: 'Honey Barbecue Potato Chips', brandName: "Lay's", source: 'fatsecret', score: 1.395, nutrition: n(536, 7.14, 57.14, 32.14) },
        { id: 'off_0060410080115', name: 'Lay’s Barbecue Chips', brandName: 'Fritolay', source: 'openfoodfacts', score: 2.85, nutrition: n(540, 6, 56, 34) },
        { id: 'fs_70124870', name: 'Barbecue Potato Chips (74.5g)', brandName: "Lay's", source: 'fatsecret', score: 1.365, nutrition: n(538, 5.38, 55.11, 33.6) },
        { id: 'off_0094006434303', name: 'Baked Lay’s Barbecue Chips', brandName: 'Lay’s', source: 'openfoodfacts', score: 2.8, nutrition: n(458.33, 8.33, 79.17, 12.5) },
        { id: 'fs_138734129', name: 'Barbecue Brisket Potato Chips', brandName: "Lay's", source: 'fatsecret', score: 1.335, nutrition: n(536, 7.14, 57.14, 35.71) },
        { id: 'off_0028400421713', name: 'Potato Chips, Barbecue', brandName: "LAY'S", source: 'openfoodfacts', score: 2.85, nutrition: n(571, 7.14, 53.6, 35.7) },
        { id: 'fs_4383158', name: 'Barbecue Potato Chips (53.1g)', brandName: "Lay's", source: 'fatsecret', score: 1.305, nutrition: n(546, 5.65, 54.61, 33.9) },
        { id: 'off_0028400355599', name: 'Lays bbq chips', brandName: "Lay's", source: 'openfoodfacts', score: 2.85, nutrition: n(533.75, 6.28, 54.95, 32.97) },
        { id: 'fs_12973012', name: 'Oven Baked Barbecue Chips', brandName: "Lay's", source: 'fatsecret', score: 1.275, nutrition: n(459, 7.06, 70.55, 17.64) },
    ];
}
const est = { caloriesPer100g: 536, proteinPer100g: 6, carbsPer100g: 58, fatPer100g: 34, confidence: 0.9 };

describe('getWordCoverageBonus spelling fold (s457 R2)', () => {
    it('LAYS: `lays barbecue chips` picks the US `Lays bbq chips` row', () => {
        expect(simpleRerank('lays barbecue chips', laysPool(), est, 'lays barbecue chips', true, 'lays').winner?.id).toBe('off_0028400355599');
    });
    it('LAYS-CONTROL: `lays bbq chips` picks the same row', () => {
        expect(simpleRerank('lays bbq chips', laysPool(), est, 'lays bbq chips', true, 'lays').winner?.id).toBe('off_0028400355599');
    });
});

// Jam doughnut: the 10-row rerank window of `a jam doughnut` (s457 pd-r2 snap.json). Pins the trap of folding the word LISTS in
// place: `doughnut`->`donut` on the query side then fails the plural test against `doughnuts` and moves the winner.
function doughnutPool(): RerankCandidate[] {
    return [
        { id: 'off_5099839698934', name: 'Jam Doughnut', brandName: 'The Bakery Centra', source: 'openfoodfacts', score: 6.9, nutrition: n(180, 2.93, 17.49, 10.8) },
        { id: 'off_5010666007508', name: 'Jam Doughnut', brandName: 'Plaxtol Bakert', source: 'openfoodfacts', score: 6.9, nutrition: n(303, 7.2, 45, 11) },
        { id: 'off_0284879001157', name: 'Jam Doughnut', brandName: 'Tesco', source: 'openfoodfacts', score: 6.9, nutrition: n(332.43, 5.95, 51.62, 11.22) },
        { id: 'off_5391528567195', name: 'Jam Doughnuts', source: 'openfoodfacts', score: 6.9, nutrition: n(283, 5.5, 49, 7.6) },
        { id: 'off_5057753914950', name: 'Jam doughnuts', brandName: 'Tesco', source: 'openfoodfacts', score: 6.9, nutrition: n(304, 5.8, 48, 9.4) },
        { id: 'off_4088600443225', name: 'Jam doughnuts', brandName: "Gráinne's Bakery", source: 'openfoodfacts', score: 6.9, nutrition: n(335, 5.7, 47.8, 13.1) },
        { id: 'off_4088600421162', name: 'Jam doughnuts', brandName: 'Aldi', source: 'openfoodfacts', score: 6.9, nutrition: n(381.43, 5.43, 47.57, 18.86) },
        { id: 'off_0286840002200', name: 'Jam Doughnuts', brandName: 'Tesco', source: 'openfoodfacts', score: 6.9, nutrition: n(344.29, 5.57, 40.71, 17.14) },
        { id: 'off_0283011001000', name: 'Jam Doughnuts', source: 'openfoodfacts', score: 6.9, nutrition: n(391, 7.9, 41.4, 21) },
        { id: 'off_5099406000382', name: 'Jam&Cream Doughnuts', source: 'openfoodfacts', score: 3.9, nutrition: n(349, 4.3, 33, 22) },
    ];
}
const doughnutEst = { caloriesPer100g: 299, proteinPer100g: 4.7, carbsPer100g: 51.3, fatPer100g: 12.1, confidence: 0.8 };

describe('coverage fold is additive (s457 R2)', () => {
    it('PLAIN-PLURAL: a fold-free line gains no new plural coverage (`black cherry` keeps `Black Cherry`)', () => {
        const p: RerankCandidate[] = [
            { id: 'off_2', name: 'Black Cherry', source: 'openfoodfacts', score: 0.8, nutrition: n(63, 1, 16, 0.2) },
            { id: 'off_1', name: 'Black Cherries', source: 'openfoodfacts', score: 0.9, nutrition: n(63, 1, 16, 0.2) },
        ];
        expect(simpleRerank('black cherry', p, undefined, 'black cherry', false, undefined).winner?.id).toBe('off_2');
    });
    it('PLURAL: `jam doughnut` keeps this pool\'s base winner (folding the word lists in place moves it)', () => {
        expect(simpleRerank('jam doughnut', doughnutPool(), doughnutEst, 'a jam doughnut', false, undefined).winner?.id).toBe('off_5391528567195');
    });
});
