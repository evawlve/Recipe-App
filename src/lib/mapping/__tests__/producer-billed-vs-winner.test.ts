/**
 * Phase 1 stage 1c — CLUSTER 4: billed foodId ≠ winner.id via the
 * serving-failure fallback loop (`fallback_after_serving_failure`).
 *
 * CHARACTERIZATION ONLY. These tests pin what the mapper cascade in
 * `map-ingredient-with-fallback.ts` does TODAY, so the stage-1d extraction can
 * be proven behavior-preserving. A failure here after 1d means 1d changed
 * behavior; a failure here before 1d is a transcription error in this file.
 *
 * The path under pin (post-selection result-swapper #1, the census's V4):
 *   Step 2–4 search selects `winner` (candidate A) via simpleRerank;
 *   Step 5 `hydrateAndSelectServing(winner, …)` fails;
 *   the fallback loop walks `filtered` (NOT the rerank order), skipping the
 *   winner, capped at 3 candidates, and rebinds `result` — while `winner`
 *   stays stale. `finalizeAndSaveResult()` reads `result`, so the SAVE and the
 *   RETURN both carry the fallback candidate's identity, not the winner's.
 *   This is the sharpest pin against a 1d Selection-object design keyed on
 *   `winner`.
 *
 * Three different "confidence" values coexist on this path, and the pins keep
 * them apart:
 *   - the loop hydrates fallbacks at `confidence * 0.95` (argument only —
 *     never written back to `confidence`);
 *   - `finalizeAndSaveResult()`/`saveValidatedMapping()` receive the OUTER
 *     `confidence` (the rerank winner's, unmultiplied);
 *   - the RETURNED object is the hydration lane's result verbatim, so the
 *     caller-visible `confidence` field is whatever the lane wrote into it.
 *
 * Mock seams are the house set (see abstention-confidence.test.ts /
 * map-ingredient-with-fallback.test.ts) plus the stage-1a seam:
 * `../serving/hydration-lane` intercepts all mapper hydration call sites.
 */

const mockGatherCandidates = jest.fn();
const mockConfidenceGate = jest.fn();
const mockSimpleRerank = jest.fn();
const mockHydrate = jest.fn();
const mockSaveValidatedMapping = jest.fn();
const mockRequestAiNutrition = jest.fn();
const mockGetAiServingGrams = jest.fn();

// Generic prisma stub: every model answers "nothing found" for any verb.
// A Proxy rather than a hand-enumerated model list — omitting a serving-store
// model (aiGeneratedServing/fdcServing/offServing/userPortionOverride) fails
// deep in the cascade mimicking a production bug (warned in the canonical
// map-ingredient-with-fallback.test.ts header).
jest.mock('../../db', () => {
    const emptyFor = (verb: string) =>
        jest.fn().mockResolvedValue(verb.startsWith('findMany') ? [] : null);
    const model = new Proxy({}, { get: (_t, verb: string) => emptyFor(verb) });
    return { prisma: new Proxy({}, { get: () => model }) };
});

jest.mock('../gather-candidates', () => {
    const actual = jest.requireActual('../gather-candidates');
    return {
        ...actual,
        gatherCandidates: (...a: unknown[]) => mockGatherCandidates(...a),
        // Forced non-skip so `gateSelection` is undefined and the winner +
        // confidence come solely from the mocked simpleRerank (the real gate
        // would exit `high_confidence_clear_winner` on an exact-name pool and
        // lift the confidence via the agreement branch).
        confidenceGate: (...a: unknown[]) => mockConfidenceGate(...a),
    };
});

jest.mock('../simple-rerank', () => {
    const actual = jest.requireActual('../simple-rerank');
    return { ...actual, simpleRerank: (...a: unknown[]) => mockSimpleRerank(...a) };
});

// Stage-1a seam: the mapper imports hydrateAndSelectServing from the lane, so
// this single mock intercepts the winner hydration AND every fallback retry.
jest.mock('../serving/hydration-lane', () => {
    const actual = jest.requireActual('../serving/hydration-lane');
    return { ...actual, hydrateAndSelectServing: (...a: unknown[]) => mockHydrate(...a) };
});

jest.mock('../validated-mapping-helpers', () => {
    const actual = jest.requireActual('../validated-mapping-helpers');
    return { ...actual, saveValidatedMapping: (...a: unknown[]) => mockSaveValidatedMapping(...a) };
});

