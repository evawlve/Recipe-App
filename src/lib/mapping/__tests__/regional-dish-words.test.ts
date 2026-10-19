/**
 * C70 row 4: regional (UK/AU) dish words are rewritten to their American form before
 * retrieval, the cache keys AND the LLM stages.
 *
 * Control `cleaned` values were read from origin/master ffe31cc8 BEFORE the change and are
 * hard-coded below (all identical to the input at that commit).
 *
 * M1 seam pinned: jest.mock of './ai-normalize' and './ai-simplify' with the real
 * mapIngredientWithFallback() driven end to end over an empty Proxy prisma (no DB); the
 * assertion is on the arguments those two LLM entry points receive.
 */

const mockGatherCandidates = jest.fn();
const mockShouldNormalize = jest.fn();
const mockAiNormalize = jest.fn();
const mockAiSimplify = jest.fn();
const mockConfidenceGate = jest.fn();

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
    return {
        ...actual,
        gatherCandidates: (...a: unknown[]) => mockGatherCandidates(...a),
        confidenceGate: (...a: unknown[]) => { mockConfidenceGate(...a); return (actual.confidenceGate as (...x: unknown[]) => unknown)(...a); },
    };
});
jest.mock('../validated-mapping-helpers', () => {
    const actual = jest.requireActual('../validated-mapping-helpers');
    return {
        ...actual,
        getValidatedMapping: jest.fn().mockResolvedValue(null),
        getValidatedMappingByNormalizedName: jest.fn().mockResolvedValue(null),
        saveValidatedMapping: jest.fn().mockResolvedValue(undefined),
        getAiNormalizeCache: jest.fn().mockResolvedValue(null),
        saveAiNormalizeCache: jest.fn().mockResolvedValue(undefined),
        trackValidationFailure: jest.fn().mockResolvedValue(undefined),
    };
});
jest.mock('../ai-simplify', () => {
    const actual = jest.requireActual('../ai-simplify');
    return { ...actual, aiSimplifyIngredient: (...a: unknown[]) => mockAiSimplify(...a) };
});
jest.mock('../ai-normalize', () => {
    const actual = jest.requireActual('../ai-normalize');
    return { ...actual, aiNormalizeIngredient: (...a: unknown[]) => mockAiNormalize(...a) };
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
    return {
        ...actual,
        callStructuredLlm: jest.fn().mockResolvedValue({
            status: 'error', error: 'llm disabled in unit tests', provider: 'openrouter', model: 'none', durationMs: 0,
        }),
    };
});

import { normalizeIngredientName, rewriteRegionalDishWords } from '../normalization-rules';
import { mapIngredientWithFallback } from '../map-ingredient-with-fallback';

const TARGETS: Array<[string, string, string]> = [
    ["a bacon butty", "a bacon sandwich", "butty"],
    ["bacon butties", "bacon sandwiches", "butties"],
    ["a cuppa", "a tea", "cuppa"],
    ["cuppa with milk and one sugar", "tea with milk and one sugar", "cuppa"],
    ["two bickies", "two cookies", "bickies"],
    ["chicken parmy and chips", "chicken parmigiana and chips", "parmy"],
    ["chicken parma", "chicken parmigiana", "parma"]
];

const CONTROLS: Array<[string, string]> = [
    ["chip butty", "chip butty"],
    ["a cuppa joe", "a cuppa joe"],
    ["a cuppa of coffee", "a cuppa of coffee"],
    ["cuppa noodles", "cuppa noodles"],
    ["parma ham", "parma ham"],
    ["prosciutto di parma", "prosciutto di parma"],
    ["chicken parma ham", "chicken parma ham"],
    ["biscuits and gravy", "biscuits and gravy"],
    ["bojangles biscuit", "bojangles biscuit"],
    ["butter", "butter"],
    ["buttery popcorn", "buttery popcorn"],
    ["stir fry", "stir fry"],
    ["english breakfast tea", "english breakfast tea"],
    ["a full english fry up", "a full english fry up"],
    ["a cheese toastie", "a cheese toastie"],
    ["wotsits cheese toastie", "wotsits cheese toastie"],
    ["tortilla chips", "tortilla chips"],
    ["butternut squash", "butternut squash"]
];

describe('rewriteRegionalDishWords()', () => {
    it.each(TARGETS)('%s -> %s', (input, expected) => {
        expect(rewriteRegionalDishWords(input)).toBe(expected);
    });

    it.each(TARGETS)('is idempotent on %s', (input) => {
        const once = rewriteRegionalDishWords(input);
        expect(rewriteRegionalDishWords(once)).toBe(once);
    });

    it.each(CONTROLS)('leaves %s byte-identical', (input) => {
        expect(rewriteRegionalDishWords(input)).toBe(input);
    });

    it('is case-insensitive and handles the remaining table words', () => {
        expect(rewriteRegionalDishWords('A Bacon BUTTY')).toBe('A Bacon sandwich');
        expect(rewriteRegionalDishWords('ham sarnies')).toBe('ham sandwiches');
        expect(rewriteRegionalDishWords('a cuppa tea')).toBe('a tea tea');
        expect(rewriteRegionalDishWords('three cuppas')).toBe('three teas');
        expect(rewriteRegionalDishWords('a bicky and two biccies')).toBe('a cookie and two cookies');
        expect(rewriteRegionalDishWords('veal parmi')).toBe('veal parmigiana');
        expect(rewriteRegionalDishWords('eggplant parma')).toBe('eggplant parmigiana');
        expect(rewriteRegionalDishWords('chips butty')).toBe('chips butty');
    });
});

