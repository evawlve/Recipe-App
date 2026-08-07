/**
 * CHARACTERIZATION (Phase 1 stage 1c, cluster 3): the AI-simplify recursion's
 * TWO exit disciplines in `mapIngredientWithFallback()`.
 *
 * These tests pin CURRENT behavior so the stage-1d extraction is provably
 * behavior-preserving. They assert what the code DOES, not what it should do.
 *
 * The producer under test is Step 2b-ii: no winner anywhere -> the mapper calls
 * `aiSimplifyIngredient()` and RE-ENTERS itself with the simplified name and
 * `_skipFallback: true`. The inner frame runs the full cascade (so it saves
 * under the SIMPLIFIED name's key when its own confidence clears the gate).
 * Back in the outer frame there are two different exits:
 *
 *   (i)  REHYDRATION SUCCESS — `hydrateAndSelectServing(fallbackCandidate,
 *        originalParsed, ...)` returns a result and the outer frame returns it
 *        DIRECTLY (`return rehydratedResult`). No outer save, no
 *        `finalizeAndSaveResult()`, and therefore NO sanity caps: a 50 kg
 *        rehydrated result comes back to the caller unchecked.
 *
 *   (ii) REHYDRATION FAILURE — `winner = fallbackCandidate`,
 *        `selectionReason = 'fallback_simplified: <rationale>'`, and the flow
 *        continues through the COMMON TAIL: Step 5 hydration retries, then
 *        `finalizeAndSaveResult()`, which saves under the ORIGINAL line's key
 *        (and applies the sanity caps AFTER the save).
 *
 * Plus the dietary-prefix sibling (Step 2b-i): a `gluten-free X` line whose
 * recursion succeeds is returned AS-IS (`return dietaryFallbackResult`) — no
 * rehydration call at all, and `aiSimplifyIngredient()` is never reached.
 *
 * HOW THE INNER FRAMES ARE DECIDED (both recursions, verified by the save
 * pins): the mocked `simpleRerank` names the winner. Each recursion pool is a
 * token-twin pair ('Roast Beef' / 'Beef Roast'), so `confidenceGate` finds no
 * clear margin between them and declines to pre-empt; the mock's pick, reason
 * ('simple_rerank') and confidence (0.9) flow through to the inner save
 * unaltered — the agreement lift never fires because the gate named nobody.
 * An earlier revision of this file used SIMPLIFIED = 'chicken breast', which
 * `normalizeIngredientName()` rewrites to 'skinless chicken breast' (hardcoded
 * rule in normalization-rules.ts); that evicted the exact-match candidate in
 * `filterCandidatesByTokens` and routed the inner frame through the
 * `confidence_gate_backstop` on the surviving sibling — a fixture artifact the
 * current fixture ('roast beef', probed to pass normalization untouched)
 * removes. Both the simplify and the dietary inner frames are now
 * rerank-decided, symmetrically.
 *
 * Mock preamble follows the house pattern (abstention-confidence.test.ts /
 * llm-output-guard-wiring.test.ts): Proxy prisma answering "nothing found" for
 * every model and verb, `gatherCandidates` keyed on the raw line so the inner
 * frame gets a pool the outer frame does not, `simpleRerank` returning a winner
 * only when the pool contains one, the stage-1a seam
 * `../serving/hydration-lane` intercepting ALL mapper hydration call sites,
 * and `../mapping-logger` automocked so a run writes no
 * logs/mapping-analysis-*.json or mapping-summary-*.txt files.
 *
 * A failure here after 1d means the extraction changed one of these disciplines
 * — most likely by routing a direct-return exit through a save/caps path it has
 * never taken.
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

// Generic prisma stub: every model answers "nothing found" for any verb. The
// Proxy shape (vs an enumerated model list) is deliberate — omitting a
// serving-store model fails DEEP in the cascade mimicking a production bug
// (warned in map-ingredient-with-fallback.test.ts's own header).
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

// The Mac .env sets ENABLE_MAPPING_ANALYSIS=true; unmocked, every run writes
// logs/mapping-analysis-*.json + mapping-summary-*.txt session files from
// inside jest. Bare automock suffices (producer-cache-failure-research.test.ts
// proves it).
jest.mock('../mapping-logger');

jest.mock('../gather-candidates', () => {
    const actual = jest.requireActual('../gather-candidates');
    return { ...actual, gatherCandidates: (...a: unknown[]) => mockGatherCandidates(...a) };
});

jest.mock('../simple-rerank', () => {
    const actual = jest.requireActual('../simple-rerank');
    return { ...actual, simpleRerank: (...a: unknown[]) => mockSimpleRerank(...a) };
});

// The stage-1a seam: the mapper imports hydrateAndSelectServing from the lane,
// so this one mock intercepts every hydration call site in BOTH frames.
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

// AI_NUTRITION_BACKFILL_ENABLED defaults TRUE — an unmocked backfill dials the
// jest LLM blackhole and fails as a confusing ECONNREFUSED.
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

// The single LLM chokepoint, blackholed deterministically (house rule: there is
// deliberately no env-var bypass; jest.setup.no-llm.js blanks the credentials).
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

// ── Fixture lines ───────────────────────────────────────────────────────────
// ORIGINAL is chosen so the outer frame's own search finds nothing (the gather
// mock only serves pools for the two recursion lines) and so no dietary prefix
// fires. SIMPLIFIED / DIETARY_STRIPPED are the lines the two recursions re-enter
// with, and are the gather mock's keys. SIMPLIFIED must pass
// normalizeIngredientName() UNCHANGED or the derived search query stops
// matching the pool names ('chicken breast' -> 'skinless chicken breast' is the
// probed counterexample; 'roast beef' round-trips identical).
const ORIGINAL = 'mystery cutlet platter';
const SIMPLIFIED = 'roast beef';
const DIETARY_LINE = 'gluten-free mystery platter';
const DIETARY_STRIPPED = 'mystery platter';

/** An FDC candidate carrying its own plausible panel, so filters keep it. */
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

