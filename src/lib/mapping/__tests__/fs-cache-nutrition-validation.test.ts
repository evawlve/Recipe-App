/**
 * FatSecret cache hits must run the same nutrition-validity check as OFF and FDC.
 *
 * THE GAP THIS CLOSES (found 2026-08-01). Steps 1a and 1c branched
 * `fdc_` / `off_` / else, and the else did
 * `prisma.aiGeneratedFood.findUnique({ where: { id: foodId } })`. That arm was
 * described as dead. It is not — it EXECUTES on every `fs_` cache hit, it just
 * can never match: MEASURED, 0 of the 149 AiGeneratedFood ids carry an
 * fs_/off_/fdc_ prefix (they are cuids), while 570 of 3,509 FoodMapping rows
 * carry an fsId. So for an fs_ hit `nutrients` stayed null, and because the
 * missing-nutrition safety net was gated on `startsWith('off_')`, the hit
 * bypassed hasNullOrInvalidMacros() entirely and was served unchecked.
 *
 * MEASURED blast radius of turning the check on: of the 570 fs_ cache rows, 35
 * point at a FatSecretFood whose nutrientsPer100g is `{}` — real menu items
 * ("Ten Vegetable Soup - Bowl", "White Top Pizza - Large") served with null
 * nutrition. The remaining 535 pass unchanged, including "Stevia" (0 kcal / 50g
 * carbs), which only survives because the food NAME is now passed to
 * hasNullOrInvalidMacros so its sweetener exception can apply.
 */

import { mapIngredientWithFallback, type MappingTelemetry } from '../map-ingredient-with-fallback';
import { aiNormalizeIngredient } from '../ai-normalize';
import {
    getValidatedMapping,
    getValidatedMappingByNormalizedName,
    saveValidatedMapping,
    getAiNormalizeCache,
} from '../validated-mapping-helpers';
import { findCanonicalName, getKnownSynonyms, saveSynonyms } from '../ai-synonym-generator';
import { getLearnedSynonyms, extractTermsFromIngredient } from '../learned-synonyms';
import { getCachedFoodWithRelations } from '../cache-search';
import { ensureFoodCached } from '../cache';
import { hydrateSingleCandidate } from '../hydrate-cache';
import { queueForDeferredHydration } from '../deferred-hydration';
import { backfillOnDemand } from '../serving-backfill';
import { insertAiServing } from '../ai-backfill';
import { gatherCandidates } from '../gather-candidates';
import { prisma } from '../../db';

jest.mock('../../db', () => ({
    prisma: {
        $queryRaw: jest.fn().mockResolvedValue([]),
        fdcFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        offFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        fatSecretFood: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
        aiGeneratedFood: {
            findMany: jest.fn().mockResolvedValue([]),
            findFirst: jest.fn().mockResolvedValue(null),
            findUnique: jest.fn().mockResolvedValue(null),
        },
        foodMapping: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
        ingredient: { findMany: jest.fn().mockResolvedValue([]) },
    },
}));

jest.mock('../ai-normalize');
jest.mock('../validated-mapping-helpers', () => {
    const actual = jest.requireActual('../validated-mapping-helpers');
    return {
        ...actual,
        getValidatedMapping: jest.fn(),
        getValidatedMappingByNormalizedName: jest.fn(),
        saveValidatedMapping: jest.fn(),
        getAiNormalizeCache: jest.fn(),
        saveAiNormalizeCache: jest.fn(),
        trackValidationFailure: jest.fn(),
    };
});
jest.mock('../ai-synonym-generator');
jest.mock('../learned-synonyms');
jest.mock('../cache-search', () => {
    const actual = jest.requireActual('../cache-search');
    return { ...actual, getCachedFoodWithRelations: jest.fn() };
});
jest.mock('../cache');
jest.mock('../hydrate-cache');
jest.mock('../deferred-hydration');
jest.mock('../serving-backfill');
jest.mock('../ai-backfill', () => ({
    insertAiServing: jest.fn(),
    backfillWeightServing: jest.fn().mockResolvedValue({ success: false, reason: 'skip' }),
}));
jest.mock('../gather-candidates', () => {
    const actual = jest.requireActual('../gather-candidates');
    return { ...actual, gatherCandidates: jest.fn() };
});

const fsCacheRow = {
    foodId: 'fs_69219858',
    foodName: 'Ten Vegetable Soup - Bowl',
    brandName: null,
    source: 'fatsecret',
    confidence: 0.9,
};

