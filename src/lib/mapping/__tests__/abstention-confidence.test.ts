/**
 * The `scored_by_confidence` abstention leg, tested THROUGH THE CALLER.
 *
 * ## Why this file exists in this shape
 *
 * The first cut of this branch tested the leg's *judge* (`assessConfidence`) in
 * isolation and restated the leg's two thresholds as literals. That was fake
 * coverage, and it was measured as such: reverting the headline edit
 * (`confidence = RERANK_DECLINED_CONFIDENCE` back to `confidence = winner.score`)
 * left the FULL suite green — 159 suites / 3286 tests, exit 0 — and deleting
 * `&& fallbackNameMatch >= MIN_FALLBACK_NAME_MATCH` from the caller left the
 * entire `src/lib/mapping/__tests__` directory green (67 suites / 1174 tests).
 * The only thing that caught either was a nightly `doc-check` grep, which
 * CLAUDE.md documents as fail-open in both directions and which is NOT one of
 * this repo's required checks (those are `build` and `Vercel`).
 *
 * So these tests EXECUTE `mapIngredientWithFallback()` and read the confidence
 * off its returned result. The mocking follows the house pattern established by
 * `identity-qualifier-reaches-retrieval.test.ts`: a Proxy prisma that answers
 * "nothing found" for every model and verb, `gatherCandidates` stubbed so the
 * candidate pool is an input, and semantic search disabled.
 *
 * ## The one mock that needs justifying
 *
 * `simpleRerank` is stubbed to ABSTAIN. The leg under test is unreachable
 * otherwise — it lives inside `if (!winner)`, i.e. it only runs when the
 * reranker declined to name anyone — and steering the real reranker into an
 * abstention by choosing corpus-shaped candidates would make these tests depend
 * on rerank scoring, which is exactly the thing this branch is not changing.
 *
 * To stop the stub being fiction, `T0` calls the REAL `simpleRerank` via
 * `jest.requireActual` and pins that `{ winner: null, reason:
 * 'confidence_below_threshold' }` is a shape it genuinely returns. If that ever
 * stops being true, T0 fails and every test below is known to be testing a
 * branch that can no longer be reached.
 *
 * FDC candidates are used rather than OFF ones because `buildOffResult()`
 * hydrates over the network for its panel and returns null under the jest LLM
 * egress gate; the FDC builder reads `rawData.nutrientsPer100g` directly. The
 * leg being tested is source-blind.
 */

const mockGatherCandidates = jest.fn();
const mockSimpleRerank = jest.fn();

// Generic prisma stub: every model answers "nothing found" for any query verb.
// Enumerating models by hand has previously made a sibling file assert nothing,
// because the mapper hit an unmocked model and threw before ever reaching the
// code under test.
jest.mock('../../db', () => {
    const emptyFor = (verb: string) =>
        jest.fn().mockResolvedValue(
            verb.startsWith('findMany') || verb === 'findMany' ? [] : null);
    const model = new Proxy({}, { get: (_t, verb: string) => emptyFor(verb) });
    return { prisma: new Proxy({}, { get: () => model }) };
});

jest.mock('../gather-candidates', () => {
    const actual = jest.requireActual('../gather-candidates');
    return { ...actual, gatherCandidates: (...a: unknown[]) => mockGatherCandidates(...a) };
});

jest.mock('../simple-rerank', () => {
    const actual = jest.requireActual('../simple-rerank');
    return { ...actual, simpleRerank: (...a: unknown[]) => mockSimpleRerank(...a) };
});

jest.mock('../../search/query-embedding', () => ({
    SEMANTIC_SEARCH_ENABLED: false,
    CORPUS_POOLING: 'cls',
    warmupEmbedder: jest.fn(),
    embedQuery: jest.fn().mockResolvedValue(null),
}));

import { mapIngredientWithFallback } from '../map-ingredient-with-fallback';
import { assessConfidence, type UnifiedCandidate } from '../gather-candidates';
import { RERANK_DECLINED_CONFIDENCE, SUB_THRESHOLD_SAVE_FLOOR, SAVE_CONFIDENCE_THRESHOLD } from '../sub-threshold-admission';

/** An FDC candidate carrying its own panel, so no hydration is attempted. */
const cand = (id: string, name: string, score: number): UnifiedCandidate => ({
    id,
    source: 'fdc',
    name,
    brandName: null,
    score,
    nutrition: { kcal: 120, protein: 4, carbs: 20, fat: 2, per100g: true },
    servings: [{ description: '100 g', grams: 100, isDefault: true }],
    rawData: {
        fdcId: Number(id.replace('fdc_', '')),
        description: name,
        dataType: 'SR Legacy',
        nutrientsPer100g: { calories: 120, protein: 4, carbs: 20, fat: 2 },
        servings: [],
    },
});

async function mapWith(line: string, candidates: UnifiedCandidate[]) {
    mockGatherCandidates.mockResolvedValue(candidates);
    return mapIngredientWithFallback(line, {
        skipCache: true,
        skipSave: true,
        allowLiveFallback: false,
    } as never).catch(() => null);
}