// Fresh arrays per call: the mapper enriches candidate objects in place.
// Each pool is a TOKEN-TWIN pair (same tokens, swapped order): both survive
// filterCandidatesByTokens (no missing and no extra tokens), and the gate
// scores them without a clear margin, so it declines to pre-empt and the
// mocked simpleRerank decides. A bloat sibling ('... Deluxe') would risk
// eviction and a single-candidate pool would hand the gate a clear winner.
const roastBeefPool = () => [
    cand('fdc_1111111', 'Roast Beef', 5.0, { kcal: 180, protein: 28, carbs: 0, fat: 7 }),
    cand('fdc_2222222', 'Beef Roast', 4.0, { kcal: 190, protein: 26, carbs: 2, fat: 9 }),
];
const mysteryPool = () => [
    cand('fdc_1111111', 'Mystery Platter', 5.0, { kcal: 200, protein: 10, carbs: 20, fat: 8 }),
    cand('fdc_2222222', 'Platter Mystery', 4.0, { kcal: 210, protein: 11, carbs: 21, fat: 9 }),
];

/** A hydrated-result stub. servingTier is a REAL tier string (never invented). */
const mkResult = (
    foodName: string,
    rawLine: string,
    overrides: Partial<FatsecretMappedIngredient> = {},
): FatsecretMappedIngredient => ({
    source: 'fdc',
    foodId: 'fdc_1111111',
    foodName,
    brandName: null,
    servingId: null,
    servingDescription: '100 g',
    grams: 100,
    kcal: 165,
    protein: 31,
    carbs: 0,
    fat: 3.6,
    confidence: 1,
    quality: 'high',
    rawLine,
    servingTier: 'flat_100g_default',
    ...overrides,
});

const map = (line: string) =>
    mapIngredientWithFallback(line) as Promise<FatsecretMappedIngredient | null>;

const saveCalls = () => mockSave.mock.calls;
/** rawLine of every saveValidatedMapping call, in order. */
const saveLines = () => saveCalls().map((c) => c[0] as string);
/** The aiHydrationBudget argument (positional arg 5) of every hydrate call. */
const hydrateBudgets = () => mockHydrate.mock.calls.map((c) => c[4]);

