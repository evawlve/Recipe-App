/**
 * Mapper-level pin for the cached-estimate guard (C6970 s400, 2026-10-30): on the
 * normalize-gate SKIP path, mapIngredientWithFallback() replays an AiNormalizeCache
 * row. When the line is an explicit-cooked grain line and the row's estimate is a
 * DRY panel (>= 280 kcal/100 g), the estimate is NOT adopted — so simpleRerank()
 * receives no estimate and the save gets no expectedNutrition — while the row's
 * canonicalBase is still replayed (identity is state-independent; the panel is not).
 *
 * The row is the measured poison shape: key `rolled oats`, minted by the bare line
 * `oatmeal`, cookingModifier NULL, 389 kcal @0.95 (s395 Q1). Candidates are
 * fatsecret-sourced so the FDC fallback estimate cannot refill the slot.
 *
 * Mock preamble copied from producer-normalized-name-frozen.test.ts (simpleRerank
 * stubbed to name a winner so the run reaches the save).
 */

const mockHydrate = jest.fn();
const mockSimplify = jest.fn();

// Generic prisma stub: every model answers "nothing found" for any verb.
// (House pattern from abstention-confidence.test.ts — enumerating models by
// hand has previously made a sibling file assert nothing.)
jest.mock('../../db', () => {
    const emptyFor = (verb: string) =>
        jest.fn().mockResolvedValue(verb.startsWith('findMany') ? [] : null);
    const model = new Proxy({}, { get: (_t, verb: string) => emptyFor(verb) });
    return { prisma: new Proxy({}, { get: () => model }) };
});

jest.mock('../ai-normalize');
jest.mock('../normalize-gate', () => {
    const actual = jest.requireActual('../normalize-gate');
    return { ...actual, shouldNormalizeLlm: jest.fn() };
});
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
jest.mock('../simple-rerank', () => {
    const actual = jest.requireActual('../simple-rerank');
    return { ...actual, simpleRerank: jest.fn() };
});
// Stage-1a seam: ALL 10 mapper call sites route through this import.
jest.mock('../serving/hydration-lane', () => {
    const actual = jest.requireActual('../serving/hydration-lane');
    return { ...actual, hydrateAndSelectServing: (...a: unknown[]) => mockHydrate(...a) };
});
// TRAP (handoff §5): AI_NUTRITION_BACKFILL_ENABLED defaults TRUE — an unmocked
// backfill dials the jest LLM blackhole and fails as ECONNREFUSED.
jest.mock('../ai-nutrition-backfill', () => ({
    requestAiNutrition: jest.fn().mockResolvedValue({ status: 'error', reason: 'skip' }),
    extractBaseFoodContext: jest.fn().mockReturnValue(null),
    getAiServingGrams: jest.fn().mockResolvedValue(null),
    createAiNutritionBudget: (max: number) => ({ remaining: max, spent: 0 }),
}));
// Step 2b-ii seam: the mapper dynamic-imports './ai-simplify'; jest.mock still
// intercepts it (producer-simplify-exits.test.ts pattern).
jest.mock('../ai-simplify', () => {
    const actual = jest.requireActual('../ai-simplify');
    return { ...actual, aiSimplifyIngredient: (...a: unknown[]) => mockSimplify(...a) };
});
// The Mac .env sets ENABLE_MAPPING_ANALYSIS=true; unmocked, every run of this
// file wrote a real logs/mapping-analysis-*.json session file from inside jest
// (measured). Automock suffices — producer-cache-failure-research.test.ts
// proves it against the full mapper.
jest.mock('../mapping-logger');
// Unmocked, the first gather loads the real ONNX embedding model
// (embedding.model_loaded fired after every run of this file — measured).
jest.mock('../../search/query-embedding', () => ({
    SEMANTIC_SEARCH_ENABLED: false,
    CORPUS_POOLING: 'cls',
    warmupEmbedder: jest.fn(),
    embedQuery: jest.fn().mockResolvedValue(null),
}));
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


import { mapIngredientWithFallback, type FatsecretMappedIngredient } from '../map-ingredient-with-fallback';
import { aiNormalizeIngredient } from '../ai-normalize';
import { shouldNormalizeLlm } from '../normalize-gate';
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
import { gatherCandidates, type UnifiedCandidate } from '../gather-candidates';
import { simpleRerank } from '../simple-rerank';

const cand = (id: string, name: string, score: number, kcal: number): UnifiedCandidate => ({
    id,
    source: 'fatsecret',
    name,
    brandName: null,
    score,
    nutrition: { kcal, protein: 2.5, carbs: 12, fat: 1.5, per100g: true },
    servings: [{ description: '1 cup', grams: 240, isDefault: true }],
});

// FACTORIES: the mapper enriches candidate objects in place. Each line gets a
// pool its own cooking-state filter admits (a dry line rejects cooked records).
const COOKED_OATS_POOL = () => [
    cand('fs_112745332', 'Steel Cut Oats (Cooked)', 5.0, 73),
    cand('fs_900000001', 'Oatmeal (Cooked)', 4.0, 71),
];
const DRY_OATS_POOL = () => [
    cand('fs_900000002', 'Rolled Oats', 5.0, 379),
    cand('fs_900000003', 'Oatmeal', 4.0, 375),
];
const COOKED_RICE_POOL = () => [
    cand('fs_900000004', 'White Rice (Cooked)', 5.0, 130),
    cand('fs_900000005', 'Cooked Rice', 4.0, 129),
];

