/**
 * Phase 1 stage 1c — characterization, CLUSTER 2 (census V2):
 * cache-winner → Step-5b search rebill.
 *
 * Pins CURRENT behavior of the flow where a normalized-cache hit sets `winner`
 * (selectionReason 'normalized_cache_hit'), its hydration fails, and — because
 * `filtered` is empty for a cache-served line — the Step 5b guard
 * (`!result && filtered.length === 0 && selectionReason === 'normalized_cache_hit'`)
 * re-runs the FULL search machinery and rebills a search-pool record.
 *
 * The pins that matter for the 1d extraction:
 *   (a) the billed foodId is the SEARCH record, not the failed cache winner;
 *   (b) selectionReason is overwritten to 'fallback_search_after_cache_failure'
 *       and that string reaches saveValidatedMapping as `reason`;
 *   (c) the save PROCEEDS — the overwrite is what defeats the
 *       'normalized_cache_hit' resave-skip in finalizeAndSaveResult;
 *   (d) confidence handling: the retry hydration is offered `confidence * 0.9`,
 *       but the SAVE records the undiscounted cache-row confidence, and the
 *       returned result carries whatever confidence hydration stamped on it
 *       (pass-through, never reconciled with the saved value).
 *
 * These are characterization tests: they assert what the code DOES today.
 * A failure here after 1d is a behavior change, which is 1d's abort condition.
 */

import type { UnifiedCandidate } from '../gather-candidates';

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
        fatSecretFood: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
        foodMapping: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
        ingredient: { findMany: jest.fn().mockResolvedValue([]) },
        // Serving stores: every model the deep cascade touches must exist or an
        // omission fails deep in the cascade mimicking a production bug (see the
        // header warning in map-ingredient-with-fallback.test.ts). Kept even
        // though hydrateAndSelectServing is mocked here — cheap insurance.
        aiGeneratedServing: {
            findUnique: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([]),
            upsert: jest.fn().mockResolvedValue(null),
        },
        fdcServing: {
            findUnique: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([]),
            upsert: jest.fn().mockResolvedValue(null),
        },
        offServing: {
            findUnique: jest.fn().mockResolvedValue(null),
            findMany: jest.fn().mockResolvedValue([]),
            upsert: jest.fn().mockResolvedValue(null),
        },
        userPortionOverride: { findUnique: jest.fn().mockResolvedValue(null) },
    },
}));

jest.mock('../ai-normalize');
// Partial mock: db-backed cache reads/writes stubbed; pure predicates stay real.
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
// ENABLE_MAPPING_ANALYSIS is 'true' in this dev env's .env, which jest loads —
// without this stub the mapper writes REAL mapping-analysis session files into
// logs/ from a unit test.
jest.mock('../mapping-logger');
// gather-candidates is requireActual'd above, which imports the query-embedding
// module at load; stub it so no real embedder ever initializes under jest
// (same stub as producer-billed-vs-winner.test.ts).
jest.mock('../../search/query-embedding', () => ({
    SEMANTIC_SEARCH_ENABLED: false,
    CORPUS_POOLING: 'cls',
    warmupEmbedder: jest.fn(),
    embedQuery: jest.fn().mockResolvedValue(null),
}));
jest.mock('../simple-rerank', () => {
    const actual = jest.requireActual('../simple-rerank');
    return { ...actual, simpleRerank: jest.fn() };
});
// Stage-1a seam: the mapper imports hydrateAndSelectServing from the hydration
// lane; mocking it here intercepts ALL mapper call sites, so hydration
// success/failure is controlled per candidate id.
jest.mock('../serving/hydration-lane', () => {
    const actual = jest.requireActual('../serving/hydration-lane');
    return { ...actual, hydrateAndSelectServing: jest.fn() };
});
// AI_NUTRITION_BACKFILL_ENABLED defaults TRUE — without this mock the second
// backfill site dials the jest LLM blackhole (ECONNREFUSED).
jest.mock('../ai-nutrition-backfill', () => {
    const actual = jest.requireActual('../ai-nutrition-backfill');
    return { ...actual, requestAiNutrition: jest.fn(), getAiServingGrams: jest.fn() };
});

import {
    mapIngredientWithFallback,
    type FatsecretMappedIngredient,
    type MappingTelemetry,
} from '../map-ingredient-with-fallback';
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
import { simpleRerank } from '../simple-rerank';
import { hydrateAndSelectServing } from '../serving/hydration-lane';
import { requestAiNutrition, getAiServingGrams } from '../ai-nutrition-backfill';
import { deriveMappingCacheKey } from '../cache-key';
import { detectBrandInQuery } from '../brand-detector';
import { AI_NUTRITION_BACKFILL_ENABLED } from '../config';