beforeEach(() => {
    jest.clearAllMocks();
    mockLookupByName.mockResolvedValue(null);
    mockGetAiNormalizeCache.mockResolvedValue(null);
    mockSave.mockResolvedValue(undefined);
    // Rule-based normalization only; the LLM normalize lane stays cold.
    mockShouldNormalize.mockReturnValue({ shouldCallLlm: false, reason: 'test_skips_llm_normalize', confidence: 0.9 });
    mockRequestAiNutrition.mockResolvedValue({ status: 'error', reason: 'backfill_disabled_in_test' });
    mockGetAiServingGrams.mockResolvedValue(null);
    mockAiSimplify.mockResolvedValue({ simplified: SIMPLIFIED, rationale: 'test rationale' });
    // Winner only when the pool has fdc_1111111 — i.e. only in an inner frame.
    // 'simple_rerank' is a reason string the real reranker produces. This mock
    // GENUINELY DECIDES both inner frames: the token-twin pools give the gate
    // no clear margin, so it never pre-empts, and the inner saves carry this
    // mock's reason and confidence verbatim (pinned below).
    mockSimpleRerank.mockImplementation((_q: string, cands: Array<{ id: string }>) => {
        const winner = cands.find((c) => c.id === 'fdc_1111111') ?? null;
        return winner
            ? { winner, confidence: 0.9, reason: 'simple_rerank', sortedCandidates: cands }
            : { winner: null, confidence: 0, reason: 'no_candidates', sortedCandidates: [] };
    });
    // Retrieval keyed on the RAW LINE: the outer lines find nothing, the two
    // recursion lines each find their pool.
    mockGatherCandidates.mockImplementation(async (raw: string) =>
        raw === SIMPLIFIED ? roastBeefPool() : raw === DIETARY_STRIPPED ? mysteryPool() : []);
    (hydrateSingleCandidate as jest.Mock).mockResolvedValue(true);
});

