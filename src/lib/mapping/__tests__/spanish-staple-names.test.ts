/**
 * s459 ES-BARE-STAPLE (MEDIA-LUNA is one member): Spanish staple names reach retrieval, the cache keys
 * and the LLM stages in English, so they stop winning same-named branded records (`media luna` ->
 * a LUNA bar, `sal` -> salted butter, `cafe` -> a 462 kcal/100 g "Cafe", `cerveza` -> an 8.5 kcal/100 g
 * "Cerveza", `vino tinto` -> a chorizo). Measured cold on deploy 44 (`1FcoqURbnti8xu8neHcFv`).
 *
 * Seams pinned: the pure rewrite; its ride on rewriteRegionalDishWords() (preflight parsed.name and
 * the LLM inputs); and the baseName seat in mapIngredientWithFallback() that covers the segmenter's
 * normalizedForm, read as the 3rd argument handed to gatherCandidates() (the retrieval query).
 * Mock preamble copied from regional-dish-words.test.ts.
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

import { rewriteRegionalDishWords } from '../normalization-rules';
import { rewriteSpanishStapleNames, SPANISH_STAPLE_WHOLE_NAMES } from '../spanish-staple-names';
import { mapIngredientWithFallback } from '../map-ingredient-with-fallback';
import { detectBrandInQuery } from '../brand-detector';

const TARGETS: Array<[string, string]> = [
    ['media luna', 'croissant'],
    ['una media luna', 'croissant'],
    ['medias lunas', 'croissants'],
    ['medialuna', 'croissant'],
    ['Medialunas de manteca', 'croissants de manteca'],
    ['media luna de chocolate', 'croissant de chocolate'],
    ['media-luna', 'croissant'],
    ['sal', 'salt'],
    ['cafe', 'coffee'],
    ['Café', 'coffee'],
    ['un café', 'coffee'],
    ['cerveza', 'beer'],
    ['una cerveza', 'beer'],
    ['las cervezas', 'beers'],
    ['vino', 'wine'],
    ['vino tinto', 'red wine'],
    ['un vino tinto', 'red wine'],
    ['vino blanco', 'white wine'],
    ['vinos', 'wine'],
    ['piña', 'pineapple'],
    ['una papa', 'potato'],
    ['té verde', 'green tea'],
    // s462 STAPLE2
    ['dulce', 'candy'],
    ['un dulce', 'candy'],
    ['dulces', 'candy'],
    ['chocolate caliente', 'hot chocolate'],
    ['un chocolate caliente', 'hot chocolate'],
];

// Byte-identical: every one is a real English or Spanish line whose longer name must survive, or a
// Luna Bar line the brand must keep.
const CONTROLS: string[] = [
    'luna', 'luna bar', '1 luna bar chocolate', 'luna protein bar', 'half moon cookie',
    'cafe con leche', 'cafe latte', 'premier protein cafe latte', 'a cafe au lait', 'healthy choice cafe steamers',
    'chorizo al vino tinto', 'sal de mar', 'sal y pimienta', 'salsa', 'salt', 'coffee', 'beer', 'croissant',
    'pan', 'un pan', 'pan dulce', 'queso', 'te', 'un te', 'cuernito', 'una corona', 'corona', 'cerveza corona',
    'vinegar', 'salami', 'medium coffee', 'a cuppa',
    'piña colada', 'papa johns pizza', 'papas fritas', 'papas', 'ron', 'ron zacapa', 'te verde matcha latte',
    // s462 STAPLE2: a longer name keeps `dulce` / `chocolate caliente`, and bare `chocolate` is not hot chocolate.
    'dulce de leche', 'una cucharada de dulce de leche', 'papa dulce', 'agua dulce', 'un dulce de tamarindo', 'chocolate',
    'chocolate caliente con malvaviscos', 'leche con chocolate caliente', 'candy', 'hot chocolate',
];

describe('rewriteSpanishStapleNames()', () => {
    it.each(TARGETS)('%s -> %s', (input, expected) => {
        expect(rewriteSpanishStapleNames(input)).toBe(expected);
    });

    it.each(TARGETS)('is idempotent on %s', (input) => {
        const once = rewriteSpanishStapleNames(input);
        expect(rewriteSpanishStapleNames(once)).toBe(once);
    });

    it.each(CONTROLS)('leaves %s byte-identical', (input) => {
        expect(rewriteSpanishStapleNames(input)).toBe(input);
    });

    it('every table entry is what the rewrite does', () => {
        for (const [es, en] of Object.entries(SPANISH_STAPLE_WHOLE_NAMES)) expect(rewriteSpanishStapleNames(es)).toBe(en);
        for (const [es, en] of [['media luna', 'croissant'], ['medias lunas', 'croissants'], ['medialuna', 'croissant'], ['medialunas', 'croissants']]) {
            expect(rewriteSpanishStapleNames(es)).toBe(en);
        }
    });
});

describe('detectBrandInQuery(): `luna` inside a staple phrase is not the Luna Bar brand', () => {
    it.each(['media luna', 'una media luna', 'media luna de chocolate', 'Media Luna con jamon y queso'])('%s: no brand', (line) => {
        expect(detectBrandInQuery(line)).toEqual({ isBranded: false, matchedBrand: null });
    });
    it.each(['dulce', 'un dulce', '2 dulces', 'chocolate caliente', 'una taza de chocolate caliente'])('s462 %s: no brand, so no mask', (line) => {
        expect(detectBrandInQuery(line)).toEqual({ isBranded: false, matchedBrand: null });
    });
    it.each(['luna', 'luna bar', '1 luna bar chocolate', 'luna protein bar'])('%s: still the luna brand', (line) => {
        expect(detectBrandInQuery(line).matchedBrand?.toLowerCase()).toBe('luna');
    });
});

describe('rewriteRegionalDishWords() carries it, and its UK/AU table is unchanged', () => {
    it.each(TARGETS)('%s -> %s', (input, expected) => {
        expect(rewriteRegionalDishWords(input)).toBe(expected);
    });
    it('UK/AU words still rewrite', () => {
        expect(rewriteRegionalDishWords('a bacon butty')).toBe('a bacon sandwich');
        expect(rewriteRegionalDishWords('chip butty')).toBe('chip butty');
    });
});

describe('the mapper retrieves the English name (parsed.name, baseName, the normalize input)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGatherCandidates.mockResolvedValue([]);
        mockShouldNormalize.mockReturnValue({ shouldCallLlm: true, reason: 'test', confidence: 0.5 });
        mockAiNormalize.mockResolvedValue({ status: 'error', reason: 'test' });
        mockAiSimplify.mockResolvedValue(null);
    });
    const parsedNames = () => mockGatherCandidates.mock.calls.map((c) => (c[1] as { name?: string } | null)?.name).filter(Boolean) as string[];
    const queries = () => mockGatherCandidates.mock.calls.map((c) => c[2] as string);

    it.each([
        ['media luna', 'croissant'],
        ['una media luna', 'croissant'],
        ['2 medias lunas', 'croissants'],
        ['sal', 'salt'],
        ['cafe', 'coffee'],
        ['una cerveza', 'beer'],
        ['vino tinto', 'red wine'],
        ['un dulce', 'candy'],
        ['chocolate caliente', 'hot chocolate'],
    ])('solo line %s: every retrieval query, parsed.name and the normalize input read %s', async (line, english) => {
        await mapIngredientWithFallback(line);
        expect(queries().length).toBeGreaterThan(0);
        expect(queries().every((q) => q === english)).toBe(true);
        expect(parsedNames().every((n) => n === english)).toBe(true);
        expect(mockAiNormalize).toHaveBeenCalled();
        expect(mockAiNormalize.mock.calls[0][0]).toBe(english);
    });

    it.each([
        ['una media luna', 'media luna', 'croissant'],
        ['12 onzas de cerveza', 'cerveza', 'beer'],
    ])('segmenter item %s (normalizedForm %s): the retrieval query is %s', async (line, nf, english) => {
        await mapIngredientWithFallback(line, { normalizedForm: nf });
        expect(queries().length).toBeGreaterThan(0);
        expect(queries().every((q) => q === english)).toBe(true);
        expect(mockAiNormalize.mock.calls[0][0]).toBe(english);
    });

    // baseName (not only normalizedName) carries the English word: GENERIC_FALLBACKS reads baseName, so the
    // segmenter's `vino` gets the English `wine` line's query (`white wine`), as the solo line `vino` does.
    it.each([
        ['un vino', 'vino'],
        ['vino', undefined],
        ['wine', undefined],
    ])('%s (normalizedForm %s) retrieves white wine, like English `wine`', async (line, nf) => {
        await mapIngredientWithFallback(line, nf ? { normalizedForm: nf } : {});
        expect(queries().length).toBeGreaterThan(0);
        expect(queries().every((q) => q === 'white wine')).toBe(true);
    });

    it.each([
        ['luna bar', 'luna bar'],
        ['luna protein bar', 'luna protein bar'],
        ['cafe con leche', 'cafe con leche'],
        ['chorizo al vino tinto', 'chorizo al vino tinto'],
    ])('control %s keeps its own name in retrieval', async (line, name) => {
        await mapIngredientWithFallback(line);
        expect(queries().length).toBeGreaterThan(0);
        expect(queries().every((q) => q === name)).toBe(true);
    });
});