const RAW_LINE = '1 tbsp light cream cheese';
const CACHE_WINNER_ID = 'cc-1';

/** The step-1c FoodMapping row that becomes `winner` (selectionReason 'normalized_cache_hit'). */
const cacheRow = {
    foodId: CACHE_WINNER_ID,
    foodName: 'Light Cream Cheese',
    brandName: null,
    source: 'ai_generated',
    confidence: 0.9,
};

const searchCandidate = (id: string): UnifiedCandidate => ({
    id,
    source: 'ai_generated',
    name: 'Light Cream Cheese',
    brandName: null,
    score: 0.9,
    foodType: 'Generic',
    rawData: {},
} as UnifiedCandidate);

/** What the mocked hydration lane returns for the winning SEARCH candidate.
 *  servingTier is a REAL tier string copied from the mapper (never invented). */
const searchBill = (foodId: string): FatsecretMappedIngredient => ({
    source: 'ai_generated',
    foodId,
    foodName: 'Light Cream Cheese',
    brandName: null,
    servingId: null,
    servingDescription: '1 tbsp',
    grams: 14,
    kcal: 30,
    protein: 1.1,
    carbs: 0.8,
    fat: 2.5,
    // Distinctive on purpose: pins that the returned result's confidence is the
    // hydration lane's stamp, passed through untouched (see pin (d)).
    confidence: 0.7654,
    quality: 'high',
    rawLine: RAW_LINE,
    servingTier: 'flat_100g_default',
});

