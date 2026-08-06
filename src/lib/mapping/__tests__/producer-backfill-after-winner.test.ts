/**
 * Phase 1 stage 1c — CHARACTERIZATION, cluster 1: winner-then-backfill
 * (census V1, the SECOND requestAiNutrition site).
 *
 * Pins the dual-producer path a naive 1d "four mutually-exclusive producers"
 * orchestrator would delete:
 *
 *   Step 1c produces a WINNER (selectionReason 'normalized_cache_hit') whose
 *   every hydration attempt fails; `filtered` stays [] on the cache path, so
 *   the Step-5b guard (`!result && filtered.length === 0 &&
 *   selectionReason === 'normalized_cache_hit'`) matches and re-runs the FULL
 *   search machinery; when that re-search finds nothing, the `if (!result)`
 *   tail fires the second `requestAiNutrition` site — AFTER a winner existed —
 *   and on success `return aiMapped` exits DIRECTLY, bypassing
 *   `finalizeAndSaveResult()`: no save, no sanity caps, and the telemetry
 *   funnel facts stamped by the cache hit are never revised.
 *
 * These are characterization tests: they assert what the code DOES today.
 * A failure here after stage 1d is a behavior change, not a test bug.
 *
 * Mock seams are the house set (see map-ingredient-with-fallback.test.ts /
 * legacy-key-fallback.test.ts) plus the stage-1a seam: the mapper imports
 * hydrateAndSelectServing from './serving/hydration-lane', so mocking that
 * module intercepts ALL of the mapper's hydration call sites at once.
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
import { hydrateSingleCandidate } from '../hydrate-cache';
import { queueForDeferredHydration } from '../deferred-hydration';
import { insertAiServing } from '../ai-backfill';
import { gatherCandidates } from '../gather-candidates';
import { hydrateAndSelectServing } from '../serving/hydration-lane';
import { simpleRerank } from '../simple-rerank';
import { aiSimplifyIngredient } from '../ai-simplify';
import { requestAiNutrition, getAiServingGrams } from '../ai-nutrition-backfill';
import { AI_NUTRITION_BACKFILL_ENABLED } from '../config';

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
        // Every serving-store model ambiguous-unit-backfill touches must be
        // present — omission fails deep in the cascade mimicking a production
        // bug (the canonical suite's own header warning).
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
        userPortionOverride: { findUnique: jest.fn().mockResolvedValue(null) },
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
jest.mock('../hydrate-cache');
jest.mock('../deferred-hydration');
jest.mock('../ai-backfill', () => ({
    insertAiServing: jest.fn(),
    backfillWeightServing: jest.fn().mockResolvedValue({ success: false, reason: 'skip' }),
}));
jest.mock('../gather-candidates', () => {
    const actual = jest.requireActual('../gather-candidates');
    return { ...actual, gatherCandidates: jest.fn() };
});
// Stage-1a seam: one mock intercepts every mapper hydration call site.
jest.mock('../serving/hydration-lane', () => {
    const actual = jest.requireActual('../serving/hydration-lane');
    return { ...actual, hydrateAndSelectServing: jest.fn() };
});
jest.mock('../simple-rerank', () => {
    const actual = jest.requireActual('../simple-rerank');
    return { ...actual, simpleRerank: jest.fn() };
});
jest.mock('../ai-simplify');
// The Mac .env sets ENABLE_MAPPING_ANALYSIS=true; unmocked, every run writes a
// logs/mapping-analysis-*.json session file from inside jest. Bare automock —
// the analysis branches still execute, every sink becomes a jest.fn().
jest.mock('../mapping-logger');
// The gather-candidates requireActual pulls in the semantic-search stack;
// unstubbed, a run can load the real ONNX embedder. Same stub as the sibling
// suites.
jest.mock('../../search/query-embedding', () => ({
    SEMANTIC_SEARCH_ENABLED: false,
    CORPUS_POOLING: 'cls',
    warmupEmbedder: jest.fn(),
    embedQuery: jest.fn().mockResolvedValue(null),
}));
// LLM chokepoint: no test in this file may dial out (CI has no key; a dev
// machine does).
jest.mock('../../ai/structured-client', () => {
    const actual = jest.requireActual('../../ai/structured-client');
    return {
        ...actual,
        callStructuredLlm: jest.fn().mockResolvedValue({
            status: 'error',
            error: 'llm disabled in unit tests',
            provider: 'openrouter',
            model: 'none',
            durationMs: 0,
        }),
    };
});
// AI_NUTRITION_BACKFILL_ENABLED defaults TRUE — this mock is mandatory or the
// backfill tail hits the jest LLM blackhole as a confusing ECONNREFUSED.
jest.mock('../ai-nutrition-backfill', () => ({
    requestAiNutrition: jest.fn().mockResolvedValue({ status: 'error', reason: 'skip' }),
    extractBaseFoodContext: jest.fn().mockReturnValue(null),
    getAiServingGrams: jest.fn().mockResolvedValue(null),
    createAiNutritionBudget: (max: number) => ({ remaining: max, spent: 0 }),
}));

/** The Step-1c cache row. fdc_ prefix on purpose: the Step-1c validation arms
 * for fdc_ have no missing-nutrition safety net (deliberate, documented in the
 * mapper), so a null prisma.fdcFood.findUnique leaves the row servable and the
 * winner assignment fires. The numeric part is deliberately synthetic —
 * 168917 would collide with the real FDC 168917 "Quinoa, cooked" documented
 * elsewhere. */