beforeEach(() => {
    jest.clearAllMocks();
    (aiNormalizeIngredient as jest.Mock).mockResolvedValue({ status: 'error', reason: 'skip' });
    (getValidatedMapping as jest.Mock).mockResolvedValue(null);
    (getValidatedMappingByNormalizedName as jest.Mock).mockResolvedValue(null);
    (getAiNormalizeCache as jest.Mock).mockResolvedValue(null);
    (saveValidatedMapping as jest.Mock).mockResolvedValue(undefined);
    (findCanonicalName as jest.Mock).mockResolvedValue(null);
    (getKnownSynonyms as jest.Mock).mockReturnValue([]);
    (saveSynonyms as jest.Mock).mockResolvedValue(undefined);
    (getLearnedSynonyms as jest.Mock).mockResolvedValue([]);
    (extractTermsFromIngredient as jest.Mock).mockReturnValue([]);
    (getCachedFoodWithRelations as jest.Mock).mockResolvedValue(null);
    (ensureFoodCached as jest.Mock).mockResolvedValue(null);
    (hydrateSingleCandidate as jest.Mock).mockResolvedValue(true);
    (queueForDeferredHydration as jest.Mock).mockImplementation(() => undefined);
    (backfillOnDemand as jest.Mock).mockResolvedValue({ success: false, reason: 'skip' });
    (insertAiServing as jest.Mock).mockResolvedValue({ success: false, reason: 'skip' });
    (gatherCandidates as jest.Mock).mockResolvedValue([]);
    (prisma.fatSecretFood.findUnique as jest.Mock).mockResolvedValue(null);
});

describe('Step 1a: fs_ early cache hits are nutrition-validated', () => {
    it('escapes an fs_ hit whose FatSecretFood panel is empty', async () => {
        (getValidatedMappingByNormalizedName as jest.Mock).mockResolvedValueOnce(fsCacheRow).mockResolvedValue(null);
        // The real shape of the 35 measured rows: the row exists, the panel is {}.
        (prisma.fatSecretFood.findUnique as jest.Mock).mockResolvedValue({ nutrientsPer100g: {} });

        const telemetry: MappingTelemetry = {};
        await mapIngredientWithFallback('1 bowl ten vegetable soup', {
            minConfidence: 0,
            skipFdc: true,
            telemetry,
        });

        // It must have LOOKED at FatSecretFood, keyed on the un-prefixed fsId...
        expect(prisma.fatSecretFood.findUnique).toHaveBeenCalledWith(
            expect.objectContaining({ where: { fsId: '69219858' } }),
        );
        // ...and it must NOT have gone hunting in AiGeneratedFood for an fs_ id,
        // which is what the old else-arm did on every fs_ hit. (Other call sites
        // legitimately query that table by ingredientName; only an id lookup with
        // an fs_-prefixed id is the bug.)
        expect(prisma.aiGeneratedFood.findUnique).not.toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'fs_69219858' } }),
        );
        // The whole point: the hit is refused, not served with null nutrition.
        expect(telemetry.cacheEscape).toBe('early:nutrition_invalid');
    });

    it('escapes an fs_ hit whose macros are invalid', async () => {
        (getValidatedMappingByNormalizedName as jest.Mock).mockResolvedValueOnce({ ...fsCacheRow, foodName: 'Chicken Breast' }).mockResolvedValue(null);
        // 314 kcal with zero protein AND zero carbs and little fat — the red-lentil
        // corruption shape hasNullOrInvalidMacros exists to catch.
        (prisma.fatSecretFood.findUnique as jest.Mock).mockResolvedValue({
            nutrientsPer100g: { calories: 314, protein: 0, carbs: 0, fat: 2.86 },
        });

        const telemetry: MappingTelemetry = {};
        await mapIngredientWithFallback('100 g chicken breast', {
            minConfidence: 0,
            skipFdc: true,
            telemetry,
        });

        expect(telemetry.cacheEscape).toBe('early:nutrition_invalid');
    });

    it('serves an fs_ hit whose panel is valid', async () => {
        (getValidatedMappingByNormalizedName as jest.Mock).mockResolvedValueOnce({ ...fsCacheRow, foodName: 'Granola Bar' }).mockResolvedValue(null);
        (prisma.fatSecretFood.findUnique as jest.Mock).mockResolvedValue({
            fsId: '69219858',
            name: 'Granola Bar',
            nutrientsPer100g: { calories: 400, protein: 33.33, carbs: 46.67, fat: 13.33 },
            fetchedAt: new Date(),
            servings: [{ servingId: 's1', description: '1 bar', grams: 40, isDefault: true }],
        });
        (getCachedFoodWithRelations as jest.Mock).mockResolvedValue({
            id: 'fs_69219858',
            displayName: 'Granola Bar',
            ingredientName: 'granola bar',
            caloriesPer100g: 400,
            proteinPer100g: 33.33,
            carbsPer100g: 46.67,
            fatPer100g: 13.33,
            servings: [{ id: 'srv-1', label: '1 bar', grams: 40 }],
        });

        const telemetry: MappingTelemetry = {};
        const result = await mapIngredientWithFallback('1 granola bar', {
            minConfidence: 0,
            skipFdc: true,
            telemetry,
        });

        // 535 of the 570 measured rows are in this state and must be unaffected.
        expect(telemetry.cacheEscape).toBeUndefined();
        expect(result && 'foodId' in result ? result.foodId : null).toBe('fs_69219858');
    });

    it('passes the cached food NAME to the validity check, so the sweetener exception applies', async () => {
        (getValidatedMappingByNormalizedName as jest.Mock).mockResolvedValueOnce({ ...fsCacheRow, foodId: 'fs_555', foodName: 'Stevia' }).mockResolvedValue(null);
        // Measured live row: 0 kcal against 50g carbs. Without the name this trips
        // the macro/calorie consistency check; with it, the sweetener exception holds.
        (prisma.fatSecretFood.findUnique as jest.Mock).mockResolvedValue({
            fsId: '555',
            name: 'Stevia',
            nutrientsPer100g: { calories: 0, protein: 0, carbs: 50, fat: 0 },
            fetchedAt: new Date(),
            servings: [{ servingId: 's1', description: '1 packet', grams: 1, isDefault: true }],
        });
        (getCachedFoodWithRelations as jest.Mock).mockResolvedValue({
            id: 'fs_555',
            displayName: 'Stevia',
            ingredientName: 'stevia',
            caloriesPer100g: 0,
            proteinPer100g: 0,
            carbsPer100g: 50,
            fatPer100g: 0,
            servings: [{ id: 'srv-s', label: '1 packet', grams: 1 }],
        });

        const telemetry: MappingTelemetry = {};
        await mapIngredientWithFallback('1 packet stevia', {
            minConfidence: 0,
            skipFdc: true,
            telemetry,
        });

        expect(telemetry.cacheEscape).toBeUndefined();
    });
});