const row = (kcal: number, canonicalBase: string, normalizedName: string) => ({
    normalizedName,
    canonicalBase,
    cookingModifier: undefined,
    synonyms: [],
    prepPhrases: [],
    sizePhrases: [],
    isBranded: false,
    isMultiIngredient: false,
    nutritionEstimate: { caloriesPer100g: kcal, proteinPer100g: 16.9, carbsPer100g: 66.3, fatPer100g: 6.9, confidence: 0.95 },
});
const DRY_OATS_ROW = row(389, 'oats', 'rolled oats');
const COOKED_RICE_ROW = row(130, 'white rice', 'rice');

const hydratedResultFor = (winner: UnifiedCandidate, confidence: number, rawLine: string): FatsecretMappedIngredient => ({
    source: 'fatsecret',
    foodId: winner.id,
    foodName: winner.name,
    brandName: null,
    servingId: null,
    servingDescription: '1 cup',
    grams: 240,
    kcal: 175,
    protein: 6,
    carbs: 29,
    fat: 3.6,
    confidence,
    quality: 'high',
    rawLine,
});

beforeEach(() => {
    jest.clearAllMocks();
    // Normalize gate SKIPS the LLM: the cached-row replay is the only estimate source.
    (shouldNormalizeLlm as jest.Mock).mockReturnValue({ shouldCallLlm: false, reason: 'test_gate_skip', confidence: 0.9 });
    (aiNormalizeIngredient as jest.Mock).mockResolvedValue({ status: 'error', reason: 'skip' });
    (getValidatedMapping as jest.Mock).mockResolvedValue(null);
    (getValidatedMappingByNormalizedName as jest.Mock).mockResolvedValue(null);
    (getAiNormalizeCache as jest.Mock).mockResolvedValue(DRY_OATS_ROW);
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
    (gatherCandidates as jest.Mock).mockImplementation(async () => COOKED_OATS_POOL());
    mockSimplify.mockResolvedValue(null);
    (simpleRerank as jest.Mock).mockReturnValue({
        winner: { id: 'fs_112745332' },
        confidence: 0.9,
        reason: 'exact_match',
        sortedCandidates: [],
    });
    mockHydrate.mockImplementation(async (winner: UnifiedCandidate, _p: unknown, confidence: number) =>
        hydratedResultFor(winner, confidence, 'x'));
});

/** [rerankQuery, estimate] handed to the (single) simpleRerank call. */
const rerankArgs = () => {
    const calls = (simpleRerank as jest.Mock).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    return { query: calls[0][0] as string, estimate: calls[0][2] as { caloriesPer100g: number } | undefined };
};
const savedExpectedNutrition = () => {
    const calls = (saveValidatedMapping as jest.Mock).mock.calls;
    expect(calls.length).toBe(1);
    return calls[0][3].expectedNutrition as { caloriesPer100g: number } | undefined;
};

describe('gate-skip cached-row replay on an explicit-cooked grain line', () => {
    it('1 cup cooked oats + the dry 389 row: no estimate reaches rerank or the save; canonicalBase still replayed', async () => {
        await mapIngredientWithFallback('1 cup cooked oats');
        expect(getAiNormalizeCache).toHaveBeenCalled();
        const { query, estimate } = rerankArgs();
        expect(query).toBe('oats');
        expect(estimate).toBeUndefined();
        expect(savedExpectedNutrition()).toBeUndefined();
    });

    it('control: bare `oatmeal` (dry context) still adopts the same row', async () => {
        (gatherCandidates as jest.Mock).mockImplementation(async () => DRY_OATS_POOL());
        (simpleRerank as jest.Mock).mockReturnValue({ winner: { id: 'fs_900000002' }, confidence: 0.9, reason: 'exact_match', sortedCandidates: [] });
        await mapIngredientWithFallback('oatmeal');
        const { query, estimate } = rerankArgs();
        expect(query).toBe('oats');
        expect(estimate?.caloriesPer100g).toBe(389);
        expect(savedExpectedNutrition()?.caloriesPer100g).toBe(389);
    });

    it('control: the soft twin `1 cup oats` still adopts the row (the volume-oats class is out of scope)', async () => {
        await mapIngredientWithFallback('1 cup oats');
        expect(rerankArgs().estimate?.caloriesPer100g).toBe(389);
    });

    it('control: `1 cup cooked rice` keeps its correct 130 kcal row (below the dry-panel band)', async () => {
        (getAiNormalizeCache as jest.Mock).mockResolvedValue(COOKED_RICE_ROW);
        (gatherCandidates as jest.Mock).mockImplementation(async () => COOKED_RICE_POOL());
        (simpleRerank as jest.Mock).mockReturnValue({ winner: { id: 'fs_900000004' }, confidence: 0.9, reason: 'exact_match', sortedCandidates: [] });
        await mapIngredientWithFallback('1 cup cooked rice');
        const { query, estimate } = rerankArgs();
        expect(query).toBe('white rice');
        expect(estimate?.caloriesPer100g).toBe(130);
    });
});
