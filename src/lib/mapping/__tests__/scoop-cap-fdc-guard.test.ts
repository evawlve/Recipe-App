/**
 * buildFdcResult()'s per-unit sanity guard must read scoopMaxGrams() (s459 sc, refuter rf-sc).
 * The guard runs AFTER getOrCreateAmbiguousServing() on every FDC winner, so without it the
 * estimator's food-scoop answer (66 g ice cream) is capped straight back to 50 g. It fired 0
 * times on `scoop` in the box log only because nothing upstream ever exceeded 50.
 * Harness: fdc-fallback-tiers.test.ts (same mocks; the estimator module stays REAL apart from
 * the LLM call, so scoopMaxGrams() is the shipped one).
 */
import { hydrateAndSelectServing } from '../map-ingredient-with-fallback';
import { getOrCreateAmbiguousServing } from '../ambiguous-unit-backfill';
import type { ParsedIngredient } from '../../parse/ingredient-line';

jest.mock('../../db', () => ({
    prisma: {
        $queryRaw: jest.fn().mockResolvedValue([]),
        fdcServing: {
            findMany: jest.fn().mockResolvedValue([]),
            findUnique: jest.fn().mockResolvedValue(null),
            findFirst: jest.fn().mockResolvedValue(null),
            upsert: jest.fn().mockResolvedValue({}),
        },
        fdcFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        offFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        aiGeneratedFood: {
            findMany: jest.fn().mockResolvedValue([]),
            findFirst: jest.fn().mockResolvedValue(null),
            findUnique: jest.fn().mockResolvedValue(null),
        },
        foodMapping: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    },
}));
jest.mock('../../usda/fdc-ai-backfill', () => ({
    ...jest.requireActual('../../usda/fdc-ai-backfill'),
    getOrCreateFdcSizeServings: jest.fn().mockResolvedValue(null),
    insertFdcAiServing: jest.fn().mockResolvedValue({ success: false, reason: 'mocked-off' }),
}));
jest.mock('../ambiguous-unit-backfill', () => ({
    ...jest.requireActual('../ambiguous-unit-backfill'),
    getOrCreateAmbiguousServing: jest.fn(),
}));
jest.mock('../../ai/ambiguous-serving-estimator', () => ({
    ...jest.requireActual('../../ai/ambiguous-serving-estimator'),
    estimateAmbiguousServing: jest.fn().mockResolvedValue({ status: 'error', error: 'mocked-off' }),
}));

const amb = getOrCreateAmbiguousServing as jest.Mock;
const fdc = (name: string) => ({
    id: 'fdc_999001', source: 'fdc' as const, name, score: 1, foodType: 'sr_legacy',
    nutrition: { kcal: 200, protein: 3.5, carbs: 23.6, fat: 11, per100g: true }, rawData: {},
} as never);
const parsed = (name: string): ParsedIngredient => ({ qty: 1, multiplier: 1, unit: 'scoop', name } as ParsedIngredient);

describe('FDC per-unit guard', () => {
    it('a food scoop keeps the estimator answer (66 g ice cream, was capped to 50)', async () => {
        amb.mockResolvedValue({ status: 'success', grams: 66 });
        const r = await hydrateAndSelectServing(fdc('Ice creams, vanilla'), parsed('vanilla ice cream'), 0.9, '1 scoop vanilla ice cream');
        expect(r?.servingTier).toBe('count_unit_ai');
        expect(r?.grams).toBe(66);
    });

    it('a powder scoop is still capped at 50 (FDC 173177 carries an 86 g scoop row)', async () => {
        amb.mockResolvedValue({ status: 'cached', grams: 86 });
        const r = await hydrateAndSelectServing(fdc('Beverages, Whey protein powder isolate'), parsed('whey protein isolate'), 0.9, '1 scoop whey protein isolate');
        expect(r?.grams).toBe(50);
    });
});
