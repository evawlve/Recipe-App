/**
 * Category-classifier regression set for the save-time plausibility gate.
 *
 * Every case here is a REAL row from the 1,158-seed cold warm of 2026-07-24
 * (sync-docs/funnel_first_read_2026-07-24.md), with the per-100g values the
 * mapper actually produced. That batch rejected 21 saves and 18 were false
 * positives — all three mechanisms below.
 *
 * The point of pinning real values is that the correct-rejection cases are as
 * load-bearing as the false-positive ones: widening the classifier must not
 * quietly stop catching beef stew at 20 kcal/100g.
 */

import { assessSaveTimePlausibility } from '../macro-plausibility';

type Macros = { kcal: number; protein: number; carbs: number; fat: number };

// The AI estimate that accompanied these lines. Only applied where the
// original rejection came from the estimate cross-check.
const noEstimate = null;

describe('produce-word hijack — a produce token inside a prepared dish', () => {
    it.each<[string, string, Macros]>([
        ['banana bread', 'Banana bread', { kcal: 314.5, protein: 5.4, carbs: 42.6, fat: 12.8 }],
        ['blueberry muffin', 'Blueberry muffin', { kcal: 504.5, protein: 7.1, carbs: 65.3, fat: 23.3 }],
        ['carrot cake', 'Carrot Cake', { kcal: 390.8, protein: 5.1, carbs: 57, fat: 16 }],
        ['pumpkin bread', 'Pumpkin Bread', { kcal: 247, protein: 9.5, carbs: 25.7, fat: 10.7 }],
        ['pumpkin pie', 'Pumpkin Pie', { kcal: 244, protein: 4.2, carbs: 41.18, fat: 7.56 }],
        ['zucchini bread', 'Zucchini Bread', { kcal: 306, protein: 2.86, carbs: 45.71, fat: 14.29 }],
        ['peach cobbler', 'Peach cobbler', { kcal: 282, protein: 2.35, carbs: 50.59, fat: 7.06 }],
        ['restaurant apple pie', 'Pie Filling Apple', { kcal: 177, protein: 0, carbs: 44.2, fat: 0 }],
        ['eggs florentine', 'Cheese and spinach roll', { kcal: 428, protein: 16.44, carbs: 34.96, fat: 24.66 }],
        ['orange chicken', 'Orange Chicken', { kcal: 192.9, protein: 7.86, carbs: 25.71, fat: 6.43 }],
    ])('saves "%s"', (query, foodName, macros) => {
        const r = assessSaveTimePlausibility(query, foodName, macros, noEstimate);
        expect(r.reasons).toEqual([]);
        expect(r.save).toBe(true);
    });

    it('still holds actual fresh produce to the ceiling', () => {
        // A raw carrot has no business at 390 kcal/100g.
        const r = assessSaveTimePlausibility('carrot', 'Carrot', {
            kcal: 390, protein: 5, carbs: 57, fat: 16,
        }, noEstimate);
        expect(r.save).toBe(false);
        expect(r.reasons.some(x => x.startsWith('category:fresh_produce_kcal'))).toBe(true);
    });

    it('still allows a concentrated form past the ceiling', () => {
        const r = assessSaveTimePlausibility('banana chips', 'Banana Chips', {
            kcal: 519, protein: 2.3, carbs: 58, fat: 34,
        }, noEstimate);
        expect(r.save).toBe(true);
    });
});

describe('ethanol — cocktails carry 7 kcal/g that P/C/F cannot explain', () => {
    it('saves a martini at its correct 226 kcal/100g', () => {
        const r = assessSaveTimePlausibility('martini', 'Martini', {
            kcal: 226, protein: 0.02, carbs: 0.57, fat: 0,
        }, noEstimate);
        expect(r.reasons).toEqual([]);
    });

    it.each(['mojito', 'daiquiri', 'negroni', 'mimosa', 'pina colada'])(
        'exempts %s from the high-side Atwater check', (drink) => {
            const r = assessSaveTimePlausibility(drink, drink, {
                kcal: 190, protein: 0, carbs: 5, fat: 0,
            }, noEstimate);
            expect(r.reasons.some(x => x.startsWith('atwater:'))).toBe(false);
        });

    it('does NOT exempt fruit punch — it is not alcoholic', () => {
        const r = assessSaveTimePlausibility('fruit punch', 'Fruit Punch', {
            kcal: 220, protein: 0, carbs: 4, fat: 0,
        }, noEstimate);
        expect(r.reasons.some(x => x.startsWith('atwater:'))).toBe(true);
    });
});

