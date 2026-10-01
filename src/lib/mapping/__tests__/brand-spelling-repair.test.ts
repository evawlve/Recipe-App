/**
 * brand-spelling-repair.ts (Lane A S64, pm110 ROW 2). The pools below carry the
 * names and brands the box's mapping-analysis corpus recorded for the two organic
 * lines on build uttAaRkc31GfMo3L0d9fT; scores are synthetic.
 */
import {
    applyBrandSpellingRepair, damerauLevenshtein, findBrandSpellingRepair, typoBudget,
} from '../brand-spelling-repair';
import { simpleRerank, type RerankCandidate } from '../simple-rerank';

const c = (id: string, name: string, brandName?: string, score = 1, source: RerankCandidate['source'] = 'openfoodfacts'): RerankCandidate =>
    ({ id, name, brandName, score, source });

const RYZE_POOL = [
    c('fs_3384', 'Peanut Butter', undefined, 1, 'fatsecret'),
    c('off_5060560280750', 'Peanut Butter Smooth'),
    c('off_0724441914299', 'Ryse Peanut Butter Protein', 'Ryse'),
    c('off_0850041914497', 'Loaded Protein Peanut Butter Flavor', 'RYSE'),
];
const TOAST_POOL = [
    c('off_0076800006696', 'french toast', 'Dneedos Bagels'),
    c('fs_4384', 'Plain French Toast', undefined, 1, 'fatsecret'),
    c('off_0853762002887', 'FRENCH TOAST BITES', 'Drizzilicious'),
    c('off_0796762002887', 'Drizzilicious French Toast Bites', 'Deuzzilicious'),
];

describe('the rule', () => {
    it('reads `ryze` as Ryse, anchored on the first Ryse record in the pool', () => {
        expect(findBrandSpellingRepair('ryze peanut butter protein', RYZE_POOL))
            .toEqual({ from: 'ryze', to: 'ryse', anchorId: 'off_0724441914299' });
    });

    it('reads `Drizzliscious` as Drizzilicious (two edits on a 13-letter token)', () => {
        expect(damerauLevenshtein('drizzliscious', 'drizzilicious')).toBe(2);
        expect(findBrandSpellingRepair('Drizzliscious French toast', TOAST_POOL))
            .toEqual({ from: 'drizzliscious', to: 'drizzilicious', anchorId: 'off_0853762002887' });
    });

    it('1. leaves a word some record carries: cheddar near Cedar, peppers near Peters (plural folded)', () => {
        expect(damerauLevenshtein('cheddar', 'cedar')).toBe(2);
        expect(findBrandSpellingRepair('white cheddar rice cakes', [
            c('a', 'White cheddar rice cakes'), c('b', 'Hummus', 'Cedar'),
        ])).toBeNull();
        expect(findBrandSpellingRepair('bell peppers', [c('a', 'Bell Pepper', 'Mucci Farms'), c('b', 'Peppers', 'Peters')])).toBeNull();
    });

    it('2. never re-spells a lexicon brand the user typed (kind → kinder)', () => {
        expect(findBrandSpellingRepair('kind bar', [c('a', 'Chocolate Bar', 'Kinder')])).toBeNull();
    });

    it('3. stays inside the typo budget, from the same first letter', () => {
        expect(typoBudget('rye')).toBe(0);
        expect(typoBudget('ryze')).toBe(1);
        expect(typoBudget('drizzli')).toBe(2);
        expect(findBrandSpellingRepair('roze peanut butter', RYZE_POOL)).toBeNull();     // 2 edits on 4 letters
        expect(findBrandSpellingRepair('wyse peanut butter', RYZE_POOL)).toBeNull();     // first letter differs
        // One edit, and the dictation slip Lane A S63's generator produced ("rise" for Ryze):
        // it fires only because retrieval brought Ryse records for this line.
        expect(findBrandSpellingRepair('rise peanut butter', RYZE_POOL)?.to).toBe('ryse');
    });

    it('4. anchors only on a lexicon brand', () => {
        expect(findBrandSpellingRepair('dneedo french toast', TOAST_POOL)).toBeNull(); // Dneedos is not in the lexicon
    });

    it('5. leaves the line alone when two lexicon brands are near (kellogs, kelloggs)', () => {
        expect(findBrandSpellingRepair('kelloggz cereal', [
            c('a', 'Corn Flakes', 'Kelloggs'), c('b', 'Rice Krispies', 'Kellogs'),
        ])).toBeNull();
    });

    it('fires on nothing when no pool record carries a near brand', () => {
        expect(findBrandSpellingRepair('ryze peanut butter protein', RYZE_POOL.slice(0, 2))).toBeNull();
    });

    it('rewrites whole words only, case-insensitively', () => {
        const r = { from: 'ryze', to: 'ryse', anchorId: 'x' };
        expect(applyBrandSpellingRepair('.7 scoop of Ryze peanut butter (ryzes)', r)).toBe('.7 scoop of ryse peanut butter (ryzes)');
    });
});

describe('simpleRerank() is wired to it', () => {
    it('records the repair on rerankOutcome and scores the line as the brand', () => {
        const before = simpleRerank('peanut butter protein', RYZE_POOL, undefined, 'one scoop of peanut butter protein');
        expect(before.rerankOutcome.brandSpelling).toBeNull();
        const r = simpleRerank('ryze peanut butter protein', RYZE_POOL, undefined, 'one scoop of ryze keep your peanut butter protein');
        expect(r.rerankOutcome.brandSpelling).toEqual({ from: 'ryze', to: 'ryse', anchorId: 'off_0724441914299' });
        expect(r.rerankOutcome.winnerId).toBe('off_0724441914299');
    });

    it('treats a segmenter brand spelled the user\'s way as the misspelling', () => {
        const r = simpleRerank('Ryze Peanut Butter Protein', RYZE_POOL, undefined, 'one scoop of ryze keep your peanut butter protein', true, 'Ryze');
        expect(r.rerankOutcome.winnerId).toBe('off_0724441914299');
    });
});