/** Clears the name-match term, so the leg is entered. */
const NAME_MATCHING_POOL = [
    cand('fdc_1111111', 'Rolled Oats', 5.9),
    cand('fdc_2222222', 'Oats Steel Cut', 4.0),
];
/**
 * Fails the name-match term while clearing the raw floor by a wide margin.
 * `oatmeal` -> "Konjac Cooked Rice oats" is one of this defect's headline
 * outcomes; assessConfidence scores it 0.100 against the 0.60 term.
 */
const NAME_MISMATCHED_POOL = [
    cand('fdc_1111111', 'Konjac Cooked Rice oats', 9.0),
    cand('fdc_2222222', 'Konjac Shirataki Noodle', 8.0),
];

beforeEach(() => {
    jest.clearAllMocks();
    // simpleRerank ABSTAINS. This is the precondition of the whole branch.
    mockSimpleRerank.mockReturnValue({
        winner: null,
        confidence: 0.42,
        reason: 'confidence_below_threshold',
        sortedCandidates: [],
    });
});

describe('T0 the abstention this file simulates is one the real reranker produces', () => {
    it('the real simpleRerank returns winner:null with confidence_below_threshold', () => {
        // Guards the ONE mock that could make every test below vacuous. If
        // simpleRerank stops being able to abstain, `if (!winner)` is dead and
        // these tests are asserting over an unreachable branch.
        const actual = jest.requireActual('../simple-rerank');
        const rerankCandidates = NAME_MISMATCHED_POOL.map(c => actual.toRerankCandidate(c));
        const res = actual.simpleRerank('oatmeal', rerankCandidates, undefined, 'oatmeal', false, undefined, false);

        expect(res.winner).toBeNull();
        expect(res.reason).toBe('confidence_below_threshold');
        expect(res.confidence).toBeLessThan(0.70); // MIN_RERANK_CONFIDENCE
    });
});

describe('T7 SITE A: the abstention leg writes the constant, not the retrieval score', () => {
    it('a pick made after simpleRerank declined is reported at RERANK_DECLINED_CONFIDENCE', async () => {
        // MUTATION: change `confidence = RERANK_DECLINED_CONFIDENCE` back to
        // `confidence = winner.score` in the `scored_by_confidence` arm of
        // mapIngredientWithFallback(). Kills this test — the result comes back
        // at the candidate's raw retrieval score (5.9 here), which is the whole
        // defect: a cross-source, unbounded engine score standing in for a
        // confidence, saturating to a cached 1.000 at the clamp downstream.
        const r = await mapWith('1 cup rolled oats', NAME_MATCHING_POOL);

        expect(r).not.toBeNull();
        expect(r!.foodId).toBe('fdc_1111111');
        expect(r!.confidence).toBe(RERANK_DECLINED_CONFIDENCE);
    });

    it('the reported confidence is not the winning candidate score, clamped or raw', async () => {
        // The sharper form of the same mutation: 5.9 clamps to 1, and 1 is what
        // the mobile badge renders as "✓ 100% Exact Match".
        const r = await mapWith('1 cup rolled oats', NAME_MATCHING_POOL);

        expect(r!.confidence).not.toBe(5.9);
        expect(r!.confidence).not.toBe(1);
        expect(r!.confidence).toBeLessThan(1);
    });

    it('lands in the insert-only save tier, so it can create but never displace', async () => {
        // Ties the number to the two save-gate constants it was chosen against,
        // executed rather than restated. Above the floor => still offered to the
        // cache; below the threshold => insertOnly.
        const r = await mapWith('1 cup rolled oats', NAME_MATCHING_POOL);

        expect(r!.confidence).toBeGreaterThanOrEqual(SUB_THRESHOLD_SAVE_FLOOR);
        expect(r!.confidence).toBeLessThan(SAVE_CONFIDENCE_THRESHOLD);
    });

    it('emits quality "medium", not "high"', async () => {
        // The output-field change this branch makes, pinned rather than left
        // implicit. `quality: confidence >= 0.8 ? 'high' : ...` at seven sites
        // flips at 0.78. No consumer was found under src/app/api, but a silently
        // changed emitted field is not a detail — if a consumer appears, this
        // test is where the contract is written down.
        const r = await mapWith('1 cup rolled oats', NAME_MATCHING_POOL);

        expect(r!.quality).toBe('medium');
    });
});

/**
 * SITE C: the `confidence_gate_backstop` leg. The pool is chosen so ONLY the
 * backstop can produce a winner: both scores sit below MIN_FALLBACK_RAW_SCORE
 * (0.80), so if the backstop leg were deleted the `scored_by_confidence` arm
 * rejects and the result is null — the leg under test is isolated by
 * construction, not by reading selectionReason. The food is deliberately
 * NON-GRAIN and NON-PRODUCE: a grain query trips
 * `soft_cooked_grain_full_rerank` and a produce query trips
 * `basic_produce_bypass`, either of which would move the test onto a
 * different gate exit. "celery" == "Celery" makes assessConfidence() return
 * its exact-match 1.0, which is precisely the number the ceiling exists to
 * stop reaching the cache.
 */
