/**
 * C70: the AI normalizer / simplifier echoing its own prompt example for a line that names
 * no food. LLM mocked at the callStructuredLlm() chokepoint; no DB (empty Proxy prisma).
 *
 * Callers of aiNormalizeIngredient() that inherit the guard without a test of their own:
 * `auto-map.ts` and `pattern-learner.ts`.
 */

const mockGatherCandidates = jest.fn();
const mockShouldNormalize = jest.fn();
const mockAiNormalize = jest.fn();
const mockAiSimplify = jest.fn();
const mockCallLlm = jest.fn();
const mockGetCache = jest.fn();
const mockSaveCache = jest.fn();

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
jest.mock('../validated-mapping-helpers', () => {
    const actual = jest.requireActual('../validated-mapping-helpers');
    return {
        ...actual,
        getValidatedMapping: jest.fn().mockResolvedValue(null),
        getValidatedMappingByNormalizedName: jest.fn().mockResolvedValue(null),
        saveValidatedMapping: jest.fn().mockResolvedValue(undefined),
        getAiNormalizeCache: (...a: unknown[]) => mockGetCache(...a),
        saveAiNormalizeCache: (...a: unknown[]) => mockSaveCache(...a),
        trackValidationFailure: jest.fn().mockResolvedValue(undefined),
    };
});
jest.mock('../ai-simplify', () => {
    const actual = jest.requireActual('../ai-simplify');
    return {
        ...actual,
        aiSimplifyIngredient: (...a: unknown[]) => mockAiSimplify(...a),
        __actualSimplify: actual.aiSimplifyIngredient,
    };
});
jest.mock('../ai-normalize', () => {
    const actual = jest.requireActual('../ai-normalize');
    return {
        ...actual,
        aiNormalizeIngredient: (...a: unknown[]) => mockAiNormalize(...a),
        __actualNormalize: actual.aiNormalizeIngredient,
    };
});
jest.mock('../normalize-gate', () => {
    const actual = jest.requireActual('../normalize-gate');
    return { ...actual, shouldNormalizeLlm: (...a: unknown[]) => mockShouldNormalize(...a) };
});
jest.mock('../ai-nutrition-backfill', () => ({
    requestAiNutrition: jest.fn().mockResolvedValue({ status: 'error', reason: 'backfill_disabled_in_test' }),
    extractBaseFoodContext: jest.fn().mockReturnValue(null),
    getAiServingGrams: jest.fn().mockResolvedValue(null),
    createAiNutritionBudget: (max: number) => ({ remaining: max, spent: 0 }),
}));
jest.mock('../hydrate-cache');
jest.mock('../deferred-hydration');
jest.mock('../ai-backfill', () => ({
    insertAiServing: jest.fn().mockResolvedValue({ success: false, reason: 'disabled_in_test' }),
    backfillWeightServing: jest.fn().mockResolvedValue({ success: false, reason: 'disabled_in_test' }),
}));
jest.mock('../../ai/structured-client', () => {
    const actual = jest.requireActual('../../ai/structured-client');
    return { ...actual, callStructuredLlm: (...a: unknown[]) => mockCallLlm(...a) };
});

import { isPromptExampleEcho, PROMPT_EXAMPLE_IDENTITIES } from '../llm-output-guards';
import { mapIngredientWithFallback } from '../map-ingredient-with-fallback';
import { requestAiNutrition } from '../ai-nutrition-backfill';

const actualNormalize = (jest.requireMock('../ai-normalize') as {
    __actualNormalize: (raw: string, cleaned?: string) => Promise<any>;
}).__actualNormalize;
const actualSimplify = (jest.requireMock('../ai-simplify') as {
    __actualSimplify: (raw: string, brand?: string | null) => Promise<any>;
}).__actualSimplify;

const COLBY = 'reduced fat colby jack cheese';
const BERRY = 'strawberry halves';

describe('isPromptExampleEcho()', () => {
    it.each([
        ['from the 24 hour diner', COLBY],
        ['scoops', BERRY],
        ['maybe a few spoonfuls', BERRY],
        ['everything', COLBY],
        ['Scoops', 'Strawberry Halves '],
    ])('TRUE: %s -> %s', (input, answer) => {
        expect(isPromptExampleEcho(input, answer)).toBe(true);
    });

    it.each([
        [COLBY, COLBY],
        ['colby jack', COLBY],
        ['2 cup stberry halves', BERRY],
        ['fresas', 'fresas'],
        ['media taza de fresas', 'fresas'],
        ['chiken brest', 'chicken breast'],
        ['grilled chicken breast', 'grilled chicken breast'],
        ['reduced fat colbi jack', COLBY],
        ['scoops', 'strawberries'],
    ])('FALSE: %s -> %s', (input, answer) => {
        expect(isPromptExampleEcho(input, answer)).toBe(false);
    });

    it('the closed list is the two echoed normalized_name identities, never strawberries', () => {
        expect([...PROMPT_EXAMPLE_IDENTITIES]).toEqual([COLBY, BERRY]);
    });
});

const normalizeAnswer = (name: string, canonical?: string) => ({
    status: 'success',
    content: {
        normalized_name: name,
        canonical_base: canonical,
        prep_phrases: [],
        size_phrases: [],
        synonyms: [],
        nutrition_estimate: { calories_per_100g: 280, protein_per_100g: 24, carbs_per_100g: 3, fat_per_100g: 19, confidence: 0.8 },
    },
});