describe('normalizeIngredientName() carries the rewrite', () => {
    // `cuppa with milk and one sugar` is excluded: detectBrandInQuery() reads `one` (the ONE bar
    // brand) in `one sugar`, so the brand-led early return fires before the rewrite. Pre-existing,
    // and the brief keeps that early return first; pinned below as a known skip, not a fix.
    it.each(TARGETS.filter(([input]) => !input.includes('one sugar')))('%s: cleaned has the American word and not the regional one', (input, expected, regional) => {
        const { cleaned } = normalizeIngredientName(input);
        expect(cleaned).toContain(expected.split(' ').find((w) => !input.split(' ').includes(w)) as string);
        expect(cleaned).not.toMatch(new RegExp(`\\b${regional}\\b`, 'i'));
    });

    it('KNOWN SKIP: a brand-led line (`one sugar` reads as the ONE brand) keeps its regional word in cleaned', () => {
        expect(normalizeIngredientName('cuppa with milk and one sugar').cleaned).toBe('cuppa with milk and one sugar');
        expect(normalizeIngredientName('a cuppa with milk').cleaned).toBe('a tea with milk');
    });

    it.each(CONTROLS)('%s: cleaned equals the origin/master value', (input, masterCleaned) => {
        expect(normalizeIngredientName(input).cleaned).toBe(masterCleaned);
    });
});

describe('M1: the LLM stages receive the rewritten text', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGatherCandidates.mockResolvedValue([]);
        mockShouldNormalize.mockReturnValue({ shouldCallLlm: false, reason: 'test', confidence: 0.9 });
        mockAiNormalize.mockResolvedValue({ status: 'error', reason: 'test' });
        mockAiSimplify.mockResolvedValue(null);
    });

    it.each([
        ['a cuppa', 'tea', 'cuppa'],
        ['a bacon butty', 'sandwich', 'butty'],
    ])('aiNormalizeIngredient(%s) gets the American word', async (line, american, regional) => {
        mockShouldNormalize.mockReturnValue({ shouldCallLlm: true, reason: 'test', confidence: 0.5 });
        await mapIngredientWithFallback(line);
        expect(mockAiNormalize).toHaveBeenCalled();
        const baseNameArg = mockAiNormalize.mock.calls[0][0] as string;
        expect(baseNameArg).toContain(american);
        expect(baseNameArg).not.toContain(regional);
    });

    it.each([
        ['a cuppa', 'tea', 'cuppa'],
        ['a bacon butty', 'sandwich', 'butty'],
    ])('aiSimplifyIngredient(%s) gets the American word', async (line, american, regional) => {
        await mapIngredientWithFallback(line);
        expect(mockAiSimplify).toHaveBeenCalled();
        const trimmedArg = mockAiSimplify.mock.calls[0][0] as string;
        expect(trimmedArg).toContain(american);
        expect(trimmedArg).not.toContain(regional);
    });
});

describe('fold: parsed.name (searchQuery) carries the rewrite', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGatherCandidates.mockResolvedValue([]);
        mockShouldNormalize.mockReturnValue({ shouldCallLlm: false, reason: 'test', confidence: 0.9 });
        mockAiNormalize.mockResolvedValue({ status: 'error', reason: 'test' });
        mockAiSimplify.mockResolvedValue(null);
    });

    // Seam spied: the `parsed` argument (2nd) handed to gatherCandidates(), which is the
    // preflight parsed whose .name feeds searchQuery -> confidenceGate / assessConfidence / rerankQuery.
    const parsedNames = () => mockGatherCandidates.mock.calls.map((c) => (c[1] as { name?: string } | null)?.name);

    it.each([
        ['bickies', 'cookies'],
        ['two bickies', 'cookies'],
        ['a cuppa', 'tea'],
        ['a bacon butty', 'bacon sandwich'],
        ['chicken parmy and chips', 'parmigiana'],
    ])('%s -> parsed.name contains %s', async (line, american) => {
        await mapIngredientWithFallback(line);
        const names = parsedNames().filter(Boolean) as string[];
        expect(names.length).toBeGreaterThan(0);
        expect(names.every((n) => n.includes(american))).toBe(true);
        expect(names.some((n) => /\b(bickies|cuppa|butty|parmy)\b/i.test(n))).toBe(false);
    });

    it.each(['chip butty', 'parma ham', 'a cuppa joe', 'two cookies'])('control %s: parsed.name unchanged', async (line) => {
        await mapIngredientWithFallback(line);
        const names = parsedNames().filter(Boolean) as string[];
        expect(names.length).toBeGreaterThan(0);
        for (const n of names) expect(n).toBe(rawParsedName(line));
    });
});

// parsed.name as parseIngredientLine() gives it (no rewrite involved for the controls).
import { parseIngredientLine } from '../../parse/ingredient-line';
function rawParsedName(line: string): string | undefined {
    return parseIngredientLine(line)?.name;
}