// AI_NUTRITION_BACKFILL_ENABLED defaults TRUE — unmocked, an exhausted
// fallback loop dials the jest LLM blackhole (ECONNREFUSED).
jest.mock('../ai-nutrition-backfill', () => {
    const actual = jest.requireActual('../ai-nutrition-backfill');
    return {
        ...actual,
        requestAiNutrition: (...a: unknown[]) => mockRequestAiNutrition(...a),
        getAiServingGrams: (...a: unknown[]) => mockGetAiServingGrams(...a),
    };
});

// The mapper's analysis branches execute only when ENABLE_MAPPING_ANALYSIS is
// set (read from process.env at module load). The Mac .env sets it =true, and
// unmocked that writes a logs/mapping-analysis-*.json session file from inside
// jest — so only the sink is stubbed; the branches run whenever the env says so.
jest.mock('../mapping-logger', () => ({
    ...jest.requireActual('../mapping-logger'),
    logMappingAnalysis: jest.fn(),
}));

// Parity with the simplify suite: without this, the mapper's fire-and-forget
// deferred hydration (queueForDeferredHydration / proactiveProduceBackfill)
// runs for real against the Proxy prisma — an unawaited promise doing
// DB-shaped work after the test resolves. Bare automock suffices.
jest.mock('../deferred-hydration');

jest.mock('../../search/query-embedding', () => ({
    SEMANTIC_SEARCH_ENABLED: false,
    CORPUS_POOLING: 'cls',
    warmupEmbedder: jest.fn(),
    embedQuery: jest.fn().mockResolvedValue(null),
}));

import {
    mapIngredientWithFallback,
    type FatsecretMappedIngredient,
} from '../map-ingredient-with-fallback';
import type { UnifiedCandidate } from '../gather-candidates';
import type { MappingTelemetry } from '../map-ingredient-with-fallback';
import { AI_NUTRITION_BACKFILL_ENABLED } from '../config';

/** FDC candidate with an inline panel; hydration itself is mocked. */
const cand = (id: string, name: string, score: number): UnifiedCandidate => ({
    id,
    source: 'fdc',
    name,
    brandName: null,
    score,
    nutrition: { kcal: 379, protein: 13, carbs: 68, fat: 6.5, per100g: true },
    servings: [{ description: '100 g', grams: 100, isDefault: true }],
    rawData: {
        fdcId: Number(id.replace('fdc_', '')),
        description: name,
        dataType: 'SR Legacy',
        nutrientsPer100g: { calories: 379, protein: 13, carbs: 68, fat: 6.5 },
        servings: [],
    },
});

// All names carry both must-have tokens ('rolled', 'oats') so the REAL
// filterCandidatesByTokens keeps every one, and the core token 'oats' so the
// loop's hasCoreTokenMismatch guard passes them (characterized separately
// below is only what the loop DOES, not the guards' internals).
const A = () => cand('fdc_1111111', 'Rolled Oats', 5.9);
const B = () => cand('fdc_2222222', 'Rolled Oats Organic', 4.5);
const C = () => cand('fdc_3333333', 'Rolled Oats Old Fashioned', 4.0);
// NOT 'Instant'/'Quick …' — filter-candidates.ts carries a rolled-oats rule
// (`excludeIfContains: ['quick', 'instant', …]`) that would drop those from
// `filtered` before the loop ever saw them (found by running this suite).
const D = () => cand('fdc_4444444', 'Rolled Oats Traditional', 3.5);
const E = () => cand('fdc_5555555', 'Rolled Oats Large Flake', 3.0);

const LINE = '100 g rolled oats';
const RERANK_CONFIDENCE = 0.9; // above the 0.85 save gate, below the 0.98 cap

/** The lane result the successful fallback hydration returns. The confidence
 *  field is a SENTINEL: nothing in the caller may rewrite it. */
const laneResult = (c: UnifiedCandidate): FatsecretMappedIngredient => ({
    source: 'fdc',
    foodId: c.id,
    foodName: c.name,
    brandName: null,
    servingId: null,
    servingDescription: '100 g',
    grams: 100,
    kcal: 379,
    protein: 13,
    carbs: 68,
    fat: 6.5,
    confidence: 0.4242, // sentinel — see pins on the returned matchConfidence
    quality: 'medium',
    rawLine: LINE,
    servingTier: 'weight_unit', // real tier string (serving-ai-tiers.ts era)
});

