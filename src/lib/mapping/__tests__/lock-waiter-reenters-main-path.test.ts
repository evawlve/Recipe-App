/**
 * In-flight lock WAITER (s459 pd-waiter) — pins mapIngredientWithFallback()'s
 * lock waiter to the main path.
 *
 * Two lines with the same baseName that are mapped at once (the parse route
 * maps a request's items with Promise.all; warm-cache.ts and stress-latency.ts
 * run workers in parallel) share one in-flight lock: the second call WAITS on
 * the first. It used to re-read the cache itself through
 * getValidatedMappingByNormalizedName(normalizeIngredientName(baseName)) — the
 * bare key, no escape chain, and even under skipCache. It now falls through
 * into the same early cache check a later request takes, so:
 *   - a waiting SCOOP line still escapes the ready-to-drink row (scoop_liquid);
 *   - a waiting skipCache (nocache=1) request never reads the cache;
 *   - a waiting line served from the cache is labelled like any cache hit
 *     (normalizedForm, cacheHit 'early', funnelStage 'cache_hit').
 * Fixtures and mock preamble copied from scoop-liquid-escape.test.ts.
 */

const mockOffFindUnique = jest.fn();
const mockGatherCandidates = jest.fn();
const mockSimpleRerank = jest.fn();
const mockHydrateAndSelectServing = jest.fn();

// Generic prisma stub: every model answers "nothing found" for any verb, with
// offFood.findUnique controllable per test (it is what the escape-evaluation
// chains read to decide corrupt_record / nutrition_invalid). The Proxy shape
// exists because enumerating models by hand has previously made a sibling file
// die deep in the cascade on an unmocked serving-store model
// (map-ingredient-with-fallback.test.ts's own header warns about this).
jest.mock('../../db', () => {
    const emptyFor = (verb: string) =>
        jest.fn().mockResolvedValue(verb.startsWith('findMany') ? [] : null);
    const genericModel = new Proxy({}, { get: (_t, verb) => emptyFor(String(verb)) });
    return {
        prisma: new Proxy({}, {
            get: (_t, prop) => {
                const name = String(prop);
                if (name === 'offFood') {
                    return {
                        findUnique: (...a: unknown[]) => mockOffFindUnique(...a),
                        findMany: jest.fn().mockResolvedValue([]),
                    };
                }
                if (name.startsWith('$')) return jest.fn().mockResolvedValue([]);
                return genericModel;
            },
        }),
    };
});

