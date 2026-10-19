/**
 * C70 S239: plural `peppers` joins the fresh-produce category ceiling, and a
 * QUERY containing `stuffed` is exempt from that category (a dish, not produce).
 *
 * `stuffed` is deliberately NOT in PREPARED_DISH_PATTERN (it is matched against
 * candidate names and also gates the lean-cut protein floor), so the lean-cut
 * controls below pin the origin/master reasons for "Stuffed ..." candidates.
 */
import { assessMacroPlausibility, assessRankTimePlausibility } from '../macro-plausibility';

type Macros = { kcal: number; protein: number; carbs: number; fat: number };
const m = (kcal: number, protein = 0, carbs = 0, fat = 0): Macros => ({ kcal, protein, carbs, fat });
const hasProduce = (reasons: string[]) => reasons.some((r) => r.startsWith('category:fresh_produce'));

describe('plural peppers — fresh_produce category fires', () => {
    it.each<[string, string, Macros]>([
        ['peppers', 'Peppers', m(300, 0, 0, 30)],
        ['some peppers', 'Peppers', m(300, 0, 0, 30)],
        ['roasted peppers', 'Roasted Peppers', m(260, 2, 10, 20)],
        // query is not stuffed, so a "Stuffed ..." candidate is still judged
        ['peppers', 'Stuffed Cherry Peppers', m(250, 3, 20, 15)],
    ])('%s / %s', (q, name, macros) => {
        expect(hasProduce(assessMacroPlausibility(q, name, macros).reasons)).toBe(true);
        const rank = assessRankTimePlausibility(q, name, macros);
        expect(hasProduce(rank.reasons)).toBe(true);
        expect(rank.floorHit).toBe(true);
    });
});

describe('peppers change — does not fire', () => {
    it.each<[string, string, Macros]>([
        ['stuffed peppers', 'Stuffed Peppers', m(176, 8, 10, 11)],
        ['stuffed mushrooms', 'Stuffed Mushrooms', m(281, 8, 15, 20)],
        ['sausage and peppers', 'Sausage and Peppers', m(267, 12, 8, 20)],
        ['black pepper', 'Black Pepper', m(251, 10, 64, 3)],
        ['pepper jack cheese', 'Pepper Jack', m(380, 24, 2, 31)],
        ['pepperoni', 'Pepperoni', m(500, 20, 1, 45)],
        // branded product names are not judged by the produce ceiling
        ["mama lil's peppers", 'Peppers', m(600, 2, 20, 63)],
        ["trader joe's peppers", 'Peppers', m(300, 2, 10, 30)],
        ['peppercorns', 'Black Peppercorns', m(255, 10, 64, 3)],
    ])('%s / %s', (q, name, macros) => {
        expect(assessMacroPlausibility(q, name, macros).reasons).toEqual([]);
        const rank = assessRankTimePlausibility(q, name, macros);
        expect(rank.reasons).toEqual([]);
        expect(rank.floorHit).toBe(false);
    });

    it('crispy red peppers (480): shipped behaviour FIRES — CONCENTRATED_FORM_PATTERN has no `crispy`', () => {
        const r = assessRankTimePlausibility('crispy red peppers', 'Crispy Red Peppers', m(480, 5, 40, 30));
        expect(r.reasons).toEqual(['category:fresh_produce_kcal_480_over_150']);
        expect(r.floorHit).toBe(true);
    });
});

describe('lean-cut protein floor — unchanged from origin/master for "Stuffed ..." candidates', () => {
    it('chicken breast / Stuffed Chicken Breast', () => {
        const r = assessRankTimePlausibility('chicken breast', 'Stuffed Chicken Breast', m(150, 10.7, 5, 8));
        expect(r.reasons).toEqual(['category:lean_cut_protein_below_floor(10.7)']);
        expect(r.floorHit).toBe(true);
    });
    it('salmon / Stuffed salmon fillet', () => {
        const r = assessRankTimePlausibility('salmon', 'Stuffed salmon fillet', m(180, 11.5, 5, 12));
        expect(r.reasons).toEqual(['category:lean_cut_protein_below_floor(11.5)']);
        expect(r.floorHit).toBe(true);
    });
});