const CACHE_ROW = {
    foodId: 'fdc_999999901',
    foodName: 'table salt',
    brandName: null,
    source: 'fdc',
    confidence: 0.9,
    validatedBy: 'ai',
};

/** Success shape copied from AiNutritionResult (ai-nutrition-backfill.ts). */
const AI_SUCCESS = {
    status: 'success' as const,
    foodId: 'ai-table-salt',
    displayName: 'Table Salt',
    caloriesPer100g: 200,
    proteinPer100g: 10,
    carbsPer100g: 20,
    fatPer100g: 5,
    fiberPer100g: 0,
    sugarPer100g: 0,
    sodiumMgPer100g: 38000,
    saturatedFatPer100g: 0,
    cholesterolMgPer100g: 0,
    confidence: 0.85,
    notes: '',
    model: 'openai/gpt-4o-mini',
    cached: false,
};

const LINE = '1 serving table salt';

beforeEach(() => {
    jest.clearAllMocks();
    (aiNormalizeIngredient as jest.Mock).mockResolvedValue({ status: 'error', reason: 'skip' });
    (getValidatedMapping as jest.Mock).mockResolvedValue(null);
    // The row is returned for EVERY lookup key. Current behavior with that
    // setup: the EARLY cache check also hits, its hydration fails and falls
    // through (labelled 'early:hydration_failed', deliberately NOT a
    // readEscapes forfeit), and Step 1c then hits again and assigns `winner`.
    (getValidatedMappingByNormalizedName as jest.Mock).mockResolvedValue(CACHE_ROW);
    (getAiNormalizeCache as jest.Mock).mockResolvedValue(null);
    (saveValidatedMapping as jest.Mock).mockResolvedValue(undefined);
    (findCanonicalName as jest.Mock).mockResolvedValue(null);
    (getKnownSynonyms as jest.Mock).mockReturnValue([]);
    (saveSynonyms as jest.Mock).mockResolvedValue(undefined);
    (getLearnedSynonyms as jest.Mock).mockResolvedValue([]);
    (extractTermsFromIngredient as jest.Mock).mockReturnValue([]);
    (hydrateSingleCandidate as jest.Mock).mockResolvedValue(true);
    (queueForDeferredHydration as jest.Mock).mockImplementation(() => undefined);
    (insertAiServing as jest.Mock).mockResolvedValue({ success: false, reason: 'skip' });
    // Every hydration attempt fails — this is the cluster's driving condition.
    (hydrateAndSelectServing as jest.Mock).mockResolvedValue(null);
    // Quick-gate gather AND the Step-5b re-search both find nothing.
    (gatherCandidates as jest.Mock).mockResolvedValue([]);
});

