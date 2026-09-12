/**
 * segmenter-brand-reassert.test.ts — the post-model brand re-assert honours
 * the SEGMENTER's brand, not only lexical decisiveness (2026-09-05).
 *
 * Through the real `mapIngredientWithFallback()`, with the normalizer stubbed
 * to return the exact AiNormalizeCache row the box holds for the punch-#101
 * line (`ryse skippy peanut butter` → `skippy peanut butter`, is_branded true):
 *
 *   - COMPOSITE path (segmenter options `brand: 'Ryse'`, `normalizedForm:
 *     'skippy peanut butter'`): the full gather and the save key carry `ryse`.
 *   - SOLO path (no options): unchanged — `ryse` stays dropped, because the
 *     lexical gate is untouched and `winner-diff` replays exactly this path.
 *   - `bell pepper` → `capsicum` with no segmenter brand: unchanged (the
 *     refuted `bell capsicum` key is not rebuilt; cache-key-symmetry pins the
 *     key half).
 *
 * Mock preamble is the house one (producer-normalized-name-frozen.test.ts).
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
import { mapIngredientWithFallback } from '../map-ingredient-with-fallback';
import type { FatsecretMappedIngredient } from '../../fatsecret/mapper';

const LINE = '.75 scoop Ryse skippy peanut butter';
const SEGMENTER_FORM = 'skippy peanut butter';
const MODEL_OUTPUT = 'skippy peanut butter';

const cand = (id: string, name: string, brandName: string | null, score: number): UnifiedCandidate => ({
    id,
    source: 'off',
    name,
    brandName,
    score,
    nutrition: { kcal: 376, protein: 62.7, carbs: 12.5, fat: 7.5, per100g: true },
    servings: [{ description: '1 scoop (39.9 g)', grams: 39.9, isDefault: true }],
    rawData: { barcode: id.replace('off_', ''), name, brandName, nutrientsPer100g: { calories: 376, protein: 62.7, carbs: 12.5, fat: 7.5 }, servings: [] },
});

const POOL = () => [
    cand('off_0724441914299', 'Ryse Peanut Butter Protein', 'Ryse', 5.9),
    cand('off_6922877745423', 'Skippy Peanut Butter', 'Skippy', 5.0),
];

const gatherNames = () => (gatherCandidates as jest.Mock).mock.calls.map(c => c[2] as string);
const saveKey = () => (saveValidatedMapping as jest.Mock).mock.calls[0][3].canonicalBase as string;

const hydratedResultFor = (winner: UnifiedCandidate, confidence: number): FatsecretMappedIngredient => ({
    source: 'off',
    foodId: winner.id,
    foodName: winner.name,
    brandName: winner.brandName ?? null,
    servingId: null,
    servingDescription: '1 scoop',
    grams: 39.9,
    kcal: 150,
    protein: 25,
    carbs: 5,
    fat: 3,
    confidence,
    quality: 'high',
    rawLine: LINE,
});

const modelAnswer = (normalizedName: string) => ({
    status: 'success',
    normalizedName,
    canonicalBase: normalizedName,
    isBranded: true,
    synonyms: [],
    prepPhrases: [],
    sizePhrases: [],
});

beforeEach(() => {
    jest.clearAllMocks();
    (shouldNormalizeLlm as jest.Mock).mockReturnValue({ shouldCallLlm: true, reason: 'test_gate_call', confidence: 0.2 });
    (aiNormalizeIngredient as jest.Mock).mockResolvedValue(modelAnswer(MODEL_OUTPUT));
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
    (gatherCandidates as jest.Mock).mockImplementation(async () => POOL());
    mockSimplify.mockResolvedValue(null);
    (simpleRerank as jest.Mock).mockReturnValue({
        winner: { id: 'off_0724441914299' },
        confidence: 0.9,
        reason: 'exact_match',
        sortedCandidates: [],
    });
    mockHydrate.mockImplementation(async (winner: UnifiedCandidate, _p, confidence: number) =>
        hydratedResultFor(winner, confidence));
});

describe('COMPOSITE path: the segmenter named Ryse, the model dropped it, the mapper puts it back', () => {
    it('the full gather and the save key carry `ryse`', async () => {
        const result = await mapIngredientWithFallback(LINE, { brand: 'Ryse', normalizedForm: SEGMENTER_FORM });
        expect(result).not.toBeNull();
        expect(aiNormalizeIngredient).toHaveBeenCalled();
        const names = gatherNames();
        expect(names[names.length - 1].toLowerCase()).toBe('ryse skippy peanut butter');
        expect(saveValidatedMapping).toHaveBeenCalledTimes(1);
        expect(saveKey().split(' ')).toContain('ryse');
        // The pre-injection value is what the legacy (brandless) lookup keys off.
        expect(saveKey()).not.toBe(MODEL_OUTPUT);
    });
});

describe('SOLO path: unchanged, because the lexical gate is untouched', () => {
    it('`ryse` stays dropped when no segmenter brand is supplied (what winner-diff replays)', async () => {
        await mapIngredientWithFallback(LINE);
        const names = gatherNames();
        expect(names[names.length - 1].toLowerCase()).toBe(MODEL_OUTPUT);
        expect(saveKey().split(' ')).not.toContain('ryse');
    });

    it('the refuted `bell pepper` → `capsicum` shape is not rebuilt', async () => {
        (aiNormalizeIngredient as jest.Mock).mockResolvedValue(modelAnswer('capsicum'));
        (gatherCandidates as jest.Mock).mockImplementation(async () => [cand('off_1', 'Capsicum', null, 5)]);
        (simpleRerank as jest.Mock).mockReturnValue({ winner: { id: 'off_1' }, confidence: 0.9, reason: 'exact_match', sortedCandidates: [] });
        await mapIngredientWithFallback('bell pepper');
        const names = gatherNames();
        expect(names[names.length - 1].toLowerCase()).toBe('capsicum');
        expect(saveKey().split(' ')).not.toContain('bell');
    });
});
