import { simpleRerank, type RerankCandidate } from '../simple-rerank';

/**
 * Decisive brand gate (brand-hijack fix, Jul 2026).
 *
 * When the query names a brand with two-word evidence (multi-word brand hit,
 * or a single brand token adjacent to a product-form token), a same-brand
 * candidate that covers at least one non-brand query token must beat a
 * cross-brand candidate — even one whose name exactly covers the flavor
 * tokens (the n-seg-21 / n-brand-02 hijack class).
 */

function cand(partial: Partial<RerankCandidate> & { id: string; name: string }): RerankCandidate {
    return { score: 0.5, source: 'openfoodfacts', ...partial };
}

describe('decisive brand gate', () => {
    it('flips the ghost hijack: GHOST candidate beats cross-brand exact flavor match', () => {
        const hijacker = cand({
            id: 'off_on', name: 'Cinnamon Roll Protein', brandName: 'Optimum Nutrition', score: 0.9,
        });
        const ghost = cand({
            id: 'off_ghost', name: 'Cinnamon Toast Crunch Flavored Cinnamon Protein Cereal', brandName: 'GHOST', score: 0.55,
        });
        const result = simpleRerank(
            'ghost protein cinnamon roll', [hijacker, ghost], undefined,
            '2 scoops ghost protein cinnamon roll', true, 'ghost',
        );
        expect(result.winner?.id).toBe('off_ghost');
    });

    it('flips the one-bar hijack: ONE Brands SKU beats a "Birthday Cake"-brand competitor', () => {
        const hijacker = cand({
            id: 'off_cakecup', name: 'Birthday Cake', brandName: 'Cake Cup', score: 0.9,
        });
        const oneBar = cand({
            id: 'off_one', name: 'One Birthday Cake Protein Bar', brandName: 'ONE Brands', score: 0.7,
        });
        const result = simpleRerank(
            'one bar birthday cake', [hijacker, oneBar], undefined,
            'one bar birthday cake', true, 'one bar',
        );
        expect(result.winner?.id).toBe('off_one');
    });

    it('does NOT fire without product-form context (coincidental brand word)', () => {
        // "ghost pepper sauce": brand detector may match "ghost", but "pepper"
        // is not a product-form token — the generic sauce must stay on top.
        const sauce = cand({
            id: 'off_sauce', name: 'Ghost Pepper Sauce', brandName: undefined, score: 0.9,
        });
        const ghostBranded = cand({
            id: 'off_ghost', name: 'Pepper Protein Shake', brandName: 'GHOST', score: 0.5,
        });
        const result = simpleRerank(
            'ghost pepper sauce', [sauce, ghostBranded], undefined,
            'ghost pepper sauce', true, 'ghost',
        );
        expect(result.winner?.id).toBe('off_sauce');
    });

    it('excludes same-brand candidates that cover no non-brand query token', () => {
        // A Ghost record that shares only the brand (an energy drink) must not
        // partition above a cross-brand candidate that matches the product.
        const hijacker = cand({
            id: 'off_on', name: 'Cinnamon Roll Protein', brandName: 'Optimum Nutrition', score: 0.9,
        });
        const ghostEnergy = cand({
            id: 'off_energy', name: 'Energy Drink Citrus', brandName: 'GHOST', score: 0.6,
        });
        const result = simpleRerank(
            'ghost protein cinnamon roll', [hijacker, ghostEnergy], undefined,
            '2 scoops ghost protein cinnamon roll', true, 'ghost',
        );
        expect(result.winner?.id).toBe('off_on');
    });

    it('does not match brand token as a substring of another brand', () => {
        const toblerone = cand({
            id: 'off_tob', name: 'Birthday Cake Chocolate Bar', brandName: 'Toblerone', score: 0.9,
        });
        const oneBar = cand({
            id: 'off_one', name: 'One Birthday Cake Protein Bar', brandName: 'ONE Brands', score: 0.6,
        });
        const result = simpleRerank(
            'one bar birthday cake', [toblerone, oneBar], undefined,
            'one bar birthday cake', true, 'one bar',
        );
        expect(result.winner?.id).toBe('off_one');
    });

    it('keeps an already-correct same-brand winner (positive control shape)', () => {
        const premier = cand({
            id: 'off_premier', name: 'Cafe Latte Protein Shake', brandName: 'Premier Protein', score: 0.9,
        });
        const generic = cand({
            id: 'off_latte', name: 'Cafe Latte', brandName: undefined, score: 0.7,
        });
        const result = simpleRerank(
            'premier protein cafe latte', [premier, generic], undefined,
            'premier protein cafe latte', true, 'premier protein',
        );
        expect(result.winner?.id).toBe('off_premier');
    });

    it('is inert when no brand was detected', () => {
        const generic = cand({ id: 'a', name: 'Cinnamon Roll', score: 0.9 });
        const branded = cand({ id: 'b', name: 'Cinnamon Roll Protein', brandName: 'GHOST', score: 0.6 });
        const result = simpleRerank('cinnamon roll', [generic, branded], undefined, 'cinnamon roll');
        expect(result.winner?.id).toBe('a');
    });
});