function armSearch(pool: UnifiedCandidate[], winnerId: string) {
    mockGatherCandidates.mockResolvedValue(pool);
    mockConfidenceGate.mockReturnValue({
        // Real non-skip shape (gather-candidates.ts); reason string is a
        // genuine ConfidenceGateResult reason. skipAiRerank:false makes
        // gateSelection undefined, so no agreement lift and no backstop.
        skipAiRerank: false,
        confidence: 0,
        reason: 'soft_cooked_grain_full_rerank',
    });
    mockSimpleRerank.mockReturnValue({
        winner: { id: winnerId },
        confidence: RERANK_CONFIDENCE,
        reason: 'simple_rerank', // real winning reason string
        sortedCandidates: [],
    });
}

const hydratedIds = () => mockHydrate.mock.calls.map(call => (call[0] as UnifiedCandidate).id);

async function run(telemetry?: MappingTelemetry) {
    const r = await mapIngredientWithFallback(LINE, {
        skipCache: true,       // gates the two cache READ layers only
        skipSave: false,       // the save is an observable in these pins
        allowLiveFallback: false,
        telemetry,
    });
    return r as FatsecretMappedIngredient | null;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockSaveValidatedMapping.mockResolvedValue(undefined);
    mockRequestAiNutrition.mockResolvedValue({ status: 'error', reason: 'llm_call_failed' });
    mockGetAiServingGrams.mockResolvedValue(null);
});

