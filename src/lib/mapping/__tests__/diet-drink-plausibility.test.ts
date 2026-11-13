import { assessMacroPlausibility, assessRankTimePlausibility } from '../macro-plausibility';

/**
 * Diet / zero drink rank-time plausibility (D19). RANK-TIME ONLY (reason `rank:diet_drink_kcal_*`, counted in floorHit): a diet / zero
 * drink line that meets a regular-sugar panel (> 12 kcal/100g) ranks that record below low-calorie ones.
 */

const REG = { kcal: 42, protein: 0, carbs: 10.6, fat: 0 };
const LOW = { kcal: 0.4, protein: 0, carbs: 0, fat: 0 };
const reason = (q: string, m: { kcal: number; protein: number; carbs: number; fat: number }, head?: string) =>
    assessRankTimePlausibility(q, 'x', m, head).reasons.some((r) => r.startsWith('rank:diet_drink_kcal_'));

const FIRES = [
    'powerade zero grape', 'gatorade zero glacier cherry', 'diet cherry coke', 'diet dr pepper', 'a medium diet dr pepper',
    'zero sugar gatorade', 'a cherry coke zero', 'diet mountain dew', 'sugar free red bull',
];
const SILENT = [
    'coke', 'gatorade fruit punch', 'bud light', 'sugar free vanilla latte', 'coffee mate zero sugar french vanilla', 'sugar free bbq sauce',
    'oikos triple zero', 'premier protein shake zero sugar', 'sugar free jello', 'sugar free syrup', 'sugar free pop tarts', 'diet coke float',
];

describe('diet-drink rank-time plausibility', () => {
    it.each(FIRES)('fires: %s', (q) => {
        expect(reason(q, REG)).toBe(true);
        expect(assessRankTimePlausibility(q, 'x', REG).floorHit).toBe(true);
    });

    it('fires from the head clause of headLine', () => {
        expect(reason('coke', REG, 'a diet coke')).toBe(true);
        expect(assessRankTimePlausibility('coke', 'x', REG, 'a diet coke').floorHit).toBe(true);
    });

    it.each(SILENT)('stays silent: %s', (q) => {
        expect(reason(q, REG)).toBe(false);
    });

    it('does not read a diet word past the head clause of headLine', () => {
        expect(reason('coke', REG, 'coke with a diet pepsi')).toBe(false);
    });

    it('stays silent on a low-calorie panel, the 12 kcal boundary and a non-finite kcal', () => {
        expect(reason('diet coke', LOW)).toBe(false);
        expect(reason('diet coke', { ...REG, kcal: 12 })).toBe(false);
        expect(reason('diet coke', { ...REG, kcal: NaN })).toBe(false);
    });

    it('leaves assessMacroPlausibility untouched', () => {
        expect(assessMacroPlausibility('diet coke', 'Diet Coke', REG).reasons.join('|')).not.toContain('diet_drink');
    });
});
