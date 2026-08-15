/**
 * `sodium100` carries ONE unit — grams per 100 g — on every branch of
 * resolveFoodDetails.
 *
 * WHY THIS FILE EXISTS. resolveFoodDetails reads four different stores and
 * emits one type. Three of them hold sodium in grams; `AiGeneratedFood` holds
 * milligrams (`sodiumMgPer100g`, correctly named) and was assigned straight
 * through, so a single wire field meant two things 1000x apart, separable only
 * by `source`. Nothing caught it because every existing test asserted one branch
 * at a time: the fs_ suite already pinned "grams, not mg", and it was true —
 * for fs_.
 *
 * So the assertion that matters is CROSS-BRANCH, and it is written that way
 * below: one table, one expectation, every branch. A future store added to
 * resolveFoodDetails should be added here, not tested in isolation.
 *
 * The values are real. Measured on the box 2026-08-15:
 *   fs_3272   "Soy Sauce"            panel sodium 5.637  (its own 100 g serving row reads 5637 mg)
 *   AiGeneratedFood.sodiumMgPer100g  213 rows, min 0, max 1200, mean 427.5
 * 1200 is the falsifier for the AI column's unit: as grams per 100 g it would be
 * twelve times the mass of the food, which is not a quantity. It is milligrams.
 */

const mockFdcFindUnique = jest.fn();
const mockOffFindUnique = jest.fn();
const mockFsFindUnique = jest.fn();
const mockAiFindUnique = jest.fn();

jest.mock('../../db', () => ({
    prisma: {
        fdcFood: { findUnique: (...a: unknown[]) => mockFdcFindUnique(...a) },
        offFood: { findUnique: (...a: unknown[]) => mockOffFindUnique(...a) },
        fatSecretFood: { findUnique: (...a: unknown[]) => mockFsFindUnique(...a) },
        aiGeneratedFood: { findUnique: (...a: unknown[]) => mockAiFindUnique(...a) },
    },
}));

import { resolveFoodDetails } from '../resolve-payload';

/** 585 mg of sodium per 100 g — a bag of Doritos — in each store's own unit. */
const DORITOS_SODIUM_G = 0.585;
const DORITOS_SODIUM_MG = 585;

beforeEach(() => {
    mockFdcFindUnique.mockReset();
    mockOffFindUnique.mockReset();
    mockFsFindUnique.mockReset();
    mockAiFindUnique.mockReset();
});

describe('sodium100 is grams per 100 g on every branch', () => {
    it('fdc_ passes the stored grams through', async () => {
        mockFdcFindUnique.mockResolvedValue({
            fdcId: 1, description: 'Tortilla Chips', brandName: null,
            nutrientsPer100g: { calories: 498, protein: 7, carbs: 63, fat: 25, sodium: DORITOS_SODIUM_G },
            servings: [],
        });
        const d = await resolveFoodDetails('fdc_1');
        expect(d.source).toBe('fdc');
        expect(d.nutritionPer100g.sodium100).toBeCloseTo(DORITOS_SODIUM_G, 6);
    });

    it('off_ passes the stored grams through', async () => {
        mockOffFindUnique.mockResolvedValue({
            barcode: '1', name: 'Doritos', brandName: 'Doritos', servingGrams: null, servingSize: null,
            nutrientsPer100g: { kcal: 498, protein: 7, carbs: 63, fat: 25, sodium: DORITOS_SODIUM_G },
            servings: [],
        });
        const d = await resolveFoodDetails('off_1');
        expect(d.source).toBe('openfoodfacts');
        expect(d.nutritionPer100g.sodium100).toBeCloseTo(DORITOS_SODIUM_G, 6);
    });

    it('fs_ passes the stored grams through', async () => {
        mockFsFindUnique.mockResolvedValue({
            fsId: '1', name: 'Doritos', brandName: 'Doritos', defaultServingId: null, fetchedAt: new Date(),
            nutrientsPer100g: { calories: 498, protein: 7, carbs: 63, fat: 25, sodium: DORITOS_SODIUM_G },
            servings: [{ servingId: 's', description: '1 oz', measurementDescription: 'oz', grams: 28, volumeMl: null, numberOfUnits: 1, nutrients: {} }],
        });
        const d = await resolveFoodDetails('fs_1');
        expect(d.source).toBe('fatsecret');
        expect(d.nutritionPer100g.sodium100).toBeCloseTo(DORITOS_SODIUM_G, 6);
    });

    it('ai_generated CONVERTS its milligram column to grams', async () => {
        mockAiFindUnique.mockResolvedValue({
            id: 'ckabc', displayName: 'Doritos',
            caloriesPer100g: 498, proteinPer100g: 7, carbsPer100g: 63, fatPer100g: 25,
            fiberPer100g: 4, sugarPer100g: 2,
            sodiumMgPer100g: DORITOS_SODIUM_MG,
            servings: [],
        });
        const d = await resolveFoodDetails('ckabc');
        expect(d.source).toBe('ai_estimated');
        // NOT 585. That is the bug this file pins shut.
        expect(d.nutritionPer100g.sodium100).toBeCloseTo(DORITOS_SODIUM_G, 6);
    });

    it('all four branches agree on the same food to within rounding', async () => {
        mockFdcFindUnique.mockResolvedValue({
            fdcId: 1, description: 'D', brandName: null,
            nutrientsPer100g: { calories: 498, sodium: DORITOS_SODIUM_G }, servings: [],
        });
        mockOffFindUnique.mockResolvedValue({
            barcode: '1', name: 'D', brandName: null, servingGrams: null, servingSize: null,
            nutrientsPer100g: { kcal: 498, sodium: DORITOS_SODIUM_G }, servings: [],
        });
        mockFsFindUnique.mockResolvedValue({
            fsId: '1', name: 'D', brandName: null, defaultServingId: null, fetchedAt: new Date(),
            nutrientsPer100g: { calories: 498, sodium: DORITOS_SODIUM_G },
            servings: [{ servingId: 's', description: '1 oz', measurementDescription: null, grams: 28, volumeMl: null, numberOfUnits: 1, nutrients: {} }],
        });
        mockAiFindUnique.mockResolvedValue({
            id: 'ckabc', displayName: 'D',
            caloriesPer100g: 498, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0,
            fiberPer100g: 0, sugarPer100g: 0, sodiumMgPer100g: DORITOS_SODIUM_MG,
            servings: [],
        });

        const all = await Promise.all(
            ['fdc_1', 'off_1', 'fs_1', 'ckabc'].map(id => resolveFoodDetails(id)),
        );

        for (const d of all) {
            expect(d.nutritionPer100g.sodium100).toBeCloseTo(DORITOS_SODIUM_G, 6);
            // A grams-per-100g figure can never exceed 100. This is the cheap
            // structural check that catches a milligram leak on any future branch,
            // whatever the food.
            expect(d.nutritionPer100g.sodium100).toBeLessThanOrEqual(100);
        }
    });

    it('a null AI sodium column still reads 0, not NaN', async () => {
        mockAiFindUnique.mockResolvedValue({
            id: 'cknull', displayName: 'Unknown',
            caloriesPer100g: 100, proteinPer100g: 0, carbsPer100g: 0, fatPer100g: 0,
            fiberPer100g: null, sugarPer100g: null, sodiumMgPer100g: null,
            servings: [],
        });
        const d = await resolveFoodDetails('cknull');
        expect(d.nutritionPer100g.sodium100).toBe(0);
    });
});
