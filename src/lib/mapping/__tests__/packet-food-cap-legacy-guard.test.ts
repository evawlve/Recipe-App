/**
 * dispatchServing()'s legacy per-unit sanity guard (AiGeneratedFood cache candidates) must read
 * packetMaxGrams() too (s461 PKT-FOOD), or a 40 g packet resolved for a legacy record is capped back
 * to the 10 g condiment cap while the FatSecret / OFF / FDC lanes bill it. selectServing() skips an
 * ambiguous unit and the lane asks getOrCreateAmbiguousServing(), mocked here (as in
 * packet-food-cap-fdc-guard.test.ts) so the GUARD is what the pin reads.
 */
import { hydrateAndSelectServing } from '../map-ingredient-with-fallback';
import type { ParsedIngredient } from '../../parse/ingredient-line';

jest.mock('../../db', () => ({
    prisma: {
        $queryRaw: jest.fn().mockResolvedValue([]),
        fdcServing: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn().mockResolvedValue(null) },
        offServing: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        aiGeneratedServing: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        fdcFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        offFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        aiGeneratedFood: { findMany: jest.fn().mockResolvedValue([]), findFirst: jest.fn().mockResolvedValue(null), findUnique: jest.fn().mockResolvedValue(null) },
        foodMapping: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    },
}));

const packetDetails = (name: string) => ({
    id: 'cm_legacy_packet', name, brandName: null, foodType: 'Generic',
    nutrientsPer100g: { calories: 380, protein: 12, carbs: 66, fat: 7 },
    servings: [{
        id: 's1', description: '1 packet', measurementDescription: 'packet', numberOfUnits: 1,
        metricServingAmount: 40, metricServingUnit: 'g', servingWeightGrams: 40,
        calories: 152, protein: 4.8, carbohydrate: 26.4, fat: 2.8,
    }],
});
jest.mock('../cache-search', () => ({
    ...jest.requireActual('../cache-search'),
    getCachedFoodWithRelations: jest.fn(async (id: string) => ({ id })),
    cacheFoodToDetails: jest.fn(),
}));
import { cacheFoodToDetails } from '../cache-search';
jest.mock('../ambiguous-unit-backfill', () => ({
    ...jest.requireActual('../ambiguous-unit-backfill'),
    getOrCreateAmbiguousServing: jest.fn().mockResolvedValue({ status: 'cached', grams: 40 }),
}));

const legacy = (name: string) => ({
    id: 'cm_legacy_packet', source: 'cache' as const, name, score: 1, foodType: 'Generic',
    nutrition: { kcal: 380, protein: 12, carbs: 66, fat: 7, per100g: true }, rawData: {},
} as never);
const parsed = (name: string): ParsedIngredient => ({ qty: 1, multiplier: 1, unit: 'packet', name } as ParsedIngredient);

describe('legacy per-unit guard', () => {
    it('a food record keeps a 40 g packet (instant oatmeal; was capped to 10)', async () => {
        (cacheFoodToDetails as jest.Mock).mockReturnValue(packetDetails('Instant Oatmeal'));
        const r = await hydrateAndSelectServing(legacy('Instant Oatmeal'), parsed('instant oatmeal'), 0.9, '1 packet of instant oatmeal');
        expect(r?.grams).toBe(40);
    });

    it('a non-food record with the same 40 g packet is still capped at 10 (boundary)', async () => {
        (cacheFoodToDetails as jest.Mock).mockReturnValue(packetDetails('Strawberry Jam'));
        const r = await hydrateAndSelectServing(legacy('Strawberry Jam'), parsed('strawberry jam'), 0.9, '1 packet of strawberry jam');
        expect(r?.grams).toBe(10);
    });
});
