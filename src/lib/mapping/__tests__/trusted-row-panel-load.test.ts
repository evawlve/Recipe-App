/**
 * s435: a TRUSTED human row (validatedBy 'human-triage') whose core token
 * mismatches the query ('mint' vs 'Spearmint, fresh') must still get its
 * panel loaded at BOTH cache-read gates (Step 1a early, Step 1c producer);
 * without it buildFdcResult() returns null and Step 5b re-searches.
 * Preamble copied from normalized-cache-fdc-panel.test.ts.
 */

const mockHydrate = jest.fn();
const mockSimplify = jest.fn();

// Generic prisma stub: every model answers "nothing found" for any verb.
// (House pattern from abstention-confidence.test.ts — enumerating models by
// hand has previously made a sibling file assert nothing.)
const mockFdcFindUnique = jest.fn();
const mockOffFindUnique = jest.fn();
jest.mock('../../db', () => {
    const emptyFor = (verb: string) =>
        jest.fn().mockResolvedValue(verb.startsWith('findMany') ? [] : null);
    const generic = new Proxy({}, { get: (_t, verb: string) => emptyFor(verb) });
    const fdcFood = { findUnique: (...a: unknown[]) => mockFdcFindUnique(...a) };
    const offFood = { findUnique: (...a: unknown[]) => mockOffFindUnique(...a) };
    return {
        prisma: new Proxy({}, {
            get: (_t, model: string) => (model === 'fdcFood' ? fdcFood : model === 'offFood' ? offFood : generic),
        }),
    };
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

import { mapIngredientWithFallback, type FatsecretMappedIngredient, type MappingTelemetry } from '../map-ingredient-with-fallback';
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
import { requestAiNutrition } from '../ai-nutrition-backfill';
import { deriveMappingCacheKey, deriveCacheKeyName } from '../cache-key';
import { detectBrandInQuery } from '../brand-detector';
import { normalizeIngredientName } from '../normalization-rules';
import { AI_NUTRITION_BACKFILL_ENABLED } from '../config';


const LINE = 'extra mint';

const cand = (id: string, name: string, score: number): UnifiedCandidate => ({
    id,
    source: 'fdc',
    name,
    brandName: null,
    score,
    nutrition: { kcal: 7, protein: 1.1, carbs: 0.2, fat: 0.2, per100g: true },
    servings: [{ description: '100 g', grams: 100, isDefault: true }],
    rawData: {},
});

const BROTH_POOL = () => [cand('fdc_1111111', 'Beef Broth', 5.9), cand('fdc_2222222', 'Beef Broth Bouillon and Consomme', 4.0)];

const hydratedResultFor = (winner: UnifiedCandidate, confidence: number): FatsecretMappedIngredient => ({
    source: 'fdc',
    foodId: winner.id,
    foodName: winner.name,
    brandName: null,
    servingId: null,
    servingDescription: '1 cup',
    grams: 240,
    kcal: 16.8,
    protein: 2.6,
    carbs: 0.5,
    fat: 0.5,
    confidence,
    quality: 'high',
    rawLine: LINE,
});

beforeEach(() => {
    jest.clearAllMocks();
    // Normalize gate SKIPS the LLM: the heuristic rewrite is then the run's
    // only normalizedName mutation, so every delta below is attributable to it.
    (shouldNormalizeLlm as jest.Mock).mockReturnValue({ shouldCallLlm: false, reason: 'test_gate_skip', confidence: 0.9 });
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
    (gatherCandidates as jest.Mock).mockImplementation(async () => []);
    (simpleRerank as jest.Mock).mockReturnValue(null);
    mockSimplify.mockResolvedValue(null);
    // Rerank names the pool head. 'exact_match' is a REAL winner reason and
    // 0.9 clears the 0.85 save gate, so finalizeAndSaveResult() saves.
    (simpleRerank as jest.Mock).mockReturnValue({
        winner: { id: 'fdc_1111111' },
        confidence: 0.9,
        reason: 'exact_match',
        sortedCandidates: [],
    });
    // Mirrors buildFdcResult(): an fdc winner without a panel hydrates to null.
    mockHydrate.mockImplementation(async (w: UnifiedCandidate, _p: unknown, c: number) =>
        (w.id.startsWith('fdc_') && !w.nutrition) ? null : hydratedResultFor(w, c));
    mockFdcFindUnique.mockReset();
    mockFdcFindUnique.mockResolvedValue({ nutrientsPer100g: { calories: 44, protein: 3.29, carbs: 8.41, fat: 0.73 } });
    delete process.env.HUMAN_ROW_TRUST;
});


const spearmintRow = (validatedBy: string) => ({
    foodId: 'fdc_173475',
    foodName: 'Spearmint, fresh',
    brandName: null,
    source: 'fdc',
    confidence: 0.99,
    validatedBy,
});
const armByKey = (validatedBy: string) => {
    (getValidatedMappingByNormalizedName as jest.Mock).mockImplementation(async (key: string) =>
        key === 'mint' ? spearmintRow(validatedBy) : null);
};
const loadedPanel = () => mockFdcFindUnique.mock.calls.filter(
    c => (c[0] as any)?.where?.fdcId === 173475);
const hydratedIds = () => mockHydrate.mock.calls.map(c => (c[0] as UnifiedCandidate).id);

afterEach(() => { delete process.env.HUMAN_ROW_TRUST; });

describe('trusted human row with a core-token mismatch keeps its panel (s435)', () => {
    it('(a) early path: the winner carries the loaded panel (kcal 44), cacheHit early, no cacheEscape', async () => {
        armByKey('human-triage');
        const telemetry: MappingTelemetry = {};
        await mapIngredientWithFallback(LINE, { telemetry });
        expect(loadedPanel().length).toBeGreaterThan(0);
        const call = mockHydrate.mock.calls.find(c => (c[0] as UnifiedCandidate).id === 'fdc_173475');
        expect(call).toBeDefined();
        expect((call![0] as UnifiedCandidate).nutrition?.kcal).toBe(44);
        expect(telemetry.cacheHit).toBe('early');
        expect(telemetry.cacheEscape).toBeUndefined();
    });

    it("(b) an 'ai' row with the same mismatch still escapes and loads no panel", async () => {
        armByKey('ai');
        const telemetry: MappingTelemetry = {};
        await mapIngredientWithFallback(LINE, { telemetry });
        expect(mockFdcFindUnique).not.toHaveBeenCalledWith(expect.objectContaining({ where: { fdcId: 173475 } }));
        expect(hydratedIds()).not.toContain('fdc_173475');
        expect(telemetry.cacheEscape).toBe('normalized:core_token_mismatch');
    });

    it("(c) HUMAN_ROW_TRUST='0' restores the old behaviour", async () => {
        process.env.HUMAN_ROW_TRUST = '0';
        armByKey('human-triage');
        const telemetry: MappingTelemetry = {};
        await mapIngredientWithFallback(LINE, { telemetry });
        expect(mockFdcFindUnique).not.toHaveBeenCalledWith(expect.objectContaining({ where: { fdcId: 173475 } }));
        expect(hydratedIds()).not.toContain('fdc_173475');
        expect(telemetry.cacheEscape).toBe('normalized:core_token_mismatch');
    });

    it('(d) producer path (Step 1c): early lookup misses, normalized lookup hits; winner carries kcal 44', async () => {
        (getValidatedMappingByNormalizedName as jest.Mock)
            .mockResolvedValueOnce(null)
            .mockResolvedValue(spearmintRow('human-triage'));
        await mapIngredientWithFallback(LINE, { telemetry: {} });
        const keys = (getValidatedMappingByNormalizedName as jest.Mock).mock.calls.map(c => c[0]);
        expect(keys).toEqual(['mint', 'mint']);
        const call = mockHydrate.mock.calls.find(c => (c[0] as UnifiedCandidate).id === 'fdc_173475');
        expect(call).toBeDefined();
        expect((call![0] as UnifiedCandidate).nutrition?.kcal).toBe(44);
    });
});
