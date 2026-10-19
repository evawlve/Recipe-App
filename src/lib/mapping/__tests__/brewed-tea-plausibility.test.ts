import { assessMacroPlausibility, assessRankTimePlausibility, assessSaveTimePlausibility } from '../macro-plausibility';

/**
 * Brewed-tea rank-time plausibility (S239 / C70). RANK-TIME ONLY (reason `rank:brewed_tea_kcal_*`, counted in floorHit); the head is
 * read from the query only, exemption words over the whole query and headLine, branded queries skipped.
 */

const panel = (kcal: number) => ({ kcal, protein: 0, carbs: Math.min(kcal / 4, 100), fat: 0 });
function tea(q: string, kcal: number, head?: string): boolean {
    return assessRankTimePlausibility(q, 'x', panel(kcal), head).reasons.some((r) => r.startsWith('rank:brewed_tea_kcal_'));
}

const FIRES: Array<[string, number]> = [
    ['tea', 100], ['a cup of tea', 100], ['my tea', 629], ['black tea', 31], ['green tea', 250], ['hot tea', 200],
    ['a mug of tea', 34], ['teas', 25], ['tea', 21],
];
const SILENT: Array<[string, number]> = [
    ['tea', 20], ['tea', 16.9], ['tea', 1], ['sweet tea', 33], ['iced tea', 30], ['thai tea', 80], ['chai tea', 60], ['milk tea', 70],
    ['bubble tea', 90], ['tea cake', 350], ['tea sandwiches', 250], ['green tea ice cream', 200], ['long island iced tea', 90],
    ['matcha tea', 300], ['masala tea', 60], ['tea with honey', 40], ['tea with milk', 25], ['tea, sweetened', 35],
    ['hot tea with 2 sugars', 30],
    // NOT pinned: ['peace tea', 39], ['gold peak tea', 31] - brand-lexicon.json lacks `peace` / `gold peak`, so detectBrandInQuery misses them (hand-back finding).
];

describe('brewed-tea rank-time plausibility', () => {
    it.each(FIRES)('fires: %s at %s kcal/100g', (q, kcal) => {
        expect(tea(q, kcal)).toBe(true);
        expect(assessRankTimePlausibility(q, 'x', panel(kcal)).floorHit).toBe(true);
    });

    it.each(SILENT)('stays silent: %s at %s kcal/100g', (q, kcal) => {
        expect(tea(q, kcal)).toBe(false);
    });

    it('never reads headLine for the head (refute M1)', () => {
        expect(tea('honey', 304, 'tea w/ honey (1 tsp)')).toBe(false);
        expect(tea('milk', 60, 'tea with milk')).toBe(false);
    });

    it('an exemption word in headLine silences it (refute M2)', () => {
        expect(tea('tea', 100, 'sweet tea')).toBe(false);
    });

    it('leaves the prepared-drink rule alone', () => {
        const r = assessRankTimePlausibility('latte', 'x', { kcal: 397, protein: 10, carbs: 70, fat: 8 });
        expect(r.reasons.some((x) => x.startsWith('rank:prepared_drink_kcal_'))).toBe(true);
        expect(r.reasons.some((x) => x.startsWith('rank:brewed_tea_kcal_'))).toBe(false);
    });

    it('leaves the save-time and macro paths untouched', () => {
        expect(assessMacroPlausibility('tea', 'Tea', panel(100)).reasons.join('|')).not.toContain('brewed_tea');
        expect(assessSaveTimePlausibility('tea', 'Tea', panel(100)).reasons.join('|')).not.toContain('brewed_tea');
    });
});
