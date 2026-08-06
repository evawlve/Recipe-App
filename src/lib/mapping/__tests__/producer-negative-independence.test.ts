/**
 * Phase 1 stage 1c — cluster 7: producer NEGATIVE-INDEPENDENCE characterization.
 *
 * Pins, via mock call COUNTS, that each result producer runs WITHOUT invoking the
 * machinery of the others (census §2.7 in
 * sync-docs/reports/2026-08-06_phase-1-stage-1c-handoff.md). These are
 * characterization tests: they assert what the code DOES today, so the stage-1d
 * extraction can be proven behavior-preserving. A failure after 1d means a
 * producer boundary moved — not that this file is wrong.
 *
 * Two measured facts pinned here that correct the naive model:
 *  - "cache hit ⇒ gatherCandidates never called" is FALSE as stated: the
 *    normalize-gate's quick gather (quickGatherOptions, `skipOff: true`) goes
 *    through the SAME gatherCandidates import and runs in the preamble BEFORE
 *    the Step-1c lookup. The true invariant is: exactly ONE call, the quick-gate
 *    one — the full Step-2 gather (no skipOff flag) never runs.
 *  - The AI-nutrition backfill (site 1, the `if (!winner)` block) is NOT gated
 *    by `_skipFallback`. `_skipFallback` gates only Step 2b (dietary-prefix +
 *    AI-simplify recursions); a recursive frame with an empty pool still spends
 *    the backfill. Pinned in the last test.
 *
 * Mock preamble copied from map-hit-resave-skip.test.ts (partial
 * validated-mapping-helpers mock keeps the read-time-trust predicates real) with
 * the full prisma serving-store model list from
 * map-ingredient-with-fallback.test.ts (omitting aiGeneratedServing/fdcServing/
 * offServing/userPortionOverride fails deep in the cascade mimicking a
 * production bug). New stage-1a seam: mocking '../serving/hydration-lane'
 * intercepts hydrateAndSelectServing at all mapper call sites, so hydration
 * success/failure is controlled per candidate without touching the DB fixtures.
 */