describe('AI-simplify exit (i): rehydration success returns directly', () => {
    it('returns the rehydrated result as-is; the only save is the INNER frame\'s, under the SIMPLIFIED key; sanity caps never run', async () => {
        const innerResult = mkResult('Roast Beef', SIMPLIFIED, { confidence: 1 });
        // grams 50000 > MAX_REASONABLE_GRAMS(10000): if the outer frame ran
        // finalizeAndSaveResult() this would come back null. It does not —
        // the direct-return exit bypasses the caps entirely.
        const rehydrated = mkResult('Roast Beef', ORIGINAL, { grams: 50000, kcal: 300, confidence: 0.72 });
        // Keyed on candidate id AND rawLine. The id alone cannot separate the
        // frames — the outer fallbackCandidate's id IS the inner result's
        // foodId (fdc_1111111) by construction — but keying on it means a
        // wrong inner winner gets null back and fails loudly, instead of the
        // mock laundering it into the expected result.
        mockHydrate.mockImplementation(async (c: { id: string }, _p: unknown, _conf: unknown, rawLine: string) => {
            if (c.id !== 'fdc_1111111') return null;
            return rawLine === SIMPLIFIED ? innerResult : rehydrated;
        });

        const res = await map(ORIGINAL);

        // Same object reference: `return rehydratedResult;` — no finalize wrap.
        expect(res).toBe(rehydrated);
        expect(res!.grams).toBe(50000);

        // The simplify recursion happened, once, on the original trimmed line.
        expect(mockAiSimplify).toHaveBeenCalledTimes(1);
        expect(mockAiSimplify.mock.calls[0][0]).toBe(ORIGINAL);
        // The inner frame searched the SIMPLIFIED name.
        expect(mockGatherCandidates.mock.calls.some((c) => c[0] === SIMPLIFIED)).toBe(true);

        // Fixture health: the rerank pool STILL CONTAINS the exact-match id —
        // i.e. filterCandidatesByTokens did not evict it (the failure mode the
        // old 'chicken breast' fixture had), so the mock's pick is a genuine
        // decision over both candidates.
        expect(mockSimpleRerank).toHaveBeenCalled();
        const rerankPoolIds = (mockSimpleRerank.mock.calls[0][1] as Array<{ id: string }>).map((c) => c.id);
        expect(rerankPoolIds).toContain('fdc_1111111');

        // Exactly TWO hydrations: inner Step 5 on the rerank winner, then the
        // outer rehydration of the fallback candidate against the ORIGINAL
        // parsed input. Both carry the winner's id.
        expect(mockHydrate).toHaveBeenCalledTimes(2);
        expect((mockHydrate.mock.calls[0][0] as { id: string }).id).toBe('fdc_1111111');
        expect(mockHydrate.mock.calls[0][3]).toBe(SIMPLIFIED);
        expect((mockHydrate.mock.calls[1][0] as { id: string }).id).toBe('fdc_1111111');
        expect(mockHydrate.mock.calls[1][3]).toBe(ORIGINAL);

        // Cross-frame budget forwarding (census invariant): aiHydrationBudget
        // is explicitly forwarded past the options spread into the recursion,
        // so the inner frame's hydration and the outer rehydration receive the
        // SAME object, not a fresh per-frame allowance.
        expect(hydrateBudgets()[0]).toBeDefined();
        expect(hydrateBudgets()[1]).toBe(hydrateBudgets()[0]);

        // ONE save total, and it is the INNER frame's: rawLine and cache key
        // both belong to the SIMPLIFIED name. The outer frame saves nothing.
        // Reason and confidence are the rerank MOCK's own values, passed
        // through unaltered — proof the mocked rerank (not the gate backstop,
        // and not the agreement lift, which would have raised the number)
        // decided the inner frame.
        expect(mockSave).toHaveBeenCalledTimes(1);
        expect(saveLines()).toEqual([SIMPLIFIED]);
        expect(saveCalls()[0][2]).toMatchObject({ approved: true, confidence: 0.9, reason: 'simple_rerank' });
        expect(String(saveCalls()[0][3].canonicalBase)).toContain('beef');
        expect(saveLines()).not.toContain(ORIGINAL);
    });
});