describe('V4: the serving-failure fallback loop rebills a candidate that never won', () => {
    it('bills B while the rerank winner was A, and the save carries B (not winner)', async () => {
        const a = A(); const b = B();
        armSearch([a, b], a.id);
        // A (the winner) fails hydration; B succeeds with the lane result.
        const laneResultB = laneResult(b);
        mockHydrate.mockImplementation(async (c: UnifiedCandidate) =>
            c.id === b.id ? laneResultB : null);

        const telemetry: MappingTelemetry = {};
        const r = await run(telemetry);

        // (a) billed identity is B's; the winner (first hydration attempt) was A.
        expect(r).not.toBeNull();
        expect(r!.foodId).toBe('fdc_2222222');
        expect(hydratedIds()).toEqual(['fdc_1111111', 'fdc_2222222']);

        // The returned object IS the lane's result, by reference — finalize
        // never clones or rewrites it (sanity caps only reject, at 10 kg/50k kcal).
        // If 1d deliberately introduces a copy, relax this reference pin to
        // field equality (toEqual) — the identity content is the behavior;
        // the shared reference is today's implementation detail.
        expect(r).toBe(laneResultB);

        // (b) selectionReason lands as 'fallback_after_serving_failure' — pinned
        // where it is consumed: the approval record handed to saveValidatedMapping.
        // (d) the save receives `result` (B), NOT `winner` (A): rawLine, B's
        // mapped object, and the OUTER confidence unmultiplied.
        expect(mockSaveValidatedMapping).toHaveBeenCalledTimes(1);
        const [savedRawLine, savedResult, approval] = mockSaveValidatedMapping.mock.calls[0];
        expect(savedRawLine).toBe(LINE);
        expect((savedResult as FatsecretMappedIngredient).foodId).toBe('fdc_2222222');
        expect(approval).toEqual({
            approved: true,
            confidence: RERANK_CONFIDENCE, // 0.9 — the winner's confidence, not * 0.95
            reason: 'fallback_after_serving_failure',
        });

        // Optimistic funnel mark: finalize stamps 'saved' before the save call
        // (the real save gate may downgrade it; that gate is mocked out here).
        expect(telemetry.funnelStage).toBe('saved');

        // The fallback served, so the last-resort nutrition backfill never ran.
        expect(mockRequestAiNutrition).not.toHaveBeenCalled();
        // Gather runs TWICE on every search-path line (the normalize-gate quick
        // gather, then the main Step-2 gather; the second is seeded from the
        // first when normalizedName is unchanged). A Step-5b re-search would be
        // a THIRD call — and Step 5b is unreachable here anyway, being gated on
        // filtered.length === 0 && selectionReason === 'normalized_cache_hit'.
        expect(mockGatherCandidates).toHaveBeenCalledTimes(2);
    });

    it('(c) hydrates fallbacks at confidence * 0.95 without writing it back — three confidences stay distinct', async () => {
        const a = A(); const b = B();
        armSearch([a, b], a.id);
        mockHydrate.mockImplementation(async (c: UnifiedCandidate) =>
            c.id === b.id ? laneResult(b) : null);

        const r = await run();

        // Winner hydrated at the outer confidence; the fallback at * 0.95.
        expect(mockHydrate.mock.calls[0][2]).toBe(RERANK_CONFIDENCE);
        expect(mockHydrate.mock.calls[1][2]).toBeCloseTo(RERANK_CONFIDENCE * 0.95, 10);

        // Both attempts spend the SAME hydration budget object (shared pool).
        expect(mockHydrate.mock.calls[1][4]).toBe(mockHydrate.mock.calls[0][4]);

        // The returned matchConfidence is the LANE RESULT's confidence field,
        // verbatim (sentinel 0.4242) — neither the outer 0.9 nor 0.855. The
        // 0.95 multiplier reaches the caller only if the lane writes it into
        // its result; the mapper itself never sets result.confidence here.
        expect(r!.confidence).toBe(0.4242);
        expect(r!.confidence).not.toBe(RERANK_CONFIDENCE);
        expect(r!.confidence).not.toBeCloseTo(RERANK_CONFIDENCE * 0.95, 10);

        // …while the save simultaneously carried the outer 0.9 — the same flow
        // holds two different confidences for the same billed record.
        expect(mockSaveValidatedMapping.mock.calls[0][2].confidence).toBe(RERANK_CONFIDENCE);
    });

    it('walks fallbacks in FILTERED order (gather order minus the winner), not rerank/score order', async () => {
        const a = A(); const b = B(); const c = C();
        // Gather order deliberately DISAGREES with score-descending order:
        // B(4.5) precedes A(5.9). Winner is C(4.0) — the LAST of the pool.
        armSearch([b, a, c], c.id);
        // C (winner) fails; B succeeds on the first fallback attempt.
        mockHydrate.mockImplementation(async (cd: UnifiedCandidate) =>
            cd.id === b.id ? laneResult(b) : null);

        const r = await run();

        // Loop order is filtered-with-winner-removed: [B, A] — winner first
        // (Step 5), then B, which succeeds so A is never tried. A
        // score-descending walk would have hydrated A (fdc_1111111, 5.9)
        // BEFORE B (fdc_2222222, 4.5) — the two-element sequence refutes it.
        expect(hydratedIds()).toEqual(['fdc_3333333', 'fdc_2222222']);
        expect(r!.foodId).toBe('fdc_2222222');
        expect(mockSaveValidatedMapping.mock.calls[0][2].reason)
            .toBe('fallback_after_serving_failure');
    });

    it('caps the loop at 3 fallback candidates; when all fail, the site-2 backfill answers and nothing is saved', async () => {
        // Precondition: the site-2 backfill path this test pins is gated on
        // AI_NUTRITION_BACKFILL_ENABLED (getFlag default TRUE); an env
        // override flipping it off would skip the path and fail confusingly.
        expect(AI_NUTRITION_BACKFILL_ENABLED).toBe(true);

        const pool = [A(), B(), C(), D(), E()];
        armSearch(pool, pool[0].id);
        mockHydrate.mockResolvedValue(null); // every hydration fails

        const r = await run();

        // Winner + fallbacks slice(0, 3): A, then B, C, D. E is never tried.
        expect(hydratedIds()).toEqual([
            'fdc_1111111', 'fdc_2222222', 'fdc_3333333', 'fdc_4444444',
        ]);

        // Exhausted loop falls into the `if (!result)` backfill (census site 2,
        // the near-duplicate under a winner-exists frame). Our stub declines,
        // so the line returns null — with NO save attempted.
        expect(mockRequestAiNutrition).toHaveBeenCalledTimes(1);
        expect(String(mockRequestAiNutrition.mock.calls[0][0])).toMatch(/oat/);
        // The backfill spends the NUTRITION budget, a different pool from the
        // hydration budget the loop spent.
        expect(mockRequestAiNutrition.mock.calls[0][1].budget)
            .not.toBe(mockHydrate.mock.calls[0][4]);
        expect(mockGetAiServingGrams).not.toHaveBeenCalled(); // error status short-circuits
        expect(r).toBeNull();
        expect(mockSaveValidatedMapping).not.toHaveBeenCalled();
    });

    it('negative control: when the winner hydrates, the loop never runs and the save carries the rerank reason', async () => {
        const a = A(); const b = B();
        armSearch([a, b], a.id);
        mockHydrate.mockImplementation(async (c: UnifiedCandidate) =>
            c.id === a.id ? laneResult(a) : null);

        const r = await run();

        expect(hydratedIds()).toEqual(['fdc_1111111']); // one attempt, no loop
        expect(r!.foodId).toBe('fdc_1111111');
        expect(mockSaveValidatedMapping).toHaveBeenCalledTimes(1);
        expect(mockSaveValidatedMapping.mock.calls[0][2]).toEqual({
            approved: true,
            confidence: RERANK_CONFIDENCE,
            reason: 'simple_rerank', // untouched by the swapper
        });
    });
});