describe('cluster 1 — cache winner, hydration failure, AI-nutrition backfill (site 2)', () => {
    it('serves the AI-generated result via direct return, exactly as built at the aiMapped site', async () => {
        // Loud precondition: the whole cluster rides on the config default.
        // A silent env flip (AI_NUTRITION_BACKFILL_ENABLED=false) would
        // otherwise fail these tests confusingly deep in the pipeline.
        expect(AI_NUTRITION_BACKFILL_ENABLED).toBe(true);
        (requestAiNutrition as jest.Mock).mockResolvedValue(AI_SUCCESS);
        (getAiServingGrams as jest.Mock).mockResolvedValue(null);

        const telemetry: MappingTelemetry = {};
        const result = await mapIngredientWithFallback(LINE, {
            minConfidence: 0,
            skipFdc: true,
            telemetry,
        });

        // (a) The returned result is the AI-generated one, field-for-field as
        // the second backfill site constructs it (getAiServingGrams null ⇒
        // 100 g flat default, scale 1).
        expect(result).toEqual({
            source: 'ai_generated',
            foodId: 'ai-table-salt',
            foodName: 'Table Salt',
            brandName: null,
            servingId: null,
            servingDescription: '1 serving',   // `${parsedQty} ${parsedUnit}`
            grams: 100,
            kcal: 200,
            protein: 10,
            carbs: 20,
            fat: 5,
            confidence: 0.85 * 0.8,            // aiResult.confidence * 0.8
            quality: 'medium',                 // aiResult.confidence >= 0.7
            rawLine: LINE,
            servingTier: 'flat_100g_default',  // servingResult?.grams == null
        });

        // (b) The direct return bypasses finalizeAndSaveResult: no save, ever.
        expect(saveValidatedMapping).not.toHaveBeenCalled();
        // Direct finalize-bypass witness: getKnownSynonyms's ONLY mapper call
        // site is inside finalizeAndSaveResult, so "never called" proves the
        // whole post-selection block was skipped — not merely the save.
        expect(getKnownSynonyms).not.toHaveBeenCalled();

        // (c) requestAiNutrition fired even though a WINNER existed. The winner's
        // existence is witnessed by the hydration attempts on the cache row:
        // one at the early-cache hit (falls through on failure) and one at
        // Step 5 on the Step-1c winner. Site 1 (the `if (!winner)` copy) is
        // unreachable with a winner present, so this call is site 2.
        expect(requestAiNutrition).toHaveBeenCalledTimes(1);
        expect((requestAiNutrition as jest.Mock).mock.calls[0][0]).toContain('salt');
        expect(hydrateAndSelectServing).toHaveBeenCalledTimes(2);
        for (const call of (hydrateAndSelectServing as jest.Mock).mock.calls) {
            expect(call[0].id).toBe('fdc_999999901');
        }

        // Step 5b DID re-run the full search machinery before the backfill:
        // gather call #1 is the normalize-gate quick pass (skipOff: true),
        // call #2 is the 5b re-search (no skipOff).
        expect(gatherCandidates).toHaveBeenCalledTimes(2);
        expect((gatherCandidates as jest.Mock).mock.calls[0][3].skipOff).toBe(true);
        expect((gatherCandidates as jest.Mock).mock.calls[1][3].skipOff).toBeUndefined();
        // ...and an empty re-search never reaches the reranker.
        expect(simpleRerank).not.toHaveBeenCalled();

        // Negative independence: a present winner keeps Step 2b closed.
        expect(aiSimplifyIngredient).not.toHaveBeenCalled();

        // The direct return never revises the telemetry stamped by the cache
        // hit: the line reads as a normalized cache hit in the funnel even
        // though the AI backfill actually served it (current behavior).
        expect(telemetry.cacheHit).toBe('normalized');
        expect(telemetry.funnelStage).toBe('cache_hit');
        expect(telemetry.cacheEscape).toBe('early:hydration_failed');
    });

    it('scales by the AI serving grams and stamps ai_generated_serving when getAiServingGrams resolves', async () => {
        expect(AI_NUTRITION_BACKFILL_ENABLED).toBe(true);
        (requestAiNutrition as jest.Mock).mockResolvedValue(AI_SUCCESS);
        (getAiServingGrams as jest.Mock).mockResolvedValue({ grams: 30, servingLabel: '1 scoop' });

        const result = await mapIngredientWithFallback(LINE, { minConfidence: 0, skipFdc: true });

        expect(getAiServingGrams).toHaveBeenCalledWith('ai-table-salt', 'serving', 1);
        expect(result).toMatchObject({
            source: 'ai_generated',
            foodId: 'ai-table-salt',
            servingDescription: '1 scoop',     // servingResult.servingLabel wins
            grams: 30,
            kcal: 60,                          // 200 * (30/100)
            protein: 3,
            carbs: 6,
            fat: 1.5,
            servingTier: 'ai_generated_serving',
        });
        expect(saveValidatedMapping).not.toHaveBeenCalled();
    });

    it('serves an absurd AI serving grams UNCAPPED — the direct return has no sanity caps', async () => {
        expect(AI_NUTRITION_BACKFILL_ENABLED).toBe(true);
        (requestAiNutrition as jest.Mock).mockResolvedValue(AI_SUCCESS);
        // 50000 g exceeds BOTH finalize caps (MAX_REASONABLE_GRAMS = 10000;
        // the scaled kcal, 200 * 500 = 100000, exceeds MAX_REASONABLE_KCAL =
        // 50000). Those caps live inside finalizeAndSaveResult, which this
        // exit bypasses — so the result is served as-is (current behavior).
        (getAiServingGrams as jest.Mock).mockResolvedValue({ grams: 50000, servingLabel: '1 vat' });

        const result = await mapIngredientWithFallback(LINE, { minConfidence: 0, skipFdc: true });

        expect(result).not.toBeNull();
        expect(result).toMatchObject({
            source: 'ai_generated',
            foodId: 'ai-table-salt',
            grams: 50000,
            kcal: 100000,                      // 200 * (50000/100) — no cap
            protein: 5000,
            servingTier: 'ai_generated_serving',
        });
        expect(saveValidatedMapping).not.toHaveBeenCalled();
        expect(getKnownSynonyms).not.toHaveBeenCalled();
    });

    it('returns null when the backfill fails — the post-hydration-failure null return', async () => {
        expect(AI_NUTRITION_BACKFILL_ENABLED).toBe(true);
        (requestAiNutrition as jest.Mock).mockResolvedValue({
            // Real failure shape/reason from requestAiNutrition itself.
            status: 'error',
            reason: 'nutrition_budget_exhausted',
        });

        const telemetry: MappingTelemetry = {};
        const result = await mapIngredientWithFallback(LINE, {
            minConfidence: 0,
            skipFdc: true,
            telemetry,
        });

        expect(result).toBeNull();
        expect(requestAiNutrition).toHaveBeenCalledTimes(1);
        expect(getAiServingGrams).not.toHaveBeenCalled();
        expect(saveValidatedMapping).not.toHaveBeenCalled();
        // Same telemetry shape as the success arm: the null return does not
        // revise the cache-hit funnel facts either (current behavior).
        expect(telemetry.cacheHit).toBe('normalized');
        expect(telemetry.funnelStage).toBe('cache_hit');
    });
});
