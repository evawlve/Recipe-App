/**
 * The zero-calorie MARKER waiver in hasNullOrInvalidMacros().
 *
 * THE DEFECT (seat s366, measured live 2026-10-22). The all-zero branch deletes
 * any 0/0/0/0 panel whose NAME matches MUST_HAVE_CALORIES_PATTERNS, and those
 * lists carry `pepper`, `grape`, `cherry` and `sugar`. So fs_51053 "Diet Dr.
 * Pepper", fs_1627897 "Powerade Zero Grape", fs_35448222 "Pepsi Zero Sugar" and
 * fs_1683050 "Diet Cherry Coke (Can)" come back from the FatSecret lane at API
 * rank #1 for exactly those lines and are deleted before ranking. The waiver:
 * when the caller passes the raw line, an all-zero panel is NOT rejected if
 * ZERO_CAL_MARKER_RE matches BOTH the line and the candidate name.
 *
 * The same two-argument call was made at FOUR sites — the token filter, the
 * mapper's Step 3c, and both cache-validity reads — so a waiver at one alone
 * would be re-deleted (or the cached row escaped) by the next. Cases 8 and 9
 * pin the token filter and the cache reads through their callers.
 *
 * Fixture shapes as net-carb-macro-validation.test.ts; the panels are the
 * stored FatSecretFood panels (fs_51053: all four macros 0).
 */
import { mapIngredientWithFallback, type MappingTelemetry } from '../map-ingredient-with-fallback';
import { hasNullOrInvalidMacros, filterCandidatesByTokens, ZERO_CAL_MARKER_RE, candidateCoversZeroCalLine } from '../filter-candidates';
import type { UnifiedCandidate } from '../gather-candidates';
import { logger } from '../../logger';
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
import { callStructuredLlm } from '../../ai/structured-client';
import { prisma } from '../../db';