import { mapIngredientWithFallback, type MappingTelemetry } from '../map-ingredient-with-fallback';
import { AI_NUTRITION_BACKFILL_ENABLED } from '../config';
import { prisma } from '../../db';
import { aiNormalizeIngredient } from '../ai-normalize';
import {
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
import { aiSimplifyIngredient } from '../ai-simplify';
import { requestAiNutrition, getAiServingGrams } from '../ai-nutrition-backfill';
import { hydrateAndSelectServing } from '../serving/hydration-lane';

jest.mock('../../db', () => ({
    prisma: {
        $queryRaw: jest.fn().mockResolvedValue([]),
        fdcFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        offFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        fatSecretFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        aiGeneratedFood: {
            findMany: jest.fn().mockResolvedValue([]),
            findFirst: jest.fn().mockResolvedValue(null),
            findUnique: jest.fn().mockResolvedValue(null),
        },
        foodMapping: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
        ingredient: { findMany: jest.fn().mockResolvedValue([]) },
        // Serving stores reached via the hydration/backfill machinery — the
        // canonical test's header warns that omitting these fails deep in the
        // cascade mimicking a production bug. Kept even though this suite mocks
        // hydrateAndSelectServing: requireActual loads the real lane module.
        aiGeneratedServing: {
            findUnique: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([]),
            upsert: jest.fn().mockResolvedValue(null),
        },
        fdcServing: {
            findUnique: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([]),
            upsert: jest.fn().mockResolvedValue(null),
        },
        offServing: {
            findUnique: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([]),
            upsert: jest.fn().mockResolvedValue(null),
        },
        userPortionOverride: {
            findUnique: jest.fn().mockResolvedValue(null),
        },
    },
}));

jest.mock('../ai-normalize');
// Partial mock: db-backed cache reads/writes stubbed; the pure read-time-trust
// predicates (isTrustedHumanRow / isHumanTrustSkippableEscape) and
// targetKeyOfFoodId stay REAL — the mapper's cache layers depend on them.
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
// Step 2b-ii reaches ai-simplify via a dynamic `await import()`; jest.mock
// still intercepts it. Auto-mock + explicit null resolution below.
jest.mock('../ai-simplify');
// AI_NUTRITION_BACKFILL_ENABLED defaults TRUE, so the backfill module MUST be
// mocked or site-1 calls hit the jest LLM blackhole as ECONNREFUSED.
// createAiNutritionBudget / extractBaseFoodContext stay real (pure; the budget
// minting in the options destructure needs the real one).
jest.mock('../ai-nutrition-backfill', () => {
    const actual = jest.requireActual('../ai-nutrition-backfill');
    return {
        ...actual,
        requestAiNutrition: jest.fn(),
        getAiServingGrams: jest.fn(),
    };
});
// Stage-1a seam: intercepts ALL mapper call sites of hydrateAndSelectServing.
jest.mock('../serving/hydration-lane', () => {
    const actual = jest.requireActual('../serving/hydration-lane');
    return {
        ...actual,
        hydrateAndSelectServing: jest.fn(),
    };
});
// The Mac .env sets ENABLE_MAPPING_ANALYSIS=true; unmocked, every run writes a
// logs/mapping-analysis-*.json session file from inside jest. Automock stubs
// the whole sink (producer-cache-failure-research.test.ts proves that suffices).
jest.mock('../mapping-logger');
// Unmocked, the real module fires an ONNX warmupEmbedder() whose promise
// dangles past suite end (embedding.model_loaded logged after the summary).
jest.mock('../../search/query-embedding', () => ({
    SEMANTIC_SEARCH_ENABLED: false,
    CORPUS_POOLING: 'cls',
    warmupEmbedder: jest.fn(),
    embedQuery: jest.fn().mockResolvedValue(null),
}));

/** A hydrated result as the (mocked) hydration lane would return it.
 *  servingTier deliberately omitted — it is optional and inventing tier
 *  strings is forbidden (the #249 lesson). */
function hydrated(foodId: string, foodName: string, overrides: Record<string, unknown> = {}) {
    return {
        source: 'ai_generated' as const,
        foodId,
        foodName,
        brandName: null,
        servingId: 'srv-1',
        servingDescription: '1 tbsp',
        grams: 14,
        kcal: 30,
        protein: 1.1,
        carbs: 0.8,
        fat: 2.5,
        confidence: 0.9,
        quality: 'high' as const,
        rawLine: '',
        ...overrides,
    };
}

const AI_NUTRITION_SUCCESS = {
    status: 'success' as const,
    foodId: 'ai_galaxy_1',
    displayName: 'Galaxy Spice Mix',
    caloriesPer100g: 250,
    proteinPer100g: 10,
    carbsPer100g: 50,
    fatPer100g: 2,
    fiberPer100g: 5,
    sugarPer100g: 3,
    sodiumMgPer100g: 100,
    saturatedFatPer100g: 0.5,
    cholesterolMgPer100g: 0,
    confidence: 0.9,
    notes: '',
    model: 'test-model',
    cached: false,
};

beforeEach(() => {
    jest.clearAllMocks();
    (aiNormalizeIngredient as jest.Mock).mockResolvedValue({ status: 'error', reason: 'skip' });
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
    (aiSimplifyIngredient as jest.Mock).mockResolvedValue(null);
    (requestAiNutrition as jest.Mock).mockResolvedValue({ status: 'error', reason: 'skip' });
    (getAiServingGrams as jest.Mock).mockResolvedValue(null);
    (hydrateAndSelectServing as jest.Mock).mockResolvedValue(null);
});

describe('producer negative independence (stage 1c cluster 7)', () => {
    it('(a) servable Step-1c cache row: only the quick-gate gather runs, no AI, no save', async () => {
        // Early (pre-AI-normalize) lookup misses; the Step-1c lookup hits.
        // The fixture id is fs_-PREFIXED so the hit traverses the Step-1c
        // DB-backed validation arm (the fatSecretFood.findUnique panel read +
        // hasNullOrInvalidMacros) instead of the unrecognised-prefix
        // instrument arm, which skips every validation and matches no real
        // row shape (the lookup helper's no-target-column arm returns null).
        (getValidatedMappingByNormalizedName as jest.Mock)
            .mockResolvedValueOnce(null)
            .mockResolvedValue({
                foodId: 'fs_9999901',
                foodName: 'Light Cream Cheese',
                brandName: null,
                source: 'fatsecret',
                confidence: 0.9,
            });
        // Healthy panel: non-null macros, Atwater-consistent (4·7.85 + 4·8.13
        // + 9·15.28 ≈ 201), so hasNullOrInvalidMacros passes and the
        // missing-nutrition safety net does not trip.
        (prisma.fatSecretFood.findUnique as jest.Mock).mockResolvedValueOnce({
            nutrientsPer100g: { calories: 201, protein: 7.85, carbohydrate: 8.13, fat: 15.28 },
            servings: [],
        });
        (hydrateAndSelectServing as jest.Mock).mockResolvedValue(
            hydrated('fs_9999901', 'Light Cream Cheese', {
                source: 'fatsecret',
                rawLine: '1 tbsp light cream cheese',
            }));

        const telemetry: MappingTelemetry = {};
        const result = await mapIngredientWithFallback('1 tbsp light cream cheese', {
            minConfidence: 0,
            skipFdc: true,
            telemetry,
        });

        expect(result && 'foodId' in result ? result.foodId : null).toBe('fs_9999901');
        expect(telemetry.cacheHit).toBe('normalized');

        // Witness that the DB-backed validation arm actually ran: the fs_ arm's
        // panel read, keyed on the stripped fsId.
        expect(prisma.fatSecretFood.findUnique).toHaveBeenCalledTimes(1);
        expect((prisma.fatSecretFood.findUnique as jest.Mock).mock.calls[0][0].where)
            .toEqual({ fsId: '9999901' });

        // CURRENT BEHAVIOR (not the naive "0 calls"): the normalize-gate's
        // quick gather shares the gatherCandidates import and runs in the
        // preamble BEFORE the Step-1c lookup. Exactly one call, identified as
        // the quick-gate pass by its skipOff flag; the full Step-2 gather
        // (whose options carry no skipOff) never runs.
        expect(gatherCandidates).toHaveBeenCalledTimes(1);
        expect((gatherCandidates as jest.Mock).mock.calls[0][3]).toMatchObject({ skipOff: true });

        // The cache winner is hydrated exactly once (Step 5), on the cached id.
        expect(hydrateAndSelectServing).toHaveBeenCalledTimes(1);
        expect((hydrateAndSelectServing as jest.Mock).mock.calls[0][0].id).toBe('fs_9999901');

        // Negative independence: the other producers' machinery never runs.
        expect(aiSimplifyIngredient).not.toHaveBeenCalled();
        expect(requestAiNutrition).not.toHaveBeenCalled();
        // And the resave-skip: 'normalized_cache_hit' must not re-save itself,
        // even at confidence 0.9 >= the 0.85 admission gate.
        expect(saveValidatedMapping).not.toHaveBeenCalled();
    });

    it('(b) rerank win: saves exactly once, no simplify, no nutrition backfill', async () => {
        (gatherCandidates as jest.Mock).mockResolvedValue([
            { id: 'spin-1', source: 'ai_generated', name: 'Spinach', brandName: null, score: 0.9, foodType: 'Generic', rawData: {} },
        ]);
        (hydrateAndSelectServing as jest.Mock).mockResolvedValue(
            hydrated('spin-1', 'Spinach', {
                servingId: 'srv-spin',
                servingDescription: '1 cup',
                grams: 30,
                kcal: 6.9,
                protein: 0.87,
                carbs: 1.08,
                fat: 0.12,
                confidence: 0.98,
                rawLine: '1 cup spinach',
            }));

        const result = await mapIngredientWithFallback('1 cup spinach', {
            minConfidence: 0,
            skipFdc: true,
        });

        expect(result && 'foodId' in result ? result.foodId : null).toBe('spin-1');

        // Both the quick-gate pass and the full Step-2 gather run on a cache
        // miss: two calls, quick one first (skipOff true), full one without it.
        expect(gatherCandidates).toHaveBeenCalledTimes(2);
        expect((gatherCandidates as jest.Mock).mock.calls[0][3]).toMatchObject({ skipOff: true });
        expect((gatherCandidates as jest.Mock).mock.calls[1][3].skipOff).toBeUndefined();

        // The rerank winner is hydrated exactly once.
        expect(hydrateAndSelectServing).toHaveBeenCalledTimes(1);
        expect((hydrateAndSelectServing as jest.Mock).mock.calls[0][0].id).toBe('spin-1');

        // Negative independence + the ONE save (a search-produced result flows
        // through finalizeAndSaveResult and Step 6).
        expect(aiSimplifyIngredient).not.toHaveBeenCalled();
        expect(requestAiNutrition).not.toHaveBeenCalled();
        expect(saveValidatedMapping).toHaveBeenCalledTimes(1);
    });

    it('(c) backfill serve (site 1): empty pool + null simplify -> AI nutrition, direct return, NO save', async () => {
        // Loud precondition: the site-1 backfill this test pins is gated on
        // this flag (default TRUE via getFlag). If an env flips it off, fail
        // HERE, not with an opaque "0 calls" downstream.
        expect(AI_NUTRITION_BACKFILL_ENABLED).toBe(true);

        // Cache misses everywhere, gather returns nothing (both passes), the
        // AI-simplify fallback declines. _skipFallback is deliberately ABSENT
        // so Step 2b runs — that is what proves the simplify was CONSULTED
        // (1 call) before the backfill served.
        (requestAiNutrition as jest.Mock).mockResolvedValue(AI_NUTRITION_SUCCESS);
        (getAiServingGrams as jest.Mock).mockResolvedValue({ grams: 30, servingLabel: '2 tbsp' });

        const result = await mapIngredientWithFallback('2 tbsp galaxy spice mix', {
            minConfidence: 0,
            skipFdc: true,
        });

        expect(result && 'foodId' in result ? result.foodId : null).toBe('ai_galaxy_1');
        expect(result && 'source' in result ? result.source : null).toBe('ai_generated');
        // Billed off the mocked AI serving: 30 g at 250 kcal/100g, confidence
        // penalized *0.8, and the REAL tier string the site stamps.
        expect(result && 'grams' in result ? result.grams : null).toBe(30);
        expect(result && 'kcal' in result ? result.kcal : null).toBeCloseTo(75);
        expect(result && 'confidence' in result ? result.confidence : null).toBeCloseTo(0.72);
        expect(result && 'servingTier' in result ? result.servingTier : null).toBe('ai_generated_serving');

        // The fallback chain was consulted and declined...
        expect(aiSimplifyIngredient).toHaveBeenCalledTimes(1);
        // ...then site 1 fired exactly once. Site 2 is unreachable here — it
        // needs a winner, and the sharp witness that none existed is that the
        // hydration lane was never entered.
        expect(requestAiNutrition).toHaveBeenCalledTimes(1);
        expect(hydrateAndSelectServing).not.toHaveBeenCalled();
        // Direct return at the site: finalizeAndSaveResult/Step 6 never runs.
        expect(saveValidatedMapping).not.toHaveBeenCalled();
        // Quick-gate + full gather both ran and found nothing.
        expect(gatherCandidates).toHaveBeenCalledTimes(2);
    });

    it('(d) _skipFallback gates Step 2b but NOT the site-1 backfill', async () => {
        // Loud precondition — same rationale as test (c).
        expect(AI_NUTRITION_BACKFILL_ENABLED).toBe(true);

        // Census finding pinned as behavior: `shouldTryFallback && !_skipFallback`
        // guards only the dietary-prefix and AI-simplify recursions; the
        // `if (!winner)` backfill block is gated solely on
        // AI_NUTRITION_BACKFILL_ENABLED. A recursive frame with an empty pool
        // therefore still spends the nutrition backfill.
        (requestAiNutrition as jest.Mock).mockResolvedValue(AI_NUTRITION_SUCCESS);
        (getAiServingGrams as jest.Mock).mockResolvedValue({ grams: 30, servingLabel: '2 tbsp' });

        const result = await mapIngredientWithFallback('2 tbsp galaxy spice mix', {
            minConfidence: 0,
            skipFdc: true,
            _skipFallback: true,
        });

        expect(result && 'foodId' in result ? result.foodId : null).toBe('ai_galaxy_1');
        expect(aiSimplifyIngredient).not.toHaveBeenCalled();
        expect(requestAiNutrition).toHaveBeenCalledTimes(1);
        expect(saveValidatedMapping).not.toHaveBeenCalled();
    });
});
