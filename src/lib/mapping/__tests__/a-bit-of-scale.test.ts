/**
 * The AMOUNT-HEDGE scale at the exported exit of `mapIngredientWithFallback()`.
 *
 * Mock preamble and fixtures follow `producer-simplify-exits.test.ts`: the
 * lower layers are mocked and the real core runs, so the wrapper is exercised
 * through the real export (the core is module-private). Hydration is the stage-1a
 * seam, which decides the result (tier included) the core returns.
 */
const mockGatherCandidates = jest.fn();
const mockSimpleRerank = jest.fn();
const mockHydrate = jest.fn();
const mockSave = jest.fn();
const mockLookupByName = jest.fn();
const mockGetAiNormalizeCache = jest.fn();
const mockAiSimplify = jest.fn();
const mockShouldNormalize = jest.fn();
const mockRequestAiNutrition = jest.fn();
const mockGetAiServingGrams = jest.fn();

jest.mock('../../db', () => {
    const emptyFor = (verb: string) =>
        jest.fn().mockResolvedValue(verb.startsWith('findMany') ? [] : null);
    const model = new Proxy({}, { get: (_t, verb: string) => emptyFor(verb) });
    return { prisma: new Proxy({}, { get: () => model }) };
});

jest.mock('../../search/query-embedding', () => ({
    SEMANTIC_SEARCH_ENABLED: false,
    CORPUS_POOLING: 'cls',
    warmupEmbedder: jest.fn(),
    embedQuery: jest.fn().mockResolvedValue(null),
}));

jest.mock('../mapping-logger');

jest.mock('../gather-candidates', () => {
    const actual = jest.requireActual('../gather-candidates');
    return { ...actual, gatherCandidates: (...a: unknown[]) => mockGatherCandidates(...a) };
});

jest.mock('../simple-rerank', () => {
    const actual = jest.requireActual('../simple-rerank');
    return { ...actual, simpleRerank: (...a: unknown[]) => mockSimpleRerank(...a) };
});

jest.mock('../serving/hydration-lane', () => {
    const actual = jest.requireActual('../serving/hydration-lane');
    return { ...actual, hydrateAndSelectServing: (...a: unknown[]) => mockHydrate(...a) };
});

jest.mock('../validated-mapping-helpers', () => {
    const actual = jest.requireActual('../validated-mapping-helpers');
    return {
        ...actual,
        getValidatedMapping: jest.fn().mockResolvedValue(null),
        getValidatedMappingByNormalizedName: (...a: unknown[]) => mockLookupByName(...a),
        saveValidatedMapping: (...a: unknown[]) => mockSave(...a),
        getAiNormalizeCache: (...a: unknown[]) => mockGetAiNormalizeCache(...a),
        saveAiNormalizeCache: jest.fn().mockResolvedValue(undefined),
        trackValidationFailure: jest.fn().mockResolvedValue(undefined),
    };
});

jest.mock('../ai-simplify', () => {
    const actual = jest.requireActual('../ai-simplify');
    return { ...actual, aiSimplifyIngredient: (...a: unknown[]) => mockAiSimplify(...a) };
});

jest.mock('../ai-nutrition-backfill', () => ({
    requestAiNutrition: (...a: unknown[]) => mockRequestAiNutrition(...a),
    extractBaseFoodContext: jest.fn().mockReturnValue(null),
    getAiServingGrams: (...a: unknown[]) => mockGetAiServingGrams(...a),
    createAiNutritionBudget: (max: number) => ({ remaining: max, spent: 0 }),
}));

jest.mock('../normalize-gate', () => {
    const actual = jest.requireActual('../normalize-gate');
    return { ...actual, shouldNormalizeLlm: (...a: unknown[]) => mockShouldNormalize(...a) };
});

jest.mock('../ai-normalize', () => {
    const actual = jest.requireActual('../ai-normalize');
    return {
        ...actual,
        aiNormalizeIngredient: jest.fn().mockResolvedValue({ status: 'error', reason: 'llm_disabled_in_test' }),
    };
});