function mockStep1cCacheHit() {
    // Early (pre-AI-normalize) lookup misses once; the Step-1c lookup hits.
    (getValidatedMappingByNormalizedName as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValue(cacheRow);
}

/** The brand input the mapper derives for a line (no options.brand passed) —
 *  same helper as producer-normalized-name-frozen.test.ts. */
const brandInputFor = (line: string) => {
    const det = detectBrandInQuery(line);
    return { isBranded: det.isBranded, matchedBrand: det.matchedBrand };
};

beforeEach(() => {
    jest.clearAllMocks();
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
    // Step 5b only reads `sortedCandidates`; echo the pool in given order.
    // confidence is DELIBERATELY distinctive (0.42 != cacheRow's 0.9): if the
    // save or the retry-hydration offer ever derived from the 5b rerank's
    // confidence instead of the cache row's, the 0.9 / 0.81 assertions below
    // would read 0.42 / 0.378 — the two sources are no longer confounded.
    (simpleRerank as jest.Mock).mockImplementation(
        (_q: string, cands: Array<{ id: string }>) => ({
            winner: cands[0] ?? null,
            confidence: 0.42,
            reason: 'stub_echo',
            sortedCandidates: cands,
        }),
    );
    (hydrateAndSelectServing as jest.Mock).mockResolvedValue(null);
    // Real error-shape string copied from ai-nutrition-backfill.ts.
    (requestAiNutrition as jest.Mock).mockResolvedValue({ status: 'error', reason: 'llm_call_failed' });
    (getAiServingGrams as jest.Mock).mockResolvedValue(null);
});

describe('Step 5b: cache winner fails hydration → full search rebill (census V2)', () => {
    it('bills the SEARCH record, overwrites selectionReason, and the save PROCEEDS past the resave-skip', async () => {
        mockStep1cCacheHit();
        (gatherCandidates as jest.Mock).mockResolvedValue([
            searchCandidate('search-1'),
            searchCandidate('search-2'),
        ]);
        // Hydration keyed on candidate id: the cache winner is unhydratable,
        // the first search candidate serves.
        (hydrateAndSelectServing as jest.Mock).mockImplementation(
            async (candidate: { id: string }) =>
                candidate.id === 'search-1' ? searchBill('search-1') : null,
        );

        const telemetry: MappingTelemetry = {};
        const result = await mapIngredientWithFallback(RAW_LINE, {
            minConfidence: 0,
            skipFdc: true,
            telemetry,
        });

        // (a) billed foodId is the search record, not the failed cache winner.
        expect(result).not.toBeNull();
        expect(result && 'foodId' in result ? result.foodId : null).toBe('search-1');

        // TWO gathers, not one: the mapper's pre-cascade QUICK gather (the
        // normalize-gate feeder, a stale-value reader per the 1c census) always
        // runs before Step 1c; the SECOND call is Step 5b's re-search. The
        // cache hit still skipped Step 2 — a third gather would be Step 2.
        expect(gatherCandidates).toHaveBeenCalledTimes(2);
        expect((gatherCandidates as jest.Mock).mock.calls[1][2]).toBe('light cream cheese');
        // Step 5b's rerank is the only rerank call (the quick gather feeds the
        // normalize gate, which never reranks).
        expect(simpleRerank).toHaveBeenCalledTimes(1);

        // TWO cache lookups, not four: the early (pre-AI-normalize) lookup and
        // the Step-1c lookup each make ONE getValidatedMappingByNormalizedName
        // call, because for this brandless fixture the symmetric key equals the
        // legacy key and lookupValidatedMappingWithLegacyFallback short-circuits
        // its legacy point-read (`legacyKey === symmetricKey` → return null).
        expect(getValidatedMappingByNormalizedName).toHaveBeenCalledTimes(2);

        // Step 5a-VOLUME fires BETWEEN the winner's hydration failure and the
        // 5b re-search: `1 tbsp` is a volume unit and the cache winner's source
        // is 'ai_generated', so insertAiServing is offered the FAILED CACHE
        // WINNER (it declines here via the default mock). A 1d that deleted
        // this step would otherwise pass the whole suite unnoticed.
        expect(insertAiServing).toHaveBeenCalledTimes(1);
        expect((insertAiServing as jest.Mock).mock.calls[0][0]).toBe(CACHE_WINNER_ID);
        expect((insertAiServing as jest.Mock).mock.calls[0][1]).toBe('volume');

        // Hydration sequence: winner first at the undiscounted cache confidence,
        // then the search candidate at confidence * 0.9 (pin (d), retry side).
        const hydrateCalls = (hydrateAndSelectServing as jest.Mock).mock.calls;
        expect(hydrateCalls).toHaveLength(2);
        expect(hydrateCalls[0][0].id).toBe(CACHE_WINNER_ID);
        expect(hydrateCalls[0][2]).toBe(0.9);
        expect(hydrateCalls[1][0].id).toBe('search-1');
        expect(hydrateCalls[1][2]).toBeCloseTo(0.81, 10);

        // (b)+(c) the save PROCEEDS (overwritten selectionReason defeats the
        // 'normalized_cache_hit' resave-skip) and records the overwritten reason
        // with the UNDISCOUNTED cache-row confidence — not the 0.81 offered to
        // hydration, not the 0.7654 the result carries, and not the 0.42 the
        // 5b rerank stub returns (which is what makes 0.9 uniquely cache-row).
        expect(saveValidatedMapping).toHaveBeenCalledTimes(1);
        expect((saveValidatedMapping as jest.Mock).mock.calls[0][2]).toEqual({
            approved: true,
            confidence: 0.9,
            reason: 'fallback_search_after_cache_failure',
        });

        // Save identity: the save proceeds under the ORIGINAL line and key —
        // arg 0 is the raw line, and canonicalBase is deriveMappingCacheKey
        // (THE shared read/write key function, used real here) over the FINAL
        // normalizedName, which is what Step 5b's gather received (captured
        // args, same pattern as producer-normalized-name-frozen.test.ts).
        const saveCall = (saveValidatedMapping as jest.Mock).mock.calls[0];
        expect(saveCall[0]).toBe(RAW_LINE);
        const finalName = (gatherCandidates as jest.Mock).mock.calls[1][2] as string;
        const capturedParsed = (gatherCandidates as jest.Mock).mock.calls[0][1];
        expect(saveCall[3].canonicalBase).toBe(
            deriveMappingCacheKey(finalName, capturedParsed, brandInputFor(RAW_LINE), RAW_LINE),
        );

        // (d) the returned result's confidence is the hydration lane's stamp,
        // passed through untouched.
        expect(result && 'confidence' in result ? result.confidence : null).toBe(0.7654);

        // The telemetry stamped at cache-hit time is NOT un-stamped by the
        // rebill: the line still reads as a normalized cache hit.
        expect(telemetry.cacheHit).toBe('normalized');
        expect(telemetry.cacheEscape).toBeUndefined();
    });

    it('CONTRAST: a servable cache winner never re-searches and the resave-skip suppresses the save', async () => {
        mockStep1cCacheHit();
        // Same searchable pool as the rebill test — proving the pool's
        // availability is not what arms Step 5b; the hydration failure is.
        (gatherCandidates as jest.Mock).mockResolvedValue([
            searchCandidate('search-1'),
            searchCandidate('search-2'),
        ]);
        (hydrateAndSelectServing as jest.Mock).mockImplementation(
            async (candidate: { id: string }) =>
                candidate.id === CACHE_WINNER_ID ? searchBill(CACHE_WINNER_ID) : null,
        );

        const result = await mapIngredientWithFallback(RAW_LINE, {
            minConfidence: 0,
            skipFdc: true,
        });

        expect(result && 'foodId' in result ? result.foodId : null).toBe(CACHE_WINNER_ID);
        // selectionReason stays 'normalized_cache_hit' → the Step-6 resave-skip
        // holds and the search machinery is never armed: the only gather is the
        // pre-cascade quick gather, hydration ran once (the winner), and no
        // rerank ever happened.
        expect(saveValidatedMapping).not.toHaveBeenCalled();
        expect(gatherCandidates).toHaveBeenCalledTimes(1);
        expect(hydrateAndSelectServing).toHaveBeenCalledTimes(1);
        expect((hydrateAndSelectServing as jest.Mock).mock.calls[0][0].id).toBe(CACHE_WINNER_ID);
        expect(simpleRerank).not.toHaveBeenCalled();
    });

    it('an EMPTY re-search pool falls through to the second backfill site and returns null (no save)', async () => {
        // Precondition: the second backfill site is inside
        // `if (AI_NUTRITION_BACKFILL_ENABLED)` — this test is void if a config
        // change flips the flag off (it defaults true; getFlag reads env).
        expect(AI_NUTRITION_BACKFILL_ENABLED).toBe(true);

        mockStep1cCacheHit();
        (gatherCandidates as jest.Mock).mockResolvedValue([]);
        // hydrateAndSelectServing default: null for everything.

        const telemetry: MappingTelemetry = {};
        const result = await mapIngredientWithFallback(RAW_LINE, {
            minConfidence: 0,
            skipFdc: true,
            telemetry,
        });

        // Witness that the cache WINNER existed and reached hydration — this
        // is a site-2 run (winner present, hydration failed), not a winner-less
        // site-1 run: exactly one hydration attempt, offered the cache winner
        // at the UNDISCOUNTED cache-row confidence, and the telemetry carries
        // the normalized-cache-hit stamp.
        expect(hydrateAndSelectServing).toHaveBeenCalledTimes(1);
        expect((hydrateAndSelectServing as jest.Mock).mock.calls[0][0].id).toBe(CACHE_WINNER_ID);
        expect((hydrateAndSelectServing as jest.Mock).mock.calls[0][2]).toBe(0.9);
        expect(telemetry.cacheHit).toBe('normalized');

        // Step 5b DID run its re-search (the guard matched): the first gather
        // is the pre-cascade quick gather, the second is 5b's.
        expect(gatherCandidates).toHaveBeenCalledTimes(2);
        // …found nothing, so the request lands in the second AI-nutrition
        // backfill site (the one reached after a winner exists), which fails
        // here, and the mapper returns null without ever saving.
        expect(requestAiNutrition).toHaveBeenCalledTimes(1);
        expect((requestAiNutrition as jest.Mock).mock.calls[0][0]).toBe('light cream cheese');
        expect(result).toBeNull();
        expect(saveValidatedMapping).not.toHaveBeenCalled();
    });

    it('tries at most the FIRST FIVE rerank-sorted candidates — the sixth is never offered', async () => {
        // Precondition: the fall-through this test lands on (requestAiNutrition
        // at the second backfill site) is gated on AI_NUTRITION_BACKFILL_ENABLED.
        expect(AI_NUTRITION_BACKFILL_ENABLED).toBe(true);

        mockStep1cCacheHit();
        (gatherCandidates as jest.Mock).mockResolvedValue([
            searchCandidate('search-1'),
            searchCandidate('search-2'),
            searchCandidate('search-3'),
            searchCandidate('search-4'),
            searchCandidate('search-5'),
            searchCandidate('search-6'),
        ]);
        // Only the SIXTH sorted candidate could serve — but Step 5b slices the
        // sorted list to 5, so it is never tried and the request falls through
        // to the backfill site.
        (hydrateAndSelectServing as jest.Mock).mockImplementation(
            async (candidate: { id: string }) =>
                candidate.id === 'search-6' ? searchBill('search-6') : null,
        );

        const result = await mapIngredientWithFallback(RAW_LINE, {
            minConfidence: 0,
            skipFdc: true,
        });

        const triedIds = (hydrateAndSelectServing as jest.Mock).mock.calls.map(c => c[0].id);
        // Winner first, then exactly the first 5 of the sorted search pool.
        expect(triedIds).toEqual([
            CACHE_WINNER_ID, 'search-1', 'search-2', 'search-3', 'search-4', 'search-5',
        ]);
        expect(triedIds).not.toContain('search-6');
        expect(requestAiNutrition).toHaveBeenCalledTimes(1);
        expect(result).toBeNull();
        expect(saveValidatedMapping).not.toHaveBeenCalled();
    });
});