describe('lean-cut protein floor — composite dishes dilute the cut', () => {
    it.each<[string, string, Macros]>([
        ['shrimp scampi', 'Shrimp scampi', { kcal: 222.2, protein: 11.11, carbs: 18.18, fat: 11.11 }],
        ['restaurant shrimp scampi', 'Shrimp scampi', { kcal: 222.2, protein: 11.11, carbs: 18.18, fat: 11.11 }],
        ['red lobster shrimp scampi', 'Red Lobster, Garlic Shrimp Scampi', { kcal: 233, protein: 17, carbs: 3, fat: 17 }],
        ['shrimp stir fry', 'Shrimp stir fry', { kcal: 130.4, protein: 9.24, carbs: 16.85, fat: 3.26 }],
        ['tuna casserole', 'Tuna Casserole', { kcal: 79, protein: 6.17, carbs: 9.69, fat: 2.2 }],
    ])('saves "%s"', (query, foodName, macros) => {
        const r = assessSaveTimePlausibility(query, foodName, macros, noEstimate);
        expect(r.reasons).toEqual([]);
    });

    it('still floors a bare lean cut that resolved to a deli product', () => {
        // The case the floor was built for: "chicken breast" -> a 14.6g roll.
        const r = assessSaveTimePlausibility('chicken breast', 'Chicken Breast Deli Roll', {
            kcal: 110, protein: 14.6, carbs: 2, fat: 3,
        }, noEstimate);
        expect(r.save).toBe(false);
        expect(r.reasons.some(x => x.startsWith('category:lean_cut_protein_below_floor'))).toBe(true);
    });
});

describe('zero-calorie flavoured drinks', () => {
    it('saves grapefruit sparkling water below the produce floor', () => {
        const r = assessSaveTimePlausibility('la croix pamplemousse', 'Grapefruit Sparkling Water', {
            kcal: 4.79, protein: 0, carbs: 1.13, fat: 0,
        }, noEstimate);
        expect(r.reasons).toEqual([]);
    });

    it('still floors orange juice — juice is deliberately not exempt', () => {
        const r = assessSaveTimePlausibility('orange juice', 'Orange Juice', {
            kcal: 4, protein: 0, carbs: 1, fat: 0,
        }, noEstimate);
        expect(r.save).toBe(false);
        expect(r.reasons.some(x => x.startsWith('floor:produce_kcal'))).toBe(true);
    });
});

describe('correct rejections must survive the widening', () => {
    // These two were the genuine corruption in the same batch. They were
    // caught by the AI-estimate cross-check, which this change does not touch.
    it('still rejects beef stew at 20 kcal/100g', () => {
        const r = assessSaveTimePlausibility('beef stew', 'Beef stew',
            { kcal: 20, protein: 3.71, carbs: 0.29, fat: 0.51 },
            { caloriesPer100g: 120, proteinPer100g: 9, confidence: 0.9 });
        expect(r.save).toBe(false);
    });

    it('still rejects oxtail soup at 26 kcal/100g', () => {
        const r = assessSaveTimePlausibility('oxtail', 'Oxtail Soup',
            { kcal: 26, protein: 0.6, carbs: 4.2, fat: 0.7 },
            { caloriesPer100g: 250, proteinPer100g: 20, confidence: 0.9 });
        expect(r.save).toBe(false);
    });

    it('still rejects all-zero macros for a prepared dish', () => {
        // Now the zero-macro gate's job, but the estimate check should also fire.
        const r = assessSaveTimePlausibility('cherry garcia', 'Cherry Garcia Ice Cream',
            { kcal: 0, protein: 0, carbs: 0, fat: 0 },
            { caloriesPer100g: 240, proteinPer100g: 4, confidence: 0.9 });
        expect(r.save).toBe(false);
    });
});
