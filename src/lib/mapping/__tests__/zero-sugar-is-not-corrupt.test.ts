import { hasNullOrInvalidMacros } from '../filter-candidates';

/**
 * THE ZERO-MACRO CORRUPTION GUARD MUST ASK WHETHER A MACRO IS MISSING.
 *
 * `hasNullOrInvalidMacros()` rejects a caloric candidate whose protein AND carbs
 * are both zero, on the premise that a real food's calories have to come from
 * somewhere. The premise is right; the predicate used to be `fat <= 50`, which
 * is a quantity standing in for the category "pure-fat food", and it deleted
 * every genuine LOW-fat, no-sugar, no-protein product instead — measured at
 * 2,262 `OffFood` rows, 2,242 of which (99.1%) have fat that accounts for their
 * stated calories to within +/-30%.
 *
 * These cases pin BOTH directions, because the guard is only worth having if it
 * still catches what it was written for.
 */
describe('hasNullOrInvalidMacros: P=0 C=0 means "a macro is missing", not "low fat"', () => {
    it('KEEPS the zero-sugar creamer that a real alpha bill got wrong (punch #38)', () => {
        // off_0050000659302 "French Vanilla Zero Sugar Creamer" [Coffee mate],
        // verbatim from the live corpus. Fat explains 60 of its 66.7 kcal.
        expect(hasNullOrInvalidMacros(
            { kcal: 66.69999694824219, protein: 0, carbs: 0, fat: 6.670000076293945 },
            'French Vanilla Zero Sugar Creamer',
        )).toBe(false);
    });

    it('still REJECTS the red-lentil shape the guard was written for', () => {
        // The case named in the guard's own comment: 314 kcal against 2.86 g of
        // fat, so the fat explains 8.2% and protein/carbs really are missing.
        expect(hasNullOrInvalidMacros(
            { kcal: 314, protein: 0, carbs: 0, fat: 2.86 },
            'Red Lentils',
        )).toBe(true);
    });

    it('still REJECTS a caloric row carrying no fat at all', () => {
        // "Organic Basil Leaves" 285.7 kcal / 0 g fat, live corpus — one of the
        // 8 rows that fail the new test as well as the old one.
        expect(hasNullOrInvalidMacros(
            { kcal: 285.7142857142857, protein: 0, carbs: 0, fat: 0 },
            'Organic Basil Leaves',
        )).toBe(true);
    });

    it('keeps exempting a pure-fat food WITHOUT needing a fat threshold to name it', () => {
        expect(hasNullOrInvalidMacros({ kcal: 884, protein: 0, carbs: 0, fat: 100 }, 'Olive Oil')).toBe(false);
    });

    it('keeps the olive/seaweed band the old predicate deleted', () => {
        // Fat explains ~68% here. Under-reported, but a real food, and deleting
        // it is the larger error.
        expect(hasNullOrInvalidMacros({ kcal: 133.33, protein: 0, carbs: 0, fat: 10 }, 'Ripe olives')).toBe(false);
    });

    it('is unchanged where protein or carbs are actually present', () => {
        expect(hasNullOrInvalidMacros({ kcal: 500, protein: 0, carbs: 100, fat: 0 }, 'French Vanilla')).toBe(false);
    });
});
