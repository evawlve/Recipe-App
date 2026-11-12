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
    it('POS: a requested `barbecue` picks the BBQ-named Fritos row', () => {
        expect(winner('fritos honey barbecue', 'One serving of Fritos honey barbecue')).toBe('off_0060410078426');
    });
    it('CONTROL: a requested `bbq` still picks its own row', () => {
        expect(winner('fritos honey bbq', 'One serving of Fritos honey bbq')).toBe('off_0028400060226');
    });
    it('NEG: bare `fritos` is unchanged', () => {
        expect(winner('fritos', 'One serving of Fritos')).toBe('fs_71870258');
    });
});