jest.mock('../../db', () => ({
    prisma: {
        $queryRaw: jest.fn().mockResolvedValue([]),
        fdcFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        offFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        fatSecretFood: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
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

// ── Why these last two mocks exist: this file used to reach the network ──────
//
// Every assertion below is about `telemetry.cacheEscape`, which is set in the
// Step 1a / Step 1c cache-validation blocks. But an ESCAPED hit does not end
// the call — the mapper falls through to full resolution, finds no candidates
// (gatherCandidates is stubbed to []), and runs its AI fallback chain
// (ai-simplify, then ai-nutrition-backfill). Both of those go through
// callStructuredLlm(), the single chokepoint for LLM traffic in the mapper,
// and ai-simplify.ts does `import 'dotenv/config'` at module scope — so the
// suite loaded the developer's real .env and billed live OpenRouter calls.
//
// MEASURED 2026-08-02 on clean master (`for i in $(seq 10); do npx jest
// src/lib/mapping/__tests__/fs-cache-nutrition-validation.test.ts; done`):
// 129 successful `openrouter / openai/gpt-4o-mini` round trips over 10 runs
// (~13 per run), each 810–3163 ms. Two or three of those land inside one
// `it()` against jest's 5000 ms default, so 10 of 10 runs failed, with a
// DIFFERENT set of 2–5 tests timing out each time. It was network latency,
// not slow code — the assertions themselves resolve in single-digit ms.
//
// So the fix is to remove the network, not to raise the timeout. Stubbing
// callStructuredLlm to return an error is exactly the shape CI already sees,
// where no API key is configured and getProviderChain() returns []: the
// fallback chain still runs, it just degrades instead of dialling out.
jest.mock('../../ai/structured-client', () => {
    const actual = jest.requireActual('../../ai/structured-client');
    return { ...actual, callStructuredLlm: jest.fn() };
});

// gather-candidates calls warmupEmbedder() at MODULE scope, and the
// requireActual above executes that module for real — starting an ONNX
// feature-extraction model load that outlives the run and produced the
// "Cannot log after tests are done" warnings. Same stub as
// src/lib/ai/__tests__/structured-schema-invariant.test.ts.
jest.mock('../../search/query-embedding', () => ({
    SEMANTIC_SEARCH_ENABLED: false,
    CORPUS_POOLING: 'cls',
    warmupEmbedder: jest.fn(),
    embedQuery: jest.fn().mockResolvedValue(null),
}));


const ALL_ZERO = { kcal: 0, protein: 0, carbs: 0, fat: 0 };

function cand(id: string, name: string, brandName?: string): UnifiedCandidate {
    return {
        id,
        source: 'fatsecret',
        name,
        brandName,
        score: 1,
        foodType: 'branded',
        nutrition: { per100g: true, ...ALL_ZERO } as any,
        rawData: { nutrientsPer100g: { calories: 0, protein: 0, carbs: 0, fat: 0 } },
    } as unknown as UnifiedCandidate;
}

describe('ZERO_CAL_MARKER_RE', () => {
    it.each(['diet dr pepper', 'powerade zero grape', 'sugar free monster', 'sugar-free creamer', 'no sugar', 'no-sugar jam'])(
        'matches %s', (s) => expect(ZERO_CAL_MARKER_RE.test(s)).toBe(true));
    it.each(['dr pepper', 'crushed red pepper', 'zerox', 'sugary cereal', 'no added sugar'])(
        'does not match %s', (s) => expect(ZERO_CAL_MARKER_RE.test(s)).toBe(false));
});

describe('hasNullOrInvalidMacros — the marker waiver needs the line AND the name', () => {
    it('(1) admits an all-zero "Diet Dr Pepper" for `diet dr pepper`', () => {
        expect(hasNullOrInvalidMacros(ALL_ZERO, 'Diet Dr Pepper', 'diet dr pepper')).toBe(false);
    });
    it('(2) still rejects it for a plain `dr pepper` — the LINE carries no marker', () => {
        expect(hasNullOrInvalidMacros(ALL_ZERO, 'Diet Dr Pepper', 'dr pepper')).toBe(true);
    });
    it('(3) admits an all-zero "Powerade Zero Grape" for `powerade zero grape`', () => {
        expect(hasNullOrInvalidMacros(ALL_ZERO, 'Powerade Zero Grape', 'powerade zero grape')).toBe(false);
    });
    it('(4) still rejects an all-zero "Crushed Red Pepper" for `diet pepper` — the NAME carries no marker', () => {
        expect(hasNullOrInvalidMacros(ALL_ZERO, 'Crushed Red Pepper', 'diet pepper')).toBe(true);
    });
    it('(5) still rejects the all-zero Freshii "Green Onion" for `diet green onion`', () => {
        expect(hasNullOrInvalidMacros(ALL_ZERO, 'Green Onion', 'diet green onion')).toBe(true);
    });
    it.each([
        ['Sugar Free Wild Cherry Soda', 'sugar free wild cherry soda'],
        ['Sugar-Free Grape Drink Mix', 'sugar-free grape drink mix'],
        ['No Sugar Cherry Seltzer', 'no sugar cherry seltzer'],
    ])('(6) admits all-zero "%s" for `%s`', (name, line) => {
        expect(hasNullOrInvalidMacros(ALL_ZERO, name, line)).toBe(false);
        // and the same candidate is rejected without the line — the waiver is what admits it
        expect(hasNullOrInvalidMacros(ALL_ZERO, name)).toBe(true);
    });
    it('(6) still rejects an all-zero "Apple Sauce" for `no sugar added applesauce` — the NAME carries no marker', () => {
        expect(hasNullOrInvalidMacros(ALL_ZERO, 'Apple Sauce', 'no sugar added applesauce')).toBe(true);
    });
    it('(6) an all-zero "Applesauce" is NOT rejected by any branch, with or without the line — the waiver is not involved', () => {
        // `applesauce` is one word: \bapple(s)?\b does not match inside it, so the
        // all-zero branch never runs, and the consistency check needs a non-zero
        // macro. Measured: false on base too. The waiver neither admits nor rejects it.
        expect(hasNullOrInvalidMacros(ALL_ZERO, 'Applesauce', 'no sugar added applesauce')).toBe(false);
        expect(hasNullOrInvalidMacros(ALL_ZERO, 'Applesauce')).toBe(false);
    });
    it('(7) a two-argument call is unchanged — rejects (1)\'s candidate', () => {
        expect(hasNullOrInvalidMacros(ALL_ZERO, 'Diet Dr Pepper')).toBe(true);
    });
    it('the waiver is all-zero only — a caloric panel with missing macros is still rejected', () => {
        expect(hasNullOrInvalidMacros({ kcal: 314, protein: 0, carbs: 0, fat: 2.86 }, 'Diet Lentil Zero', 'diet lentil zero')).toBe(true);
    });
});

describe('the waiver also needs the candidate NAME to cover the line (r2)', () => {
    // Winner gate c6970-zerocal (2026-10-25): with markers alone, all-zero
    // fs_1395249 "Propel Zero - Black Cherry" [Gatorade] was admitted for
    // `gatorade zero glacier cherry` and outranked the right record.
    it('rejects all-zero "Propel Zero - Black Cherry" for `gatorade zero glacier cherry` — no `glacier`', () => {
        expect(candidateCoversZeroCalLine('propel zero - black cherry', 'gatorade zero glacier cherry')).toBe(false);
        expect(hasNullOrInvalidMacros(ALL_ZERO, 'Propel Zero - Black Cherry', 'gatorade zero glacier cherry')).toBe(true);
    });
    it('admits all-zero "Zero Glacier Cherry (20 oz)" for the same line', () => {
        expect(hasNullOrInvalidMacros(ALL_ZERO, 'Zero Glacier Cherry (20 oz)', 'gatorade zero glacier cherry')).toBe(false);
    });
    it('admits "Diet Dr. Pepper" for `diet dr pepper` — `dr.` folds to `dr`', () => {
        expect(candidateCoversZeroCalLine('diet dr. pepper', 'diet dr pepper')).toBe(true);
        expect(hasNullOrInvalidMacros(ALL_ZERO, 'Diet Dr. Pepper', 'diet dr pepper')).toBe(false);
    });
    it('admits "Zero Grape (Bottle)" for `powerade zero grape bottle` — `bottle` is in the name', () => {
        expect(hasNullOrInvalidMacros(ALL_ZERO, 'Zero Grape (Bottle)', 'powerade zero grape bottle')).toBe(false);
    });
    it('`a can of diet coke` + all-zero "Diet Coke": not covered (`can`), but admitted anyway — the all-zero branch never runs', () => {
        // `can` is neither a unit in STOP_WORDS nor in WAIVER_STOPWORDS, so the
        // coverage helper says no. That does not matter here: "Diet Coke" matches
        // no MUST_HAVE_CALORIES_PATTERNS word, so it was never rejected — base too.
        expect(candidateCoversZeroCalLine('diet coke', 'a can of diet coke')).toBe(false);
        expect(hasNullOrInvalidMacros(ALL_ZERO, 'Diet Coke', 'a can of diet coke')).toBe(false);
        expect(hasNullOrInvalidMacros(ALL_ZERO, 'Diet Coke')).toBe(false);
    });
    it('drops numbers and units from the line: `2 tbsp sugar free grape jelly` is covered by "Sugar Free Grape Jelly"', () => {
        expect(hasNullOrInvalidMacros(ALL_ZERO, 'Sugar Free Grape Jelly', '2 tbsp sugar free grape jelly')).toBe(false);
    });
});

describe('(8) through filterCandidatesByTokens(): the token filter passes the line', () => {
    let infoSpy: jest.SpyInstance;
    beforeEach(() => { infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => undefined); });
    afterEach(() => infoSpy.mockRestore());

    const macroDrops = (candidateName: string) => infoSpy.mock.calls.filter(
        ([msg, meta]) => msg === 'filter.candidates.null_or_invalid_macros' && meta?.candidate === candidateName);

    it.each([
        ['fs_51053', 'Diet Dr. Pepper', 'Dr. Pepper', 'diet dr pepper'],
        ['fs_1627897', 'Powerade Zero Grape', 'Powerade', 'powerade zero grape'],
    ])('%s "%s" [%s] is not dropped by the macro rule for `%s`', (id, name, brand, line) => {
        const { filtered } = filterCandidatesByTokens([cand(id, name, brand)], line, { rawLine: line, debug: true });
        expect(macroDrops(name)).toHaveLength(0);
        expect(filtered.map(c => c.id)).toContain(id);
    });

    it('the same candidate IS dropped by the macro rule for a marker-less line (the spy can see a drop)', () => {
        filterCandidatesByTokens([cand('fs_51053', 'Diet Dr. Pepper', 'Dr. Pepper')], 'dr pepper', { rawLine: 'dr pepper', debug: true });
        expect(macroDrops('Diet Dr. Pepper')).toHaveLength(1);
    });
});

const dietDrPepperRow = {
    foodId: 'fs_51053',
    foodName: 'Diet Dr. Pepper',
    brandName: 'Dr. Pepper',
    source: 'fatsecret',
    confidence: 0.9,
};
const dietDrPepperFood = {
    fsId: '51053',
    name: 'Diet Dr. Pepper',
    brandName: 'Dr. Pepper',
    // the stored panel, verbatim (box, 2026-10-24)
    nutrientsPer100g: { fat: 0, carbs: 0, fiber: 0, sodium: 0.015, sugars: 0, protein: 0, calories: 0, saturatedFat: 0 },
    fetchedAt: new Date(),
    servings: [{ servingId: 's1', description: '1 can', grams: 355, isDefault: true, nutrients: { calories: 0, protein: 0, carbohydrate: 0, fat: 0 } }],
};

beforeEach(() => {
    jest.clearAllMocks();
    // clearAllMocks() is mockClear(), which resets recorded CALLS but leaves
    // mocked implementations in place — including an unconsumed
    // mockResolvedValueOnce() queue. Every test below arms
    // getValidatedMappingByNormalizedName with a `Once`, and a test that
    // returns down a shorter path than expected leaves its `Once` sitting in
    // the queue for the NEXT test to consume. (Verified on jest 29.7.0: a
    // queued-but-uncalled Once survives jest.clearAllMocks() and is returned by
    // the following test's first call.) That is a second, order-dependent
    // source of nondeterminism on top of the network one, and it is why the
    // failures used to cascade — a timed-out test poisoned its successor.
    // mockReset() is the one that drains the queue; only this mock needs it,
    // because the prisma stubs get their implementations from the module
    // factory and a blanket resetAllMocks() would wipe those.
    (getValidatedMappingByNormalizedName as jest.Mock).mockReset();
    (callStructuredLlm as jest.Mock).mockResolvedValue({
        status: 'error',
        error: 'llm disabled in unit tests',
        provider: 'openrouter',
        model: 'none',
        durationMs: 0,
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
    (prisma.fatSecretFood.findUnique as jest.Mock).mockResolvedValue(null);
});

describe('(9) the cache seats: a cached all-zero "Diet Dr. Pepper" does not escape as nutrition_invalid', () => {
    it('Step 1a early hit for `diet dr pepper`', async () => {
        (getValidatedMappingByNormalizedName as jest.Mock).mockResolvedValueOnce(dietDrPepperRow).mockResolvedValue(null);
        (prisma.fatSecretFood.findUnique as jest.Mock).mockResolvedValue(dietDrPepperFood);

        const telemetry: MappingTelemetry = {};
        await mapIngredientWithFallback('diet dr pepper', { minConfidence: 0, skipFdc: true, telemetry });

        expect(prisma.fatSecretFood.findUnique).toHaveBeenCalledWith(
            expect.objectContaining({ where: { fsId: '51053' } }),
        );
        expect(telemetry.cacheEscape).not.toBe('early:nutrition_invalid');
    });

    it('Step 1c normalized hit for `diet dr pepper`', async () => {
        (getValidatedMappingByNormalizedName as jest.Mock).mockResolvedValueOnce(null).mockResolvedValue(dietDrPepperRow);
        (prisma.fatSecretFood.findUnique as jest.Mock).mockResolvedValue(dietDrPepperFood);

        const telemetry: MappingTelemetry = {};
        await mapIngredientWithFallback('diet dr pepper', { minConfidence: 0, skipFdc: true, telemetry });

        expect(prisma.fatSecretFood.findUnique).toHaveBeenCalledWith(
            expect.objectContaining({ where: { fsId: '51053' } }),
        );
        expect(telemetry.cacheEscape).not.toBe('normalized:nutrition_invalid');
    });

    it('control: the same cached row for a marker-less `dr pepper` still escapes as nutrition_invalid', async () => {
        (getValidatedMappingByNormalizedName as jest.Mock).mockResolvedValueOnce(dietDrPepperRow).mockResolvedValue(null);
        (prisma.fatSecretFood.findUnique as jest.Mock).mockResolvedValue(dietDrPepperFood);

        const telemetry: MappingTelemetry = {};
        await mapIngredientWithFallback('dr pepper', { minConfidence: 0, skipFdc: true, telemetry });

        expect(telemetry.cacheEscape).toBe('early:nutrition_invalid');
    });
});
