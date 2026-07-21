/**
 * PR D pt3 (B6 mapper side + telemetry split) — pipeline-level tests:
 *   - a normalized cache hit must NOT re-save itself (the resave is what let
 *     the escape→overwrite loop churn FoodMapping rows)
 *   - non-cache selection reasons still save, and the save key goes through
 *     deriveCacheKeyName (C1)
 *   - the former catch-all 'normalized:filter_mismatch' telemetry label is
 *     split into per-condition labels
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

jest.mock('../../db', () => ({
    prisma: {
        $queryRaw: jest.fn().mockResolvedValue([]),
        fdcFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        offFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
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
jest.mock('../validated-mapping-helpers');
jest.mock('../ai-synonym-generator');
jest.mock('../learned-synonyms');
jest.mock('../cache-search', () => {
    const actual = jest.requireActual('../cache-search');
    return {
        ...actual,
        getCachedFoodWithRelations: jest.fn(),
    };
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
    return {
        ...actual,
        gatherCandidates: jest.fn(),
    };
});

const lightCreamCheeseFood = {
    id: 'cc-1',
    displayName: 'Light Cream Cheese',
    ingredientName: 'light cream cheese',
    caloriesPer100g: 214,
    proteinPer100g: 8,
    carbsPer100g: 6,
    fatPer100g: 17.85,
    servings: [{ id: 'srv-1', label: '1 tbsp', grams: 14 }],
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
});

describe('normalized cache hit re-save skip (B6)', () => {
    it('serves the cached row without calling saveValidatedMapping', async () => {
        // Early lookup misses; the step-1c lookup hits.
        (getValidatedMappingByNormalizedName as jest.Mock)
            .mockResolvedValueOnce(null)
            .mockResolvedValue({
                foodId: 'cc-1',
                foodName: 'Light Cream Cheese',
                brandName: null,
                source: 'ai_generated',
                confidence: 0.9,
            });
        (getCachedFoodWithRelations as jest.Mock).mockResolvedValue(lightCreamCheeseFood);

        const result = await mapIngredientWithFallback('1 tbsp light cream cheese', {
            minConfidence: 0,
            skipFdc: true,
        });

        expect(result).not.toBeNull();
        expect(result && 'foodId' in result ? result.foodId : null).toBe('cc-1');
        // confidence 0.9 >= 0.85 would previously have re-saved the row — the
        // hit-resave skip must keep the cache write path silent.
        expect(saveValidatedMapping).not.toHaveBeenCalled();
    });

    it('still saves for non-cache selection reasons, keyed via deriveCacheKeyName', async () => {
        (gatherCandidates as jest.Mock).mockResolvedValue([
            { id: 'spin-1', source: 'ai_generated', name: 'Spinach', brandName: null, score: 0.9, foodType: 'Generic', rawData: {} },
        ]);
        (getCachedFoodWithRelations as jest.Mock).mockResolvedValue({
            id: 'spin-1',
            displayName: 'Spinach',
            ingredientName: 'spinach',
            caloriesPer100g: 23,
            proteinPer100g: 2.9,
            carbsPer100g: 3.6,
            fatPer100g: 0.4,
            servings: [{ id: 'srv-spin', label: '1 cup', grams: 30, volumeMl: 240 }],
        });

        const result = await mapIngredientWithFallback('1 cup spinach', {
            minConfidence: 0,
            skipFdc: true,
        });

        expect(result).not.toBeNull();
        expect(saveValidatedMapping).toHaveBeenCalledTimes(1);
        // C1: the save key is deriveCacheKeyName(normalizedName, parsed) — for
        // a discriminator-free line that's the canonicalized name unchanged.
        expect(saveValidatedMapping).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            expect.anything(),
            expect.objectContaining({ canonicalBase: 'spinach' }),
        );
    });
});

describe('cache-escape telemetry label split', () => {
    it('labels a modifier escape normalized:modifier_mismatch (was filter_mismatch)', async () => {
        (getValidatedMappingByNormalizedName as jest.Mock)
            .mockResolvedValueOnce(null)
            .mockResolvedValue({
                foodId: 'cc-full',
                foodName: 'Cream Cheese', // full-fat: fails the 'light' modifier check
                brandName: null,
                source: 'ai_generated',
                confidence: 0.9,
            });
        (gatherCandidates as jest.Mock).mockResolvedValue([
            { id: 'cc-1', source: 'ai_generated', name: 'Light Cream Cheese', brandName: null, score: 0.9, rawData: {} },
        ]);
        (getCachedFoodWithRelations as jest.Mock).mockResolvedValue(lightCreamCheeseFood);

        const telemetry: MappingTelemetry = {};
        const result = await mapIngredientWithFallback('1 tbsp light cream cheese', {
            minConfidence: 0,
            skipFdc: true,
            telemetry,
        });

        expect(telemetry.cacheEscape).toBe('normalized:modifier_mismatch');
        // The escape re-resolves to the correct (light) product.
        expect(result && 'foodName' in result ? result.foodName : '').toContain('Light');
    });
});
