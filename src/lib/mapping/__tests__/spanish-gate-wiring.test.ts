/**
 * WIRING test for the Spanish gate OR-clause (C6970 D30): with shouldNormalizeLlm() mocked to
 * `{ shouldCallLlm: false }` (a high-scoring hit that would skip the normalizer), a Spanish line
 * still calls aiNormalizeIngredient() with `{ spanish: true }` and an English line does not call it.
 * Mock preamble copied from llm-output-guard-wiring.test.ts.
 */

import { mapIngredientWithFallback } from '../map-ingredient-with-fallback';
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
import { shouldNormalizeLlm } from '../normalize-gate';
import { detectBrandInQuery } from '../brand-detector';

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
jest.mock('../ai-nutrition-backfill', () => ({
    requestAiNutrition: jest.fn().mockResolvedValue({ status: 'error', reason: 'skip' }),
    extractBaseFoodContext: jest.fn().mockReturnValue(null),
    getAiServingGrams: jest.fn().mockResolvedValue(null),
    createAiNutritionBudget: (max: number) => ({ remaining: max, spent: 0 }),
}));

/** Every normalizedName handed to retrieval, in call order. */
function gatherNames(): string[] {
    return (gatherCandidates as jest.Mock).mock.calls.map((c) => c[2]);
}

/** The GatherOptions handed to retrieval, in call order. */
function gatherOpts(): any[] {
    return (gatherCandidates as jest.Mock).mock.calls.map((c) => c[3] ?? {});
}

/**
 * The branded flag on the full gather for the ORIGINAL line.
 *
 * Deliberately the FIRST call that carries the flag, not the last. The quick
 * gate gather omits the option entirely, and on a miss the mapper re-enters via
 * `mapping.fallback_simplification` with a SIMPLIFIED line whose brand has been
 * stripped — so a last-call assertion reads a different query's flag and passes
 * for the wrong reason.
 */
function fullGatherIsBrandedQuery(): boolean | undefined {
    const withFlag = gatherOpts().filter((o) => 'isBrandedQuery' in o);
    return withFlag[0]?.isBrandedQuery;
}

beforeEach(() => {
    jest.clearAllMocks();
    (shouldNormalizeLlm as jest.Mock).mockReturnValue({
        shouldCallLlm: false,
        reason: 'test_high_confidence',
        confidence: 0.9,
    });
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

describe('Spanish lines force the normalize call', () => {
    it('calls aiNormalizeIngredient with {spanish:true} for `dos huevos` although the gate says skip', async () => {
        await mapIngredientWithFallback('dos huevos');
        const calls = (aiNormalizeIngredient as jest.Mock).mock.calls;
        expect(calls.length).toBeGreaterThan(0);
        expect(calls[0][2]).toEqual({ spanish: true });
    });

    it('reads the RAW line: `dos tazas de leche` (baseName `leche`) is Spanish', async () => {
        await mapIngredientWithFallback('dos tazas de leche');
        const calls = (aiNormalizeIngredient as jest.Mock).mock.calls;
        expect(calls.length).toBeGreaterThan(0);
        expect(calls[0][2]).toEqual({ spanish: true });
    });

    it('does NOT call aiNormalizeIngredient for `two eggs` when the gate says skip', async () => {
        await mapIngredientWithFallback('two eggs');
        expect(aiNormalizeIngredient).not.toHaveBeenCalled();
    });

    it('an English line the gate DOES fire on calls it with the original two arguments only', async () => {
        (shouldNormalizeLlm as jest.Mock).mockReturnValue({ shouldCallLlm: true, reason: 'test', confidence: 0.9 });
        await mapIngredientWithFallback('pico de gallo');
        const calls = (aiNormalizeIngredient as jest.Mock).mock.calls;
        expect(calls.length).toBeGreaterThan(0);
        expect(calls[0]).toHaveLength(2);
    });
});
