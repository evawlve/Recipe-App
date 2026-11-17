/**
 * dispatchServing()'s unitless AI sanity branch (legacy AiGeneratedFood candidates) deletes the
 * cached `medium`/`small` AiGeneratedServing row when the estimate is implausibly large
 * (`hydrate.stale_ai_cache_deleted`). A delete is a write, so under `nosave=1` (a request-scoped
 * write policy suppressing 'aiServing') the row must survive and the receipt must name the
 * refusal (s461 NOSAVE-DELETE). Without suppression the delete still happens, as before.
 *
 * The line is the real one the box log shows reaching this branch under nosave
 * (`Chipotle carnitas burrito`, 2026-10-10 and 2026-11-16): `chipotle` is in the small-produce
 * word list, so the cap is 100 g and any burrito estimate trips it. The estimate is mocked as a
 * SAVED row (`status: 'cached'`), which is the case where a delete destroys something.
 */
import { hydrateAndSelectServing } from '../map-ingredient-with-fallback';
import { runWithWritePolicy, currentWriteReceipt } from '../../write-policy';
import type { ParsedIngredient } from '../../parse/ingredient-line';

const mockDeleteMany = jest.fn().mockResolvedValue({ count: 1 });
jest.mock('../../db', () => ({
    prisma: {
        $queryRaw: jest.fn().mockResolvedValue([]),
        fdcServing: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null), deleteMany: jest.fn() },
        offServing: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null), deleteMany: jest.fn() },
        aiGeneratedServing: {
            findMany: jest.fn().mockResolvedValue([]),
            findUnique: jest.fn().mockResolvedValue(null),
            deleteMany: (...args: unknown[]) => mockDeleteMany(...args),
        },
        fdcFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        offFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        aiGeneratedFood: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null) },
        foodMapping: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    },
}));

jest.mock('../cache-search', () => ({
    ...jest.requireActual('../cache-search'),
    getCachedFoodWithRelations: jest.fn(async (id: string) => ({ id })),
    cacheFoodToDetails: jest.fn(() => ({
        id: 'cm_legacy_burrito', name: 'Chipotle Carnitas Burrito', brandName: null, foodType: 'Generic',
        nutrientsPer100g: { calories: 180, protein: 9, carbs: 20, fat: 7 },
        servings: [{
            id: 's1', description: '1 cup', measurementDescription: 'cup', numberOfUnits: 1,
            metricServingAmount: 200, metricServingUnit: 'g', servingWeightGrams: 200,
            calories: 360, protein: 18, carbohydrate: 40, fat: 14,
        }],
    })),
}));
jest.mock('../serving-backfill', () => ({
    ...jest.requireActual('../serving-backfill'),
    backfillOnDemand: jest.fn().mockResolvedValue({ success: false, reason: 'write_suppressed' }),
}));
jest.mock('../ambiguous-unit-backfill', () => ({
    ...jest.requireActual('../ambiguous-unit-backfill'),
    getOrCreateAmbiguousServing: jest.fn().mockResolvedValue({ status: 'cached', grams: 300 }),
}));

const legacy = {
    id: 'cm_legacy_burrito', source: 'cache' as const, name: 'Chipotle Carnitas Burrito', score: 1, foodType: 'Generic',
    nutrition: { kcal: 180, protein: 9, carbs: 20, fat: 7, per100g: true }, rawData: {},
} as never;
const RAW = 'Chipotle carnitas burrito';
const parsed = (): ParsedIngredient => ({ qty: 1, multiplier: 1, unit: null, name: 'chipotle carnitas burrito' } as unknown as ParsedIngredient);

beforeEach(() => mockDeleteMany.mockClear());

describe('unitless AI sanity branch: nosave never deletes a saved AiGeneratedServing row', () => {
    it('suppression ON: no delete, and the receipt names the refused row', async () => {
        const { r, receipt } = await runWithWritePolicy({ suppress: ['aiServing'], line: RAW }, async () => ({
            r: await hydrateAndSelectServing(legacy, parsed(), 0.9, RAW),
            receipt: currentWriteReceipt(),
        }));
        expect(mockDeleteMany).not.toHaveBeenCalled();
        expect(receipt?.refusedTotal).toBe(1);
        expect(receipt?.refused).toContainEqual({
            kind: 'aiServing', table: 'AiGeneratedServing', key: 'cm_legacy_burrito:medium', line: RAW,
        });
        expect(r).toBeNull(); // the implausible 300 g is discarded either way: no grams move
    });

    it('suppression OFF (a policy that suppresses nothing): the stale row is deleted, as today', async () => {
        const { r, receipt } = await runWithWritePolicy({ suppress: [], line: RAW }, async () => ({
            r: await hydrateAndSelectServing(legacy, parsed(), 0.9, RAW),
            receipt: currentWriteReceipt(),
        }));
        expect(mockDeleteMany).toHaveBeenCalledWith({ where: { foodId: 'cm_legacy_burrito', label: 'medium' } });
        expect(receipt?.refusedTotal).toBe(0);
        expect(r).toBeNull();
    });

    it('no policy at all (scripts, warm jobs): the stale row is deleted, as today', async () => {
        const r = await hydrateAndSelectServing(legacy, parsed(), 0.9, RAW);
        expect(mockDeleteMany).toHaveBeenCalledWith({ where: { foodId: 'cm_legacy_burrito', label: 'medium' } });
        expect(r).toBeNull();
    });
});
