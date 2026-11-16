/**
 * s459 SCOOP-PICK wiring: a rerank that returns `scoop_powder_repick` is SERVED and never written
 * back (finalizeAndSaveResult()), because the cache key carries no unit and a later bare line would
 * read the powder. Any other rerank reason on the same pool still saves.
 * Mock preamble copied from scoop-liquid-escape.test.ts (itself from producer-read-escapes-delivery).
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
import { getValidatedMappingByNormalizedName, saveValidatedMapping, getAiNormalizeCache } from '../validated-mapping-helpers';
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
import { SCOOP_POWDER_REPICK } from '../scoop-powder-repick';

const POWDER_ID = 'fs_3852378';
const candidate = (id: string, name: string, kcal: number): UnifiedCandidate => ({
    id,
    source: 'fatsecret',
    name,
    brandName: 'Muscle Milk',
    score: 1.4,
    foodType: 'Brand',
    nutrition: { kcal, protein: 10, carbs: 3, fat: 1, per100g: true },
    rawData: {},
} as unknown as UnifiedCandidate);

const billed = (cand: { id: string; name: string }, conf: number, raw: string) => ({
    source: 'fatsecret',
    foodId: cand.id,
    foodName: cand.name,
    brandName: 'Muscle Milk',
    servingId: null,
    servingDescription: '1 scoop',
    grams: 35,
    kcal: 135,
    protein: 16,
    carbs: 10,
    fat: 4.5,
    confidence: conf,
    quality: 'high' as const,
    rawLine: raw,
});

const saveCalls = () => (saveValidatedMapping as jest.Mock).mock.calls;

function rerankReturns(reason: string): void {
    mockSimpleRerank.mockReturnValue({
        winner: { id: POWDER_ID, name: 'Chocolate Protein Powder' },
        confidence: 0.9,
        reason,
        sortedCandidates: [],
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    (aiNormalizeIngredient as jest.Mock).mockResolvedValue({ status: 'error', reason: 'skip' });
    (getValidatedMappingByNormalizedName as jest.Mock).mockReset();
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
    (requestAiNutrition as jest.Mock).mockResolvedValue({ status: 'error', reason: 'skip' });
    mockOffFindUnique.mockResolvedValue(null);
    mockGatherCandidates.mockResolvedValue([
        candidate('fs_8905093', 'Pro Series 40 Knockout Chocolate (14 oz)', 55),
        candidate(POWDER_ID, 'Chocolate Protein Powder', 386),
    ]);
    mockHydrateAndSelectServing.mockImplementation(
        async (cand: { id: string; name: string }, _p: unknown, conf: number, raw: string) => billed(cand, conf, raw),
    );
});

describe('mapper: a scoop re-pick is served and not written back', () => {
    it('serves the powder, marks save_rejected:scoop_powder_repick, and never calls saveValidatedMapping', async () => {
        rerankReturns(SCOOP_POWDER_REPICK);
        const telemetry: MappingTelemetry = {};

        const result = (await mapIngredientWithFallback('1 scoop muscle milk chocolate', { telemetry })) as { foodId: string; kcal: number } | null;

        expect(mockSimpleRerank).toHaveBeenCalled();
        expect(result?.foodId).toBe(POWDER_ID);
        expect(result?.kcal).toBe(135);
        expect(telemetry.funnelStage).toBe('save_rejected');
        expect(telemetry.dropReason).toBe('save_rejected:scoop_powder_repick');
        expect(saveCalls()).toHaveLength(0);
    });

    it('the same pick under any other rerank reason is saved as before', async () => {
        rerankReturns('exact_match');
        const telemetry: MappingTelemetry = {};

        const result = (await mapIngredientWithFallback('1 scoop muscle milk chocolate', { telemetry })) as { foodId: string } | null;

        expect(result?.foodId).toBe(POWDER_ID);
        expect(telemetry.dropReason).not.toBe('save_rejected:scoop_powder_repick');
        expect(saveCalls()).toHaveLength(1);
    });
});