describe('AI-simplify exit (ii): rehydration failure flows through the common tail', () => {
    /**
     * Sequencing: call 1 = inner Step 5 (succeeds), call 2 = outer rehydration
     * (FAILS -> winner = fallbackCandidate), call 3 = outer Step 5 on that
     * winner (succeeds -> finalize). The outer frame reads the inner RESULT
     * object's confidence (fbr.confidence — what hydration returned, here 1.0
     * from mkResult), NOT the inner frame's selection confidence (the rerank
     * mock's 0.9): fallbackCandidate.score = 1.0 * 0.85 = 0.85, which clears
     * the >=0.85 save gate, so the outer save is observable.
     */
    const wireExitTwo = (tailResult: FatsecretMappedIngredient) => {
        const innerResult = mkResult('Roast Beef', SIMPLIFIED, { confidence: 1 });
        let outerCalls = 0;
        mockHydrate.mockImplementation(async (c: { id: string }, _p: unknown, _conf: unknown, rawLine: string) => {
            if (c.id !== 'fdc_1111111') return null;
            if (rawLine === SIMPLIFIED) return innerResult;
            outerCalls += 1;
            return outerCalls === 1 ? null : tailResult;
        });
    };

    it('saves TWICE — inner frame under the SIMPLIFIED key, outer finalize under the ORIGINAL key with reason fallback_simplified', async () => {
        const tailResult = mkResult('Roast Beef', ORIGINAL, { confidence: 0.85 });
        wireExitTwo(tailResult);

        const res = await map(ORIGINAL);

        // The common tail's finalize returns the hydrated result object as-is.
        expect(res).toBe(tailResult);

        // Three hydrations: inner Step 5, failed outer rehydration, outer Step 5.
        expect(mockHydrate).toHaveBeenCalledTimes(3);
        expect((mockHydrate.mock.calls[0][0] as { id: string }).id).toBe('fdc_1111111');
        expect(mockHydrate.mock.calls[0][3]).toBe(SIMPLIFIED);
        expect(mockHydrate.mock.calls[1][3]).toBe(ORIGINAL);
        expect(mockHydrate.mock.calls[2][3]).toBe(ORIGINAL);
        expect((mockHydrate.mock.calls[2][0] as { id: string }).id).toBe('fdc_1111111');
        // The outer frame re-bills at fallbackCandidate.score = fbr.confidence * 0.85.
        expect(mockHydrate.mock.calls[2][2]).toBe(0.85);

        // One budget object threads through ALL THREE hydrations (census
        // invariant: explicitly forwarded past the options spread).
        expect(hydrateBudgets()[0]).toBeDefined();
        expect(hydrateBudgets()[1]).toBe(hydrateBudgets()[0]);
        expect(hydrateBudgets()[2]).toBe(hydrateBudgets()[0]);

        // TWO saves: the inner frame's (simplified key, at the rerank mock's
        // confidence and reason), then the outer finalize's (ORIGINAL key,
        // fallback_simplified reason).
        expect(mockSave).toHaveBeenCalledTimes(2);
        expect(saveLines()).toEqual([SIMPLIFIED, ORIGINAL]);
        expect(saveCalls()[0][2]).toMatchObject({ approved: true, confidence: 0.9, reason: 'simple_rerank' });
        const outerSave = saveCalls()[1];
        expect(outerSave[2]).toMatchObject({
            approved: true,
            confidence: 0.85,
            reason: 'fallback_simplified: test rationale',
        });
        // The outer save's key belongs to the ORIGINAL name-space, not the
        // simplified one.
        expect(String(outerSave[3].canonicalBase)).not.toContain('beef');
    });

    it('DOES apply the sanity caps exit (i) bypasses — and the save happens BEFORE the cap rejects the result', async () => {
        // Same absurd grams as the exit (i) test. There it came back to the
        // caller; here the common tail's finalize nulls it — but only AFTER
        // offering it to the cache. That ordering is current behavior; pin it.
        const tailResult = mkResult('Roast Beef', ORIGINAL, { grams: 50000, kcal: 300, confidence: 0.85 });
        wireExitTwo(tailResult);

        const res = await map(ORIGINAL);

        expect(res).toBeNull();
        expect(saveLines()).toEqual([SIMPLIFIED, ORIGINAL]);
        expect(saveCalls()[1][1]).toBe(tailResult);
    });
});

describe('the dietary-prefix sibling (Step 2b-i) short-circuits before AI-simplify', () => {
    it('returns the recursion result AS-IS — no rehydration, no simplify call, save only under the STRIPPED name', async () => {
        const dietaryInner = mkResult('Mystery Platter', DIETARY_STRIPPED, { confidence: 1 });
        mockHydrate.mockImplementation(async (c: { id: string }, _p: unknown, _conf: unknown, rawLine: string) =>
            rawLine === DIETARY_STRIPPED && c.id === 'fdc_1111111' ? dietaryInner : null);

        const res = await map(DIETARY_LINE);

        // `return dietaryFallbackResult;` — the inner frame's object, unwrapped
        // and NOT rehydrated against the original parsed input (unlike the
        // simplify path, which does rehydrate).
        expect(res).toBe(dietaryInner);
        expect(mockHydrate).toHaveBeenCalledTimes(1);
        expect(mockHydrate.mock.calls[0][3]).toBe(DIETARY_STRIPPED);

        // AI-simplify was never consulted.
        expect(mockAiSimplify).not.toHaveBeenCalled();

        // One save, the inner frame's, under the stripped line — decided by
        // the mocked rerank, same as the simplify arm (the token-twin pool
        // keeps the gate from pre-empting here too).
        expect(mockSave).toHaveBeenCalledTimes(1);
        expect(saveLines()).toEqual([DIETARY_STRIPPED]);
        expect(saveCalls()[0][2]).toMatchObject({ approved: true, confidence: 0.9, reason: 'simple_rerank' });
        expect(saveLines()).not.toContain(DIETARY_LINE);
    });
});