const BACKSTOP_POOL = [
    cand('fdc_5555555', 'Celery', 0.5),
    cand('fdc_6666666', 'Toasted Sesame Dressing', 0.4),
];

describe('T9 SITE C: the backstop leg takes the declined ceiling', () => {
    it('an exact-name gate pick after simpleRerank declined is capped at RERANK_DECLINED_CONFIDENCE', async () => {
        // MUTATION: revert `confidence = Math.min(RERANK_DECLINED_CONFIDENCE,
        // gateResult.confidence)` back to `confidence = gateResult.confidence`
        // in the backstop arm of mapIngredientWithFallback(). Kills this test —
        // assessConfidence('celery', 'Celery') is exactly 1.0 (the perfect-match
        // early return), and 1.0 is what the mobile badge renders as
        // "✓ 100% Exact Match" on a pick the reranker refused to make.
        const r = await mapWith('1 cup celery', BACKSTOP_POOL);

        expect(r).not.toBeNull();
        expect(r!.foodId).toBe('fdc_5555555');
        expect(r!.confidence).toBe(RERANK_DECLINED_CONFIDENCE);
        expect(r!.confidence).not.toBe(1);
    });

    it('the winner came from the backstop, not the scored_by_confidence arm', () => {
        // The isolation argument, executed: both candidates sit below the raw
        // floor, so the fallback arm cannot have admitted them. If this ever
        // fails the pool no longer isolates the leg and T9 is testing nothing.
        expect(BACKSTOP_POOL[0].score).toBeLessThan(0.80);
        expect(BACKSTOP_POOL[1].score).toBeLessThan(0.80);
    });

    it('lands in the insert-only save tier, so it can create but never displace', async () => {
        const r = await mapWith('1 cup celery', BACKSTOP_POOL);

        expect(r!.confidence).toBeGreaterThanOrEqual(SUB_THRESHOLD_SAVE_FLOOR);
        expect(r!.confidence).toBeLessThan(SAVE_CONFIDENCE_THRESHOLD);
    });

    it('emits quality "medium", not "high"', async () => {
        const r = await mapWith('1 cup celery', BACKSTOP_POOL);

        expect(r!.quality).toBe('medium');
    });
});

describe('T8 SITE A: the name-match term actually gates admission', () => {
    it('rejects a high-scoring candidate that shares no core token with the query', async () => {
        // MUTATION: delete `&& fallbackNameMatch >= MIN_FALLBACK_NAME_MATCH`
        // from the caller. Kills this test — "Konjac Cooked Rice oats" is
        // admitted for the query `oatmeal` and a result comes back instead of
        // null. This is the caller-side proof the previous test file could not
        // give: it asserted the JUDGE separated the population and never
        // checked that the caller consults it.
        const r = await mapWith('1 cup oatmeal', NAME_MISMATCHED_POOL);

        expect(r).toBeNull();
    });

    it('the raw floor alone would have admitted it — the two terms are not redundant', () => {
        // If this ever fails, the name-match term is dead weight and the
        // narrowing claim above is false. MIN_FALLBACK_RAW_SCORE is 0.80 and
        // computeOffScore is unbounded additive, so the raw floor is near-inert
        // for this source; the name-match term is the scale-free half.
        const top = NAME_MISMATCHED_POOL[0];
        expect(top.score).toBeGreaterThanOrEqual(0.80);
        expect(assessConfidence('oatmeal', top)).toBeLessThan(0.60);
    });

    it('the drop set is flat across [0.50, 0.60], so 0.60 is not a tuned number', () => {
        // The measured plateau (0.50 and 0.60 drop the identical 13 of 208
        // recorded post-partition abstention decisions, 2026-08-05) is why the
        // threshold is not fitted. A case that separates the two would falsify
        // the plateau and belongs here.
        expect(assessConfidence('oatmeal', NAME_MISMATCHED_POOL[0])).toBeLessThan(0.50);
    });

    it('is NARROWING-ONLY: a candidate that covers the query is still admitted', async () => {
        // The conjunction cannot admit anything baseline did not. Same pool as
        // T7, asserted for the opposite property.
        const r = await mapWith('1 cup rolled oats', NAME_MATCHING_POOL);

        expect(r).not.toBeNull();
        expect(r!.foodId).toBe('fdc_1111111');
    });

    it('a candidate below the raw floor stays rejected however well it matches by name', async () => {
        // The other conjunct, still live. Deleting the RAW term instead of the
        // name term must not go unnoticed either.
        const r = await mapWith('1 cup rolled oats', [
            cand('fdc_3333333', 'Rolled Oats', 0.4),
            cand('fdc_4444444', 'Rolled Oats Organic', 0.3),
        ]);

        expect(r).toBeNull();
    });
});
