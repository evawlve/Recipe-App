/**
 * Legacy cache-key fallback (Track 1c backward compatibility) — pipeline tests.
 *
 * Every FoodMapping row written before Track 1c was keyed by the OLD read
 * scheme: deriveCacheKeyName output, no brand prefix, no dup-token collapse.
 * The symmetric key can differ (brand-prefixed, or collapsed), which would
 * silently orphan previously-working rows. Both lookup call-sites therefore
 * fall back to ONE extra point-read on the legacy key when the symmetric-key
 * lookup misses — EXCEPT when the legacy key is malformed (adjacent duplicate
 * tokens): those are the dead "oiko oiko"/"oat rolled rolled" zombie rows the
 * cleanup script deletes, and the fallback must never resurrect them.
 *
 * Covered here, one case per read site:
 *   1. EARLY lookup site: branded query (options.brand, decisive multi-word)
 *      whose legacy-keyed row (no brand prefix) is still found and served.
 *   2. STEP-1C lookup site: AI normalize strips a decisive single-word brand
 *      from the name; the legacy (unprefixed) row is found and served.
 *   3. Zombie guard: a dup-token legacy key is NEVER looked up.
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
// The zombie-guard test runs the pipeline to a full miss; the AI nutrition
// backfill tail must not fire a real LLM call from inside jest.
jest.mock('../ai-nutrition-backfill', () => ({
    requestAiNutrition: jest.fn().mockResolvedValue({ status: 'error', reason: 'skip' }),
    extractBaseFoodContext: jest.fn().mockReturnValue(null),
    getAiServingGrams: jest.fn().mockResolvedValue(null),
}));

function lookupKeys(): string[] {
    return (getValidatedMappingByNormalizedName as jest.Mock).mock.calls.map(c => c[0]);
}

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

describe('legacy-key fallback at the EARLY lookup site', () => {
    it('finds a legacy-keyed (unprefixed) row for a branded query and serves it', async () => {
        // options.brand "optimum nutrition" is decisive (multi-word), so the
        // symmetric key is brand-prefixed: "nutrition optimum protein shake".
        // The pre-Track-1c row lives under the legacy read key "protein shake".
        const legacyRow = {
            foodId: 'ps-1',
            foodName: 'Optimum Nutrition Protein Shake',
            brandName: 'Optimum Nutrition',
            source: 'ai_generated',
            confidence: 0.9,
            validatedBy: 'ai',
        };
        (getValidatedMappingByNormalizedName as jest.Mock).mockImplementation(
            async (key: string) => (key === 'protein shake' ? legacyRow : null),
        );
        (getCachedFoodWithRelations as jest.Mock).mockResolvedValue({
            id: 'ps-1',
            displayName: 'Optimum Nutrition Protein Shake',
            ingredientName: 'protein shake',
            caloriesPer100g: 44,
            proteinPer100g: 10,
            carbsPer100g: 1.5,
            fatPer100g: 0.4,
            servings: [{ id: 'srv-ps', label: '1 cup', grams: 240, volumeMl: 240 }],
        });

        const telemetry: MappingTelemetry = {};
        const result = await mapIngredientWithFallback('1 cup protein shake', {
            minConfidence: 0,
            skipFdc: true,
            brand: 'optimum nutrition',
            telemetry,
        });

        // Symmetric (brand-prefixed) key first, legacy key on miss — in order.
        expect(lookupKeys().slice(0, 2)).toEqual([
            'nutrition optimum protein shake',
            'protein shake',
        ]);
        // The legacy row is served as an early cache hit.
        expect(result).not.toBeNull();
        expect(result && 'foodId' in result ? result.foodId : null).toBe('ps-1');
        expect(telemetry.cacheHit).toBe('early');
        // Cache hits must not re-save (B6) and must not need the LLM.
        expect(saveValidatedMapping).not.toHaveBeenCalled();
        expect(aiNormalizeIngredient).not.toHaveBeenCalled();
    });
});

describe('legacy-key fallback at the STEP-1C lookup site', () => {
    it('finds a legacy-keyed row after AI normalize strips a decisive brand from the name', async () => {
        // "ghost whey": decisive single-word brand (product-form adjacency).
        // AI normalize rewrites the name to "whey protein" (brand stripped),
        // so the symmetric step-1c key is "ghost protein whey" while the
        // pre-Track-1c row lives under the legacy key "protein whey".
        const legacyRow = {
            foodId: 'gw-1',
            foodName: 'Ghost Whey Protein',
            brandName: 'Ghost',
            source: 'ai_generated',
            confidence: 0.9,
            validatedBy: 'ai',
        };
        (getValidatedMappingByNormalizedName as jest.Mock).mockImplementation(
            async (key: string) => (key === 'protein whey' ? legacyRow : null),
        );
        (aiNormalizeIngredient as jest.Mock).mockResolvedValue({
            status: 'success',
            normalizedName: 'whey protein',
            synonyms: [],
            isBranded: true,
        });
        (getCachedFoodWithRelations as jest.Mock).mockResolvedValue({
            id: 'gw-1',
            displayName: 'Ghost Whey Protein',
            ingredientName: 'whey protein',
            caloriesPer100g: 370,
            proteinPer100g: 74,
            carbsPer100g: 11,
            fatPer100g: 5,
            servings: [{ id: 'srv-gw', label: '1 cup', grams: 30, volumeMl: 240 }],
        });

        const result = await mapIngredientWithFallback('1 cup ghost whey', {
            minConfidence: 0,
            skipFdc: true,
        });

        const keys = lookupKeys();
        // Early site: symmetric === legacy ("ghost whey", brand token already
        // in the name) → exactly one call, no fallback duplicate.
        expect(keys[0]).toBe('ghost whey');
        // Step-1c site: symmetric (prefixed) key first, then the legacy key.
        expect(keys).toContain('ghost protein whey');
        expect(keys).toContain('protein whey');
        expect(keys.indexOf('ghost protein whey')).toBeLessThan(keys.indexOf('protein whey'));

        // The legacy row is served as the step-1c hit and not re-saved (B6).
        expect(result).not.toBeNull();
        expect(result && 'foodId' in result ? result.foodId : null).toBe('gw-1');
        expect(saveValidatedMapping).not.toHaveBeenCalled();
    });
});

describe('zombie-row guard: malformed legacy keys are never looked up', () => {
    it('skips the fallback when the legacy key has adjacent duplicate tokens', async () => {
        // AI normalize flaps to a doubled-modifier name. The symmetric key
        // collapses the dup ("oat rolled"); the legacy key would be the dup
        // form "oat rolled rolled" — exactly the malformed class the cleanup
        // script deletes. The fallback must NOT resurrect such rows.
        (aiNormalizeIngredient as jest.Mock).mockResolvedValue({
            status: 'success',
            normalizedName: 'rolled rolled oats',
            synonyms: [],
            isBranded: false,
        });

        await mapIngredientWithFallback('1 cup oatmeal', {
            minConfidence: 0,
            skipFdc: true,
        });

        const keys = lookupKeys();
        // The collapsed symmetric key IS looked up...
        expect(keys).toContain('oat rolled');
        // ...but the malformed legacy key never is.
        expect(keys).not.toContain('oat rolled rolled');
        expect(keys.every(k => k !== 'oat rolled rolled')).toBe(true);
    });
});
