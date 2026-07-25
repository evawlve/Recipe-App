/**
 * Per-100g fallback for lines whose food row can't supply nutrition.
 *
 * Guards the fatsecret persist race: FatSecretFood rows are written by a
 * background task, so the first-ever sighting of one resolves against a row
 * that isn't there yet. Before this fallback the API returned a correct
 * serving value next to kcal100 = 0, and the mobile client rescales portions
 * by multiplying kcal100 — so nudging the portion control zeroed the entry.
 */

// Both functions under test are pure, but the module imports prisma at load.
jest.mock('../../db', () => ({
    prisma: {
        fatSecretFood: { findUnique: jest.fn() },
        offFood: { findUnique: jest.fn() },
        fdcFood: { findUnique: jest.fn() },
    },
}));

import { isDegenerateNutrition, per100gFromBilledMacros } from '../resolve-payload';

const EMPTY = {
    kcal100: 0, protein100: 0, carbs100: 0, fat100: 0,
    fiber100: 0, sugar100: 0, sodium100: 0,
};

describe('isDegenerateNutrition', () => {
    it('flags the all-zero block resolveFoodDetails starts from', () => {
        expect(isDegenerateNutrition(EMPTY)).toBe(true);
    });

    it('does not flag a block carrying any macro', () => {
        expect(isDegenerateNutrition({ ...EMPTY, kcal100: 656 })).toBe(false);
        expect(isDegenerateNutrition({ ...EMPTY, protein100: 14.3 })).toBe(false);
        expect(isDegenerateNutrition({ ...EMPTY, carbs100: 12.3 })).toBe(false);
        expect(isDegenerateNutrition({ ...EMPTY, fat100: 66.4 })).toBe(false);
    });

    it('ignores fiber/sugar/sodium — those are absent often enough to mean nothing', () => {
        expect(isDegenerateNutrition({ ...EMPTY, sodium100: 0.4 })).toBe(true);
    });
});

describe('per100gFromBilledMacros', () => {
    it('reproduces the value the food row would have carried', () => {
        // Measured on the box: cold "kohlrabi fritters" billed 53.5 kcal at
        // 15 g and reported kcal100 = 0; the next request read the persisted
        // row and returned 357.
        expect(per100gFromBilledMacros({
            grams: 15, kcal: 53.5, protein: 1.4, carbs: 6.2, fat: 2.7,
        })).toEqual({ kcal100: 356.67, protein100: 9.33, carbs100: 41.33, fat100: 18 });
    });

    it('is exact at 100 g', () => {
        expect(per100gFromBilledMacros({
            grams: 100, kcal: 656, protein: 14.32, carbs: 12.27, fat: 66.43,
        })).toEqual({ kcal100: 656, protein100: 14.32, carbs100: 12.27, fat100: 66.43 });
    });

    it('keeps per100g * grams == the billed macros, so client rescaling stays consistent', () => {
        // This invariant is the whole point: it holds even when `grams` is an
        // estimate, because both sides are derived from the same number.
        const billed = { grams: 905, kcal: 1810, protein: 90, carbs: 120, fat: 100 };
        const per100 = per100gFromBilledMacros(billed)!;
        expect((per100.kcal100 * billed.grams) / 100).toBeCloseTo(billed.kcal, 1);
        expect((per100.protein100 * billed.grams) / 100).toBeCloseTo(billed.protein, 1);
    });

    it('returns null when grams is zero or negative — nothing to divide by', () => {
        expect(per100gFromBilledMacros({ grams: 0, kcal: 100, protein: 1, carbs: 1, fat: 1 })).toBeNull();
        expect(per100gFromBilledMacros({ grams: -5, kcal: 100, protein: 1, carbs: 1, fat: 1 })).toBeNull();
    });

    it('returns null when the line itself has no macros — never invents nutrition', () => {
        expect(per100gFromBilledMacros({ grams: 100, kcal: 0, protein: 0, carbs: 0, fat: 0 })).toBeNull();
    });

    it('derives from a partial line (a macro-only record with no calories)', () => {
        expect(per100gFromBilledMacros({
            grams: 50, kcal: 0, protein: 10, carbs: 0, fat: 0,
        })).toEqual({ kcal100: 0, protein100: 20, carbs100: 0, fat100: 0 });
    });
});