describe('Step 1c: fs_ normalized cache hits are nutrition-validated', () => {
    it('escapes an fs_ normalized hit whose FatSecretFood panel is empty', async () => {
        // Early lookup misses; the Step 1c lookup hits.
        (getValidatedMappingByNormalizedName as jest.Mock)
            .mockResolvedValueOnce(null)
            .mockResolvedValue(fsCacheRow);
        (prisma.fatSecretFood.findUnique as jest.Mock).mockResolvedValue({ nutrientsPer100g: {} });

        const telemetry: MappingTelemetry = {};
        await mapIngredientWithFallback('ten vegetable soup', {
            minConfidence: 0,
            skipFdc: true,
            telemetry,
        });

        expect(prisma.fatSecretFood.findUnique).toHaveBeenCalledWith(
            expect.objectContaining({ where: { fsId: '69219858' } }),
        );
        expect(prisma.aiGeneratedFood.findUnique).not.toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'fs_69219858' } }),
        );
        expect(telemetry.cacheEscape).toBe('normalized:nutrition_invalid');
    });

    it('escapes an fs_ normalized hit when the FatSecretFood row is missing entirely', async () => {
        // Early lookup misses; the Step 1c lookup hits.
        (getValidatedMappingByNormalizedName as jest.Mock)
            .mockResolvedValueOnce(null)
            .mockResolvedValue(fsCacheRow);
        (prisma.fatSecretFood.findUnique as jest.Mock).mockResolvedValue(null);

        const telemetry: MappingTelemetry = {};
        await mapIngredientWithFallback('ten vegetable soup', {
            minConfidence: 0,
            skipFdc: true,
            telemetry,
        });

        expect(telemetry.cacheEscape).toBe('normalized:nutrition_invalid');
    });
});
