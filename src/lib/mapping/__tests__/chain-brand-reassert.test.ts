/**
 * chain-brand-reassert.test.ts - a restaurant chain the detector found and the
 * normalizer dropped is put back (s453 row C), SOLO path (no segmenter brand).
 * Mock preamble copied from segmenter-brand-reassert.test.ts.
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
import type { FatsecretMappedIngredient } from '../../fatsecret/mapper';


const cand = (id: string, name: string, brandName: string | null, score: number): UnifiedCandidate => ({
    id,
    source: 'off',
    name,
    brandName,
    score,
    nutrition: { kcal: 300, protein: 5, carbs: 40, fat: 12, per100g: true },
    servings: [{ description: '1 serving (100 g)', grams: 100, isDefault: true }],
    rawData: { barcode: id.replace('off_', ''), name, brandName, nutrientsPer100g: { calories: 300, protein: 5, carbs: 40, fat: 12 }, servings: [] },
});

const gatherNames = () => (gatherCandidates as jest.Mock).mock.calls.map(c => c[2] as string);
const saveKey = () => (saveValidatedMapping as jest.Mock).mock.calls[0][3].canonicalBase as string;

const hydratedResultFor = (winner: UnifiedCandidate, confidence: number, rawLine: string): FatsecretMappedIngredient => ({
    source: 'off',
    foodId: winner.id,
    foodName: winner.name,
    brandName: winner.brandName ?? null,
    servingId: null,
    servingDescription: '1 serving',
    grams: 100,
    kcal: 300,
    protein: 5,
    carbs: 40,
    fat: 12,
    confidence,
    quality: 'high',
    rawLine,
});

const modelAnswer = (x: string) => ({
    status: 'success',
    normalizedName: x,
    canonicalBase: x,
    isBranded: true,
    synonyms: [],
    prepPhrases: [],
    sizePhrases: [],
});

let currentLine = '';

function stubPool(id: string, name: string, brand: string | null) {
    (gatherCandidates as jest.Mock).mockImplementation(async () => [cand(id, name, brand, 5)]);
    (simpleRerank as jest.Mock).mockReturnValue({ winner: { id }, confidence: 0.9, reason: 'exact_match', sortedCandidates: [] });
}

beforeEach(() => {
    jest.clearAllMocks();
    (shouldNormalizeLlm as jest.Mock).mockReturnValue({ shouldCallLlm: true, reason: 'test_gate_call', confidence: 0.2 });
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
    mockSimplify.mockResolvedValue(null);
    mockHydrate.mockImplementation(async (winner: UnifiedCandidate, _p, confidence: number) =>
        hydratedResultFor(winner, confidence, currentLine));
});

describe('SOLO path: a dropped restaurant chain is put back', () => {
    it('`a small frosty from wendys` -> model `frosty`: the last gather name and the save key carry wendys', async () => {
        currentLine = 'a small frosty from wendys';
        (aiNormalizeIngredient as jest.Mock).mockResolvedValue(modelAnswer('frosty'));
        stubPool('off_w1', 'Chocolate Frosty', "Wendy's");
        const result = await mapIngredientWithFallback(currentLine);
        expect(result).not.toBeNull();
        const names = gatherNames();
        expect(names[names.length - 1].toLowerCase()).toBe('wendys frosty');
        // the cache key singularizes the brand token (wendys -> wendy)
        expect(saveKey()).toMatch(/wendy/);
    });

    it('`a biscuit from popeyes` -> model `biscuit`: the save key carries popeyes', async () => {
        currentLine = 'a biscuit from popeyes';
        (aiNormalizeIngredient as jest.Mock).mockResolvedValue(modelAnswer('biscuit'));
        stubPool('off_p1', 'Biscuit', 'Popeyes');
        await mapIngredientWithFallback(currentLine);
        // the cache key singularizes the brand token
        expect(saveKey()).toMatch(/popeye/);
    });

    it('`chipotle peppers in adobo`, model keeps the name: no prefix doubling', async () => {
        currentLine = 'chipotle peppers in adobo';
        (aiNormalizeIngredient as jest.Mock).mockResolvedValue(modelAnswer('chipotle peppers in adobo'));
        stubPool('off_c1', 'Chipotle Peppers in Adobo', null);
        await mapIngredientWithFallback(currentLine);
        const names = gatherNames();
        expect(names[names.length - 1].toLowerCase()).toBe('chipotle peppers in adobo');
        expect(saveKey().split(' ').filter(t => t === 'chipotle').length).toBe(1);
    });
});
