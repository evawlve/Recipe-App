import { filterCandidatesByTokens, deriveMustHaveTokens } from '../filter-candidates';
import { detectBrandInQuery } from '../brand-detector';
import type { UnifiedCandidate } from '../gather-candidates';

/**
 * S202 route 9: a compound's HEAD was never required. The SPECIALTY branch (`coconut milk`) and
 * the `&`/`and` COMPOUND branch of deriveMustHaveTokens() require ONE token, so
 * `coconut milk latte` -> ['coconut'] admitted plain Coconut Milk and `cheese and tomato omelet`
 * -> ['cheese'] admitted a panini. Those branches now expose their core tokens so the #308
 * full-coverage preference can narrow the admitted pool (never empty it).
 */

function cand(name: string, id = name): UnifiedCandidate {
    return {
        id,
        source: 'fatsecret',
        name,
        score: 0.5,
        nutrition: { kcal: 100, protein: 5, carbs: 10, fat: 3, per100g: true },
        rawData: {},
    } as UnifiedCandidate;
}

const names = (r: { filtered: UnifiedCandidate[] }) => r.filtered.map(c => c.name);

describe('deriveMustHaveTokens exposes the narrow branches', () => {
    it('specialty branch: coconut milk latte', () => {
        const out: { coreTokens?: string[]; narrowBranch?: boolean } = {};
        expect(deriveMustHaveTokens('coconut milk latte', out)).toEqual(['coconut']);
        expect(out).toEqual({ coreTokens: ['coconut', 'milk', 'latte'], narrowBranch: true });
    });

    it('compound branch: cheese and tomato omelet', () => {
        const out: { coreTokens?: string[]; narrowBranch?: boolean } = {};
        expect(deriveMustHaveTokens('cheese and tomato omelet', out)).toEqual(['cheese']);
        expect(out.coreTokens).toEqual(['cheese', 'tomato', 'omelet']);
        expect(out.narrowBranch).toBe(true);
    });

    it('function words never become coverage tokens', () => {
        const out: { coreTokens?: string[]; narrowBranch?: boolean } = {};
        deriveMustHaveTokens('iced coffee with almond milk', out);
        expect(out.coreTokens).toBeDefined();
        expect(out.coreTokens).not.toContain('with');
    });

    it('the generic path is unchanged', () => {
        const out: { coreTokens?: string[]; narrowBranch?: boolean } = {};
        deriveMustHaveTokens('new york cheese pizza', out);
        expect(out.narrowBranch).toBeUndefined();
    });
});

describe('filterCandidatesByTokens on the narrow branches', () => {
    it('coconut milk latte keeps the latte, not the milk or the oil', () => {
        const r = filterCandidatesByTokens([
            cand('Coconut Milk'), cand('Coconut Milk Latte'), cand('Coconut Oil'),
        ], 'coconut milk latte');
        expect(names(r)).toEqual(['Coconut Milk Latte']);
    });

    it('omelette folds onto omelet records', () => {
        const r = filterCandidatesByTokens([
            cand('Ham and Cheese Omelet'), cand('Ham & Cheese Omelette'), cand('Ham Sandwich'),
        ], 'ham and cheese omelette');
        expect(names(r).sort()).toEqual(['Ham & Cheese Omelette', 'Ham and Cheese Omelet']);
    });

    it('a lone covering record that adds too many words does not narrow the pool', () => {
        const pool = [
            cand('Grilled Ham'),
            cand('Cheese and Tomato Panini'),
            cand('Egg Omelet or Scrambled Egg with Chili, Cheese, Tomatoes and Beans'),
        ];
        const r = filterCandidatesByTokens(pool, 'cheese and tomato omelet');
        expect(names(r)).toEqual(expect.arrayContaining(['Cheese and Tomato Panini']));
        expect(r.filtered.length).toBeGreaterThan(1);
    });

    it('a lone covering record with no extra words is kept', () => {
        const r = filterCandidatesByTokens([
            cand('Coconut Flour'), cand('Coconut Flour Pancakes'),
        ], 'coconut flour pancakes');
        expect(names(r)).toEqual(['Coconut Flour Pancakes']);
    });

    it('never empties: no record covering every token leaves the admitted pool alone', () => {
        const pool = [cand('Coconut Milk'), cand('Coconut Oil'), cand('Coconut Water')];
        const r = filterCandidatesByTokens(pool, 'coconut milk latte');
        // no record names the latte: every record the shipped filter admits survives (Coconut Water
        // is dropped by the shipped filter, not by the narrowing)
        expect(names(r).sort()).toEqual(['Coconut Milk', 'Coconut Oil']);
    });

    it('relaxed does not narrow', () => {
        const pool = [cand('Coconut Milk'), cand('Coconut Milk Latte'), cand('Coconut Oil')];
        const r = filterCandidatesByTokens(pool, 'coconut milk latte', { relaxed: true });
        expect(names(r)).toEqual(expect.arrayContaining(['Coconut Milk', 'Coconut Milk Latte']));
    });

    it('a brand-detected line does not narrow', () => {
        const line = 'alani nu coconut milk latte';
        expect(detectBrandInQuery(line).isBranded).toBe(true);
        const r = filterCandidatesByTokens([
            cand('Alani Nu Coconut Milk'), cand('Alani Nu Coconut Milk Latte'), cand('Alani Nu Coconut Oil'),
        ], line);
        expect(names(r).sort()).toEqual(['Alani Nu Coconut Milk', 'Alani Nu Coconut Milk Latte', 'Alani Nu Coconut Oil']);
    });
});
