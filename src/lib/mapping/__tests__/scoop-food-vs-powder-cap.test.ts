/**
 * A scoop of powder is not a scoop of food (s459 pd-sc). `UNIT_MAX_GRAMS.scoop`
 * (50 g) is a protein-powder cap; it was applied to every food, so the
 * estimator's own answer for an ice-cream / mashed-potato / rice / casserole
 * scoop was clamped to 50 g. Measured in the box app log 2026-07-21 ->
 * 2026-11-15: 54 of 54 `scoop` clamps were non-powder foods, 0 were powders.
 *
 * Pins, in order: the powder cap is UNCHANGED for powder names and for the
 * unit-only call; non-powder names get FOOD_SCOOP_MAX_GRAMS; no other unit
 * moves; the estimator clamps a food scoop at the food cap and a powder scoop
 * at the powder cap; and a whole-item NAME seed (mashed potato = a 213 g
 * potato) is still refused for a scoop — the cap is what keeps it out.
 */
jest.mock('../../ai/structured-client', () => ({ callStructuredLlm: jest.fn() }));
jest.mock('../../fdc/fdc-servings', () => ({ getFdcServingWeight: jest.fn().mockResolvedValue(null) }));
jest.mock('../../db', () => ({
    prisma: {
        $queryRaw: jest.fn().mockResolvedValue([]),
        offServing: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
        fdcServing: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
        aiGeneratedServing: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn().mockResolvedValue({}) },
    },
}));

import { callStructuredLlm } from '../../ai/structured-client';
import {
    estimateAmbiguousServing,
    getAmbiguousUnitBounds,
    scoopMaxGrams,
    POWDER_SCOOP_MAX_GRAMS,
    FOOD_SCOOP_MAX_GRAMS,
} from '../../ai/ambiguous-serving-estimator';
import { getDefaultCountServing } from '../../servings/default-count-grams';

const llm = callStructuredLlm as jest.Mock;
const answer = (g: number) => llm.mockResolvedValueOnce({
    status: 'success',
    content: { estimatedGrams: g, confidence: 0.9, reasoning: 'test', error: null },
});

const savedKey = process.env.OPENROUTER_API_KEY;
beforeAll(() => { process.env.OPENROUTER_API_KEY = 'test-only'; });
afterAll(() => { if (savedKey === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = savedKey; });
beforeEach(() => llm.mockReset());

describe('bounds', () => {
    it('the unit-only call reads exactly as before (50 g)', () => {
        expect(POWDER_SCOOP_MAX_GRAMS).toBe(50);
        expect(getAmbiguousUnitBounds('scoop')).toEqual({ min: undefined, max: 50 });
        expect(getAmbiguousUnitBounds('scoops')).toEqual({ min: undefined, max: 50 });
    });

    it.each([
        'Whey', 'Whey Protein', 'Casein', 'Collagen Peptides', 'Creatine Monohydrate', 'Pre-workout',
        'Pre Workout', 'BCAA', 'Greens Powder', 'Mass Gainer', 'Gold Standard 100% Isolate', 'Protein Ice Cream',
    ])('a powder name keeps the 50 g cap: %s', (name) => {
        expect(getAmbiguousUnitBounds('scoop', name).max).toBe(50);
    });

    it.each([
        'Vanilla ice cream', 'Mashed Potatoes', 'White Rice', 'Cottage Cheese', 'Coleslaw',
        'Baked Beans', 'Chicken Enchilada Casserole', "Shepherd's pie",
    ])('a food name gets the food cap: %s', (name) => {
        expect(FOOD_SCOOP_MAX_GRAMS).toBe(120);
        expect(getAmbiguousUnitBounds('scoop', name).max).toBe(FOOD_SCOOP_MAX_GRAMS);
    });

    it('no other unit moves when a food name is passed', () => {
        expect(getAmbiguousUnitBounds('bar', 'Mashed Potatoes')).toEqual(getAmbiguousUnitBounds('bar'));
        expect(getAmbiguousUnitBounds('packet', 'Coleslaw')).toEqual(getAmbiguousUnitBounds('packet'));
        expect(scoopMaxGrams('cup', 'Mashed Potatoes')).toBeNull();
    });

    it('a whole-item name seed is still refused for a scoop (213 g potato > the food cap)', () => {
        const seed = getDefaultCountServing('Mashed Potatoes', 'scoop');
        expect(seed?.grams).toBe(213);
        expect(seed!.grams).toBeGreaterThan(getAmbiguousUnitBounds('scoop', 'Mashed Potatoes').max!);
    });
});

describe('estimateAmbiguousServing clamp', () => {
    it('a food scoop keeps the model answer under the food cap (ice cream 66 g was billed 50 g)', async () => {
        answer(66);
        const r = await estimateAmbiguousServing({ foodName: 'Vanilla Ice Creams', unit: 'scoop' });
        expect(r).toMatchObject({ status: 'success', estimatedGrams: 66 });
    });

    it('a food scoop above the food cap clamps to it (casserole 200 g -> 120 g)', async () => {
        answer(200);
        const r = await estimateAmbiguousServing({ foodName: 'Chicken Enchilada Casserole', unit: 'scoop' });
        expect(r.estimatedGrams).toBe(120);
    });

    it('a powder scoop still clamps at 50 g (the 86 g/scoop hallucination the cap was written for)', async () => {
        answer(86);
        const r = await estimateAmbiguousServing({ foodName: 'Whey Protein', unit: 'scoop' });
        expect(r.estimatedGrams).toBe(50);
    });
});