describe('aiNormalizeIngredient()', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetCache.mockResolvedValue(null);
        mockSaveCache.mockResolvedValue(undefined);
    });

    it('a fresh echo answer -> status error, NOT saved', async () => {
        mockCallLlm.mockResolvedValue(normalizeAnswer(COLBY));
        const r = await actualNormalize('from the 24 hour diner');
        expect(r).toEqual({ status: 'error', reason: 'prompt_example_echo' });
        expect(mockSaveCache).not.toHaveBeenCalled();
    });

    it('a cached echo row -> status error, no LLM call', async () => {
        mockGetCache.mockResolvedValue({
            normalizedName: BERRY, canonicalBase: 'strawberries', synonyms: [], prepPhrases: [], sizePhrases: [],
            isBranded: false, isMultiIngredient: false,
        });
        const r = await actualNormalize('scoops');
        expect(r).toEqual({ status: 'error', reason: 'prompt_example_echo' });
        expect(mockCallLlm).not.toHaveBeenCalled();
    });

    it('a real answer is unchanged and saved (fresas keeps canonical_base strawberries)', async () => {
        mockCallLlm.mockResolvedValue(normalizeAnswer('fresas', 'strawberries'));
        const r = await actualNormalize('fresas');
        expect(r.status).toBe('success');
        expect(r.normalizedName).toBe('fresas');
        expect(r.canonicalBase).toBe('strawberries');
        expect(mockSaveCache).toHaveBeenCalledTimes(1);
    });

    it('a legitimate typo input that gets the example identity is kept', async () => {
        mockCallLlm.mockResolvedValue(normalizeAnswer(BERRY, 'strawberries'));
        const r = await actualNormalize('stberry halves');
        expect(r.status).toBe('success');
    });
});

describe('aiSimplifyIngredient()', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetCache.mockResolvedValue(null);
        mockSaveCache.mockResolvedValue(undefined);
    });

    it('a fresh colby-jack echo -> null, NOT saved', async () => {
        mockCallLlm.mockResolvedValue({ status: 'success', content: { simplified: 'Reduced Fat Colby Jack Cheese', rationale: 'x' } });
        expect(await actualSimplify('from the 24 hour diner')).toBeNull();
        expect(mockSaveCache).not.toHaveBeenCalled();
    });

    it('a cached colby-jack echo row -> null', async () => {
        mockGetCache.mockResolvedValue({ normalizedName: 'Reduced Fat Colby Jack Cheese' });
        expect(await actualSimplify('from the 24 hour diner')).toBeNull();
        expect(mockCallLlm).not.toHaveBeenCalled();
    });

    it('a real simplification is unchanged; the example asked for is kept', async () => {
        mockCallLlm.mockResolvedValue({ status: 'success', content: { simplified: 'Pancake Mix', rationale: 'x' } });
        expect(await actualSimplify('buttermilk pancake mix light')).toEqual({ simplified: 'Pancake Mix', rationale: 'x' });
        mockCallLlm.mockResolvedValue({ status: 'success', content: { simplified: 'Reduced Fat Colby Jack Cheese', rationale: 'x' } });
        expect(await actualSimplify('reduced fat colby and monterey jack cheese')).toEqual({
            simplified: 'Reduced Fat Colby Jack Cheese', rationale: 'x',
        });
    });
});

describe('mapIngredientWithFallback() on an echo', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetCache.mockResolvedValue(null);
        mockGatherCandidates.mockResolvedValue([]);
        mockShouldNormalize.mockReturnValue({ shouldCallLlm: true, reason: 'test', confidence: 0.5 });
        mockAiSimplify.mockResolvedValue(null);
    });

    it('from the 24 hour diner -> unresolved (null); simplify and AI nutrition NOT called', async () => {
        mockAiNormalize.mockResolvedValue({ status: 'error', reason: 'prompt_example_echo' });
        const telemetry = {} as any;
        const r = await mapIngredientWithFallback('from the 24 hour diner', { telemetry });
        expect(r).toBeNull();
        expect(mockAiNormalize).toHaveBeenCalled();
        expect(mockAiSimplify).not.toHaveBeenCalled();
        expect(requestAiNutrition).not.toHaveBeenCalled();
        expect(telemetry.dropReason).toContain('prompt_example_echo');
    });

    it('fresas -> the unchanged path (a non-echo normalize does not short-circuit)', async () => {
        mockAiNormalize.mockResolvedValue({
            status: 'success', normalizedName: 'fresas', canonicalBase: 'strawberries', prepPhrases: [],
            sizePhrases: [], synonyms: [], isBranded: false, isMultiIngredient: false,
        });
        await mapIngredientWithFallback('fresas');
        expect(mockAiSimplify).toHaveBeenCalled();
    });

    it('an ordinary normalize error (not an echo) still falls through to simplify', async () => {
        mockAiNormalize.mockResolvedValue({ status: 'error', reason: 'test' });
        await mapIngredientWithFallback('a bacon butty');
        expect(mockAiSimplify).toHaveBeenCalled();
    });
});