jest.mock('../ai-normalize');
jest.mock('../ai-parse');
jest.mock('../ai-simplify');
// Keep the classifiers REAL: the escape chain calls isTrustedHumanRow /
// isHumanTrustSkippableEscape / targetKeyOfFoodId, and the assertions below
// keep the real trust classifier, which this suite pins for scoop_liquid.
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
jest.mock('../mapping-logger'); // ENABLE_MAPPING_ANALYSIS=true in the dev .env — keep runs file-free
jest.mock('../ai-backfill', () => ({
    insertAiServing: jest.fn().mockResolvedValue({ success: false, reason: 'skip' }),
    backfillWeightServing: jest.fn().mockResolvedValue({ success: false, reason: 'skip' }),
}));
jest.mock('../gather-candidates', () => {
    const actual = jest.requireActual('../gather-candidates');
    return { ...actual, gatherCandidates: (...a: unknown[]) => mockGatherCandidates(...a) };
});
jest.mock('../simple-rerank', () => {
    const actual = jest.requireActual('../simple-rerank');
    return { ...actual, simpleRerank: (...a: unknown[]) => mockSimpleRerank(...a) };
});
// Stage-1a seam: ALL mapper hydration call sites go through this import.
jest.mock('../serving/hydration-lane', () => {
    const actual = jest.requireActual('../serving/hydration-lane');
    return { ...actual, hydrateAndSelectServing: (...a: unknown[]) => mockHydrateAndSelectServing(...a) };
});
// TRAP (handoff §5): AI_NUTRITION_BACKFILL_ENABLED defaults TRUE — an unmocked
// backfill dials the jest LLM blackhole and fails as confusing ECONNREFUSED.
jest.mock('../ai-nutrition-backfill', () => ({
    requestAiNutrition: jest.fn().mockResolvedValue({ status: 'error', reason: 'skip' }),
    extractBaseFoodContext: jest.fn().mockReturnValue(null),
    getAiServingGrams: jest.fn().mockResolvedValue(null),
    createAiNutritionBudget: (max: number) => ({ remaining: max, spent: 0 }),
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
jest.mock('../../search/query-embedding', () => ({
    SEMANTIC_SEARCH_ENABLED: false,
    CORPUS_POOLING: 'cls',
    warmupEmbedder: jest.fn(),
    embedQuery: jest.fn().mockResolvedValue(null),
}));

import { mapIngredientWithFallback, type MappingTelemetry } from '../map-ingredient-with-fallback';
import {
    getValidatedMappingByNormalizedName,
    saveValidatedMapping,
    getAiNormalizeCache,
} from '../validated-mapping-helpers';
import { aiNormalizeIngredient } from '../ai-normalize';
import { findCanonicalName, getKnownSynonyms, saveSynonyms } from '../ai-synonym-generator';
import { getLearnedSynonyms, extractTermsFromIngredient } from '../learned-synonyms';
import { getCachedFoodWithRelations } from '../cache-search';
import { ensureFoodCached } from '../cache';
import { hydrateSingleCandidate } from '../hydrate-cache';
import { queueForDeferredHydration } from '../deferred-hydration';
import { backfillOnDemand } from '../serving-backfill';
import { requestAiNutrition } from '../ai-nutrition-backfill';
import type { UnifiedCandidate } from '../gather-candidates';


// ── Fixtures (the measured muscle milk bottle, as in scoop-liquid-escape.test.ts) ──

const RTD_FOOD_ID = 'off_0052000051032';
const FDC_ID = 'fdc_777001';

const rtdRow = () => ({
    source: 'openfoodfacts',
    foodId: RTD_FOOD_ID,
    foodName: 'muscle milk',
    brandName: 'Muscle Milk',
    servingId: null,
    servingDescription: '1 serving (330 ml)',
    grams: 330,
    kcal: 160,
    protein: 25,
    carbs: 9,
    fat: 4.5,
    confidence: 0.98,
    quality: 'high' as const,
    rawLine: 'muscle milk',
    validatedBy: 'ai',
});
const rtdRecord = () => ({
    nutrientsPer100g: { calories: 48.5, protein: 7.58, carbohydrate: 2.73, fat: 1.36 },
    servingSize: '1 serving (330 ml)',
    servingGrams: 330,
    corruptReason: null,
});
const powderCandidate = (): UnifiedCandidate => ({
    id: FDC_ID,
    source: 'fdc',
    name: 'Muscle Milk protein powder',
    brandName: null,
    score: 0.95,
    foodType: 'generic',
    nutrition: { kcal: 400, protein: 50, carbs: 30, fat: 9, per100g: true },
    rawData: { fdcId: 777001, description: 'Muscle Milk protein powder', dataType: 'Branded', nutrientsPer100g: { calories: 400 }, servings: [] },
} as unknown as UnifiedCandidate);
const billed = (cand: { id: string; name: string }, conf: number, raw: string, grams: number, kcal: number) => ({
    source: cand.id.startsWith('off_') ? 'openfoodfacts' : 'fdc',
    foodId: cand.id,
    foodName: cand.name,
    brandName: null,
    servingId: null,
    servingDescription: '1 scoop',
    grams,
    kcal,
    protein: 1,
    carbs: 1,
    fat: 1,
    confidence: conf,
    quality: 'high' as const,
    rawLine: raw,
});

const lookupMock = getValidatedMappingByNormalizedName as jest.Mock;
type Served = { foodId: string; kcal: number } | null;

beforeEach(() => {
    jest.clearAllMocks();
    (aiNormalizeIngredient as jest.Mock).mockResolvedValue({ status: 'error', reason: 'skip' });
    lookupMock.mockReset();
    lookupMock.mockResolvedValue(rtdRow());
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
    (requestAiNutrition as jest.Mock).mockResolvedValue({ status: 'error', reason: 'skip' });
    mockOffFindUnique.mockResolvedValue(rtdRecord());
    mockGatherCandidates.mockResolvedValue([powderCandidate()]);
    mockSimpleRerank.mockReturnValue({
        winner: { id: FDC_ID, name: 'Muscle Milk protein powder' },
        confidence: 0.95,
        reason: 'single_candidate',
        sortedCandidates: [],
    });
    mockHydrateAndSelectServing.mockImplementation(
        async (cand: { id: string; name: string }, _p: unknown, conf: number, raw: string) =>
            cand.id.startsWith('off_') ? billed(cand, conf, raw, 35, 17) : billed(cand, conf, raw, 35, 140),
    );
});

describe('in-flight lock waiter takes the main path', () => {
    it('a SCOOP line waiting on the bare line still escapes the ready-to-drink row', async () => {
        const tBare: MappingTelemetry = {};
        const tScoop: MappingTelemetry = {};

        // Same baseName (`muscle milk`), mapped at once: the scoop line waits.
        const [bare, scoop] = (await Promise.all([
            mapIngredientWithFallback('muscle milk', { telemetry: tBare }),
            mapIngredientWithFallback('1 scoop muscle milk', { telemetry: tScoop }),
        ])) as [Served, Served];

        expect(bare?.foodId).toBe(RTD_FOOD_ID);
        expect(tBare.cacheHit).toBe('early');
        // The waiter is served what the scoop line gets on its own: the cold powder.
        expect(scoop?.foodId).toBe(FDC_ID);
        expect(scoop?.kcal).toBe(140);
        expect(tScoop.cacheEscape).toBe('normalized:scoop_liquid');
        expect(tScoop.dropReason).toBe('save_rejected:scoop_liquid');
    });

    it('a waiting skipCache (nocache=1) request never reads the cache', async () => {
        const t1: MappingTelemetry = {};
        const t2: MappingTelemetry = {};

        const [a, b] = (await Promise.all([
            mapIngredientWithFallback('muscle milk', { telemetry: t1, skipCache: true }),
            mapIngredientWithFallback('muscle milk', { telemetry: t2, skipCache: true }),
        ])) as [Served, Served];

        expect(lookupMock).not.toHaveBeenCalled();
        expect(a?.foodId).toBe(FDC_ID);
        expect(b?.foodId).toBe(FDC_ID);
        expect(t2.cacheHit).toBeUndefined();
    });

    it('a waiter served from the cache is labelled like any cache hit', async () => {
        const t1: MappingTelemetry = {};
        const t2: MappingTelemetry = {};

        const [a, b] = (await Promise.all([
            mapIngredientWithFallback('muscle milk', { telemetry: t1 }),
            mapIngredientWithFallback('muscle milk', { telemetry: t2 }),
        ])) as [Served, Served];

        expect(a?.foodId).toBe(RTD_FOOD_ID);
        expect(b?.foodId).toBe(RTD_FOOD_ID);
        expect(t2.normalizedForm).toBe(t1.normalizedForm);
        expect(t2.cacheHit).toBe('early');
        expect(t2.funnelStage).toBe('cache_hit');
    });
});
