/**
 * buildFdcResult()'s per-unit sanity guard must read packetMaxGrams() (s461 PKT-FOOD). The guard
 * runs AFTER getOrCreateAmbiguousServing() on every FDC winner, so without it an FDC instant-oats
 * packet (USDA FdcServing `packet` rows: 28-45 g) is capped straight back to 10 g. Harness:
 * scoop-cap-fdc-guard.test.ts (same mocks; the estimator module stays REAL apart from the LLM call).
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
    id: 'fdc_999002', source: 'fdc' as const, name, score: 1, foodType: 'sr_legacy',
    nutrition: { kcal: 370, protein: 12, carbs: 68, fat: 7, per100g: true }, rawData: {},
} as never);
const parsed = (name: string): ParsedIngredient => ({ qty: 1, multiplier: 1, unit: 'packet', name } as ParsedIngredient);

describe('FDC per-unit guard', () => {
    it('a food packet keeps its 43 g (instant oats; was capped to 10)', async () => {
        amb.mockResolvedValue({ status: 'cached', grams: 43 });
        const r = await hydrateAndSelectServing(fdc('Cereals, oats, instant, fortified, plain, dry'), parsed('instant oatmeal'), 0.9, '1 packet of instant oatmeal');
        expect(r?.grams).toBe(43);
    });

    it('a sugar packet is still capped at 10 (the one logged fire: granulated sugars 227 -> 10)', async () => {
        amb.mockResolvedValue({ status: 'cached', grams: 227 });
        const r = await hydrateAndSelectServing(fdc('Sugars, granulated'), parsed('sugar'), 0.9, '1 packet of sugar');
        expect(r?.grams).toBe(10);
    });
});
