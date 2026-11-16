/**
 * brand-initialism-repair (s453 brief row A, 2026-11-08). The pools below carry the
 * names and brands the box's mapping-analysis corpus recorded for `bk chicken fries
 * 9 piece` and `dq small vanilla cone`; scores are synthetic.
 */
import { applyBrandInitialismRepair, findBrandInitialismRepair } from '../brand-spelling-repair';
import { simpleRerank, type RerankCandidate } from '../simple-rerank';

const c = (id: string, name: string, brandName?: string, score = 1, source: RerankCandidate['source'] = 'openfoodfacts'): RerankCandidate =>
    ({ id, name, brandName, score, source });

const BK_POOL = [
    c('fs_bk', 'Chicken Fries - 8 Pieces', 'Burger King', 1, 'fatsecret'),
    c('off_plain', 'Chicken fries'),
    c('off_kroger', 'Kroger chicken fries', 'Kroger'),
];
const DQ_POOL = [
    c('off_kroger', 'Vanilla Cone', 'Kroger'),
    c('off_plain', 'Vanilla cone'),
    c('fs_dq', "Vanilla Cone - Kids'", 'Dairy Queen', 1, 'fatsecret'),
];

describe('the rule fires', () => {
    it('reads `bk` as Burger King', () => {
        expect(findBrandInitialismRepair('bk chicken fries', BK_POOL))
            .toEqual({ from: 'bk', to: 'burger king', anchorId: 'fs_bk' });
    });
    it('reads `dq` as Dairy Queen', () => {
        expect(findBrandInitialismRepair('dq vanilla cone', DQ_POOL))
            .toEqual({ from: 'dq', to: 'dairy queen', anchorId: 'fs_dq' });
    });
    it('rewrites whole words only, case-insensitively', () => {
        const r = { from: 'dq', to: 'dairy queen', anchorId: 'x' };
        expect(applyBrandInitialismRepair('DQ cone (dqs)', r)).toBe('dairy queen cone (dqs)');
    });
});

describe('the rule does not fire', () => {
    it('when a record is branded DQ (not an orphan)', () => {
        expect(findBrandInitialismRepair('dq dilly bar', [
            c('a', 'Dilly Bar', 'DQ'), c('b', 'Dilly Bar', 'Dairy Queen'),
        ])).toBeNull();
    });
    it('when two whole lexicon brands spell the token', () => {
        const sara = c('sara', 'Pound Cake', 'Sara Lee');
        const skratch = c('sk', 'Electrolyte Drink Mix', 'Skratch Labs');
        const plain = c('plain', 'Chocolate chip cookies');
        expect(findBrandInitialismRepair('sl cookies', [sara, skratch, plain])).toBeNull();
        expect(findBrandInitialismRepair('sl cookies', [sara, plain]))
            .toEqual({ from: 'sl', to: 'sara lee', anchorId: 'sara' });
    });
    it('anchors on a whole lexicon brand, not one that merely contains a lexicon word', () => {
        expect(findBrandInitialismRepair('bk chicken fries', [
            c('fs', 'Chicken Fries', 'Burger King', 1, 'fatsecret'), c('bar', 'Protein Bar', 'Be Kind'),
        ])?.to).toBe('burger king');
    });
    it('on a non-lexicon two-word brand', () => {
        expect(findBrandInitialismRepair('bk chicken fries', [
            c('a', 'Chicken Fries', 'Brand Kitchen'), c('b', 'Fries'),
        ])).toBeNull();
    });
    it('on a 5-letter token', () => {
        expect(findBrandInitialismRepair('abcde chicken', [c('a', 'Chicken', 'Alpha Bravo Charlie Delta Echo')])).toBeNull();
    });
    it('on a token some candidate name carries', () => {
        expect(findBrandInitialismRepair('bk chicken fries', [
            c('a', 'BK chicken fries'), c('fs', 'Chicken Fries', 'Burger King', 1, 'fatsecret'),
        ])).toBeNull();
    });
});

describe('simpleRerank() is wired to it', () => {
    it('bk: records the repair and picks the Burger King record', () => {
        const r = simpleRerank('bk chicken fries', BK_POOL, undefined, 'bk chicken fries 9 piece');
        expect(r.rerankOutcome.brandInitialism?.to).toBe('burger king');
        expect(r.rerankOutcome.winnerId).toBe('fs_bk');
    });
    it('dq: picks the Dairy Queen record', () => {
        const r = simpleRerank('dq vanilla cone', DQ_POOL, undefined, 'dq small vanilla cone', true, 'dq');
        expect(r.rerankOutcome.brandInitialism?.to).toBe('dairy queen');
        expect(r.rerankOutcome.winnerId).toBe('fs_dq');
    });
    it('a line whose spelling repair fires records brandInitialism: null', () => {
        const pool = [
            c('fs_3384', 'Peanut Butter', undefined, 1, 'fatsecret'),
            c('off_5060560280750', 'Peanut Butter Smooth'),
            c('off_0724441914299', 'Ryse Peanut Butter Protein', 'Ryse'),
            c('off_0850041914497', 'Loaded Protein Peanut Butter Flavor', 'RYSE'),
        ];
        const r = simpleRerank('ryze peanut butter protein', pool, undefined, 'one scoop of ryze keep your peanut butter protein');
        expect(r.rerankOutcome.brandSpelling).not.toBeNull();
        expect(r.rerankOutcome.brandInitialism).toBeNull();
    });
});