jest.mock('../hydrate-cache');
jest.mock('../deferred-hydration');
jest.mock('../ai-backfill', () => ({
    insertAiServing: jest.fn().mockResolvedValue({ success: false, reason: 'disabled_in_test' }),
    backfillWeightServing: jest.fn().mockResolvedValue({ success: false, reason: 'disabled_in_test' }),
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
import type { UnifiedCandidate } from '../gather-candidates';
import { hydrateSingleCandidate } from '../hydrate-cache';

// A line the outer frame finds nothing for: the gather mock serves pools only
// for the lines the dietary recursion re-enters with.
const HEDGE = 'a little bit of mystery platter';
const HEDGE_DIETARY = 'a little bit of sugar free mystery platter';
const HEDGE_DIETARY_STRIPPED = 'a little bit of mystery platter';
const PLAIN = 'mystery platter';

const cand = (
    id: string,
    name: string,
    score: number,
    macros: { kcal: number; protein: number; carbs: number; fat: number },
): UnifiedCandidate => ({
    id,
    source: 'fdc',
    name,
    brandName: null,
    score,
    nutrition: { ...macros, per100g: true },
    servings: [{ description: '100 g', grams: 100, isDefault: true }],
    rawData: {
        fdcId: Number(id.replace('fdc_', '')),
        description: name,
        dataType: 'SR Legacy',
        nutrientsPer100g: { calories: macros.kcal, protein: macros.protein, carbs: macros.carbs, fat: macros.fat },
        servings: [],
    },
} as unknown as UnifiedCandidate);

// The hedge words stay in the query on the solo path, so the token-twin pool
// carries them too (both survive filterCandidatesByTokens; the gate finds no
// clear margin and the mocked rerank decides).
const mysteryPool = (a: string, b: string) => [
    cand('fdc_1111111', a, 5.0, { kcal: 200, protein: 10, carbs: 20, fat: 8 }),
    cand('fdc_2222222', b, 4.0, { kcal: 210, protein: 11, carbs: 21, fat: 9 }),
];
const POOLS: Record<string, () => UnifiedCandidate[]> = {
    [HEDGE]: () => mysteryPool('A Little Bit Of Mystery Platter', 'Platter Mystery Of Bit Little A'),
    [HEDGE_DIETARY_STRIPPED]: () => mysteryPool('A Little Bit Of Mystery Platter', 'Platter Mystery Of Bit Little A'),
    [PLAIN]: () => mysteryPool('Mystery Platter', 'Platter Mystery'),
};

const mkResult = (
    rawLine: string,
    overrides: Partial<FatsecretMappedIngredient> = {},
): FatsecretMappedIngredient => ({
    source: 'fdc',
    foodId: 'fdc_1111111',
    foodName: 'Mystery Platter',
    brandName: null,
    servingId: null,
    servingDescription: '1 platter (110 g)',
    grams: 110,
    kcal: 220,
    protein: 11,
    carbs: 22,
    fat: 8.8,
    confidence: 1,
    quality: 'high',
    rawLine,
    servingTier: 'bare_label_serving',
    ...overrides,
});

/** Hydration returns `result` for the rerank winner, whatever line the frame carries. */
const hydrateReturns = (result: FatsecretMappedIngredient | null) => {
    mockHydrate.mockImplementation(async (c: { id: string }) => (c.id === 'fdc_1111111' ? result : null));
};

const map = (line: string) => mapIngredientWithFallback(line) as Promise<FatsecretMappedIngredient | null>;

beforeEach(() => {
    jest.clearAllMocks();
    mockLookupByName.mockResolvedValue(null);
    mockGetAiNormalizeCache.mockResolvedValue(null);
    mockSave.mockResolvedValue(undefined);
    mockShouldNormalize.mockReturnValue({ shouldCallLlm: false, reason: 'test_skips_llm_normalize', confidence: 0.9 });
    mockRequestAiNutrition.mockResolvedValue({ status: 'error', reason: 'backfill_disabled_in_test' });
    mockGetAiServingGrams.mockResolvedValue(null);
    mockAiSimplify.mockResolvedValue(null);
    mockSimpleRerank.mockImplementation((_q: string, cands: Array<{ id: string }>) => {
        const winner = cands.find((c) => c.id === 'fdc_1111111') ?? null;
        return winner
            ? { winner, confidence: 0.9, reason: 'simple_rerank', sortedCandidates: cands }
            : { winner: null, confidence: 0, reason: 'no_candidates', sortedCandidates: [] };
    });
    // Retrieval keyed on the RAW LINE: the dietary line finds nothing, so the
    // recursion on the stripped line is what answers.
    mockGatherCandidates.mockImplementation(async (raw: string) => (POOLS[raw] ? POOLS[raw]() : []));
    (hydrateSingleCandidate as jest.Mock).mockResolvedValue(true);
});

describe('amount-hedge scale at the mapper export', () => {
    it('scales a hedged normal-tier hit ONCE to half, as a NEW object, leaving non-gram fields alone', async () => {
        const core = mkResult(HEDGE);
        hydrateReturns(core);

        const res = await map(HEDGE);

        expect(res).not.toBe(core);
        expect(res!.grams).toBeCloseTo(55, 6);
        expect(res!.kcal).toBeCloseTo(110, 6);
        expect(res!.protein).toBeCloseTo(5.5, 6);
        expect(res!.carbs).toBeCloseTo(11, 6);
        expect(res!.fat).toBeCloseTo(4.4, 6);
        // Every other field is unchanged.
        const { grams, kcal, protein, carbs, fat, ...restOut } = res!;
        const { grams: g0, kcal: k0, protein: p0, carbs: c0, fat: f0, ...restCore } = core;
        expect([grams, kcal, protein, carbs, fat]).not.toEqual([g0, k0, p0, c0, f0]);
        expect(restOut).toEqual(restCore);
        expect(res!.servingTier).toBe('bare_label_serving');
        expect(res!.servingDescription).toBe('1 platter (110 g)');
        // The core's own object is never mutated (lock waiters share results).
        expect(core.grams).toBe(110);
        expect(core.kcal).toBe(220);
    });

    it('the dietary-prefix recursion scales ONCE (F, not F squared)', async () => {
        const core = mkResult(HEDGE_DIETARY_STRIPPED);
        hydrateReturns(core);

        const res = await map(HEDGE_DIETARY);

        // The recursion actually ran on the stripped line, which keeps the hedge.
        expect(mockGatherCandidates.mock.calls.some((c) => c[0] === HEDGE_DIETARY_STRIPPED)).toBe(true);
        expect(res).not.toBeNull();
        expect(res!.grams).toBeCloseTo(55, 6); // 110 * 0.5, not 110 * 0.25
        expect(res!.kcal).toBeCloseTo(110, 6);
    });

    it.each([
        ['a floor tier', 'flat_100g_default'],
        ['the count floor', 'count_unresolved_floor'],
    ])('leaves %s unscaled and returns the core\'s own object', async (_label, tier) => {
        const core = mkResult(HEDGE, { servingTier: tier, grams: 100, kcal: 200 });
        hydrateReturns(core);

        const res = await map(HEDGE);

        expect(res).toBe(core);
        expect(res!.grams).toBe(100);
    });

    it('leaves a null (absent) tier unscaled and returns the core\'s own object', async () => {
        const core = mkResult(HEDGE, { servingTier: undefined, grams: 100, kcal: 200 });
        hydrateReturns(core);

        const res = await map(HEDGE);

        expect(res).toBe(core);
        expect(res!.grams).toBe(100);
    });

    it('returns the core\'s own object for a non-hedge line', async () => {
        const core = mkResult(PLAIN);
        hydrateReturns(core);

        const res = await map(PLAIN);

        expect(res).toBe(core);
        expect(res!.grams).toBe(110);
    });

    it('passes a null core result through', async () => {
        mockHydrate.mockResolvedValue(null);
        mockGatherCandidates.mockResolvedValue([]);

        const res = await map(HEDGE);

        expect(res).toBeNull();
    });
});
