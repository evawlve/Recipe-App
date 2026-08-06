/**
 * Phase 1 stage 1c — CHARACTERIZATION, cluster 5: readEscapes delivery.
 *
 * `readEscapes` is a frame-local array in `mapIngredientWithFallback()` with
 * four append sites, all in the two cache-lookup regions (the early check and
 * Step 1c), and exactly ONE reader: `finalizeAndSaveResult()` hands it to
 * `saveValidatedMapping()` as `options.readEscapes`, where the save-time
 * forfeit (`escapeForfeit`) matches on record identity and row-quality class.
 * The upcoming stage-1d extraction must preserve exactly this delivery, so
 * this file pins CURRENT behavior:
 *
 *  (a) an escaped cache row reaches a SEARCH-produced save as a
 *      site-prefixed `{ targetKey, reason }` record — prefixes `early:` /
 *      `normalized:` (row-shape chain), with the record-identity targetKey
 *      (`off:<barcode>`), never the cache key;
 *  (b) ACCUMULATION: when both the early and the Step-1c lookups escape on
 *      one request, BOTH records appear, in site order — an array, not a
 *      last-write slot;
 *  (c) the `early:hydration_failed` fall-through is telemetry-labelled but
 *      deliberately NOT recorded as a readEscape (the documented non-write:
 *      hydration failure is a property of THIS request's qty/unit, and must
 *      not strip a healthy incumbent's cross-source margin protection);
 *  (d) direct-return producers (the `!winner` AI-nutrition backfill) deliver
 *      no escapes because no outer save runs at all;
 *  (e) the REJECTION channel: when the lookup HELPER itself refuses a row —
 *      `noteRejection()` populating the `CacheLookupRejection` out-param and
 *      returning null — the mapper delivers `lookup_early:` /
 *      `lookup_normalized:` records built from the out-param's `targetKey`.
 *      With (a)/(b) covering the row-shape chain, all FOUR append sites in
 *      the mapper are exercised by this file.
 *
 * Escape-reason strings are the code's own: `nutrition_invalid` /
 * `corrupt_record` (the two ROW_QUALITY_ESCAPES classes) from the mapper's
 * escape chain, and `core_token_mismatch` from the helper's `noteRejection()`
 * sites; nothing here is invented. The escape CLASSIFICATION
 * (`isRowQualityEscape`) lives in `validated-mapping-helpers` and is kept REAL
 * via the requireActual spread — these pins are about what the MAPPER hands
 * the save: the raw, unfiltered array.
 *
 * Mock preamble follows the house pattern (`llm-output-guard-wiring.test.ts`,
 * `abstention-confidence.test.ts`), plus the stage-1a seam: the mapper now
 * imports `hydrateAndSelectServing` from `./serving/hydration-lane`, so
 * mocking that module intercepts every hydration call site.
 */

const mockOffFindUnique = jest.fn();
const mockGatherCandidates = jest.fn();
const mockSimpleRerank = jest.fn();
const mockHydrateAndSelectServing = jest.fn();

// Generic prisma stub: every model answers "nothing found" for any verb, with
// offFood.findUnique controllable per test (it is what the escape-evaluation
// chains read to decide corrupt_record / nutrition_invalid). The Proxy shape
// exists because enumerating models by hand has previously made a sibling file
// die deep in the cascade on an unmocked serving-store model
// (map-ingredient-with-fallback.test.ts's own header warns about this).
jest.mock('../../db', () => {
    const emptyFor = (verb: string) =>
        jest.fn().mockResolvedValue(verb.startsWith('findMany') ? [] : null);
    const genericModel = new Proxy({}, { get: (_t, verb) => emptyFor(String(verb)) });
    return {
        prisma: new Proxy({}, {
            get: (_t, prop) => {
                const name = String(prop);
                if (name === 'offFood') {
                    return {
                        findUnique: (...a: unknown[]) => mockOffFindUnique(...a),
                        findMany: jest.fn().mockResolvedValue([]),
                    };
                }
                if (name.startsWith('$')) return jest.fn().mockResolvedValue([]);
                return genericModel;
            },
        }),
    };
});

jest.mock('../ai-normalize');
jest.mock('../ai-parse');
jest.mock('../ai-simplify');
// Keep the classifiers REAL: the escape chain calls isTrustedHumanRow /
// isHumanTrustSkippableEscape / targetKeyOfFoodId, and the assertions below
// use the real isRowQualityEscape as the tie-in to the save-side filter.
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
jest.mock('../mapping-logger'); // ENABLE_MAPPING_ANALYSIS=true in the dev .env — keep runs file-free
jest.mock('../ai-backfill', () => ({
    insertAiServing: jest.fn().mockResolvedValue({ success: false, reason: 'skip' }),
    backfillWeightServing: jest.fn().mockResolvedValue({ success: false, reason: 'skip' }),
}));
jest.mock('../gather-candidates', () => {
    const actual = jest.requireActual('../gather-candidates');
    return { ...actual, gatherCandidates: (...a: unknown[]) => mockGatherCandidates(...a) };
});
jest.mock('../simple-rerank', () => {
    const actual = jest.requireActual('../simple-rerank');
    return { ...actual, simpleRerank: (...a: unknown[]) => mockSimpleRerank(...a) };
});
// Stage-1a seam: ALL mapper hydration call sites go through this import.
jest.mock('../serving/hydration-lane', () => {
    const actual = jest.requireActual('../serving/hydration-lane');
    return { ...actual, hydrateAndSelectServing: (...a: unknown[]) => mockHydrateAndSelectServing(...a) };
});
// TRAP (handoff §5): AI_NUTRITION_BACKFILL_ENABLED defaults TRUE — an unmocked
// backfill dials the jest LLM blackhole and fails as confusing ECONNREFUSED.
jest.mock('../ai-nutrition-backfill', () => ({
    requestAiNutrition: jest.fn().mockResolvedValue({ status: 'error', reason: 'skip' }),
    extractBaseFoodContext: jest.fn().mockReturnValue(null),
    getAiServingGrams: jest.fn().mockResolvedValue(null),
    createAiNutritionBudget: (max: number) => ({ remaining: max, spent: 0 }),
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
jest.mock('../../search/query-embedding', () => ({
    SEMANTIC_SEARCH_ENABLED: false,
    CORPUS_POOLING: 'cls',
    warmupEmbedder: jest.fn(),
    embedQuery: jest.fn().mockResolvedValue(null),
}));

import { mapIngredientWithFallback, type MappingTelemetry } from '../map-ingredient-with-fallback';
import {
    getValidatedMappingByNormalizedName,
    saveValidatedMapping,
    getAiNormalizeCache,
    isRowQualityEscape,
} from '../validated-mapping-helpers';
import { aiNormalizeIngredient } from '../ai-normalize';
import { findCanonicalName, getKnownSynonyms, saveSynonyms } from '../ai-synonym-generator';
import { getLearnedSynonyms, extractTermsFromIngredient } from '../learned-synonyms';
import { getCachedFoodWithRelations } from '../cache-search';
import { ensureFoodCached } from '../cache';
import { hydrateSingleCandidate } from '../hydrate-cache';
import { queueForDeferredHydration } from '../deferred-hydration';
import { backfillOnDemand } from '../serving-backfill';
import { requestAiNutrition } from '../ai-nutrition-backfill';
import { isCorruptExclusionEnabled } from '../corrupt-mark';
import type { UnifiedCandidate } from '../gather-candidates';

// ── Fixtures ────────────────────────────────────────────────────────────────

const OFF_BARCODE = '4001234567890';
const OFF_FOOD_ID = `off_${OFF_BARCODE}`;
const OFF_TARGET_KEY = `off:${OFF_BARCODE}`; // targetKeyOfFoodId(OFF_FOOD_ID)
const FDC_ID = 'fdc_555001';

/** The FoodMapping row both cache lookups can return. validatedBy 'ai' so the
 *  HUMAN_ROW_TRUST skip never fires. */
const cachedOffRow = () => ({
    source: 'openfoodfacts',
    foodId: OFF_FOOD_ID,
    foodName: 'Onion',
    brandName: null,
    servingId: null,
    servingDescription: '100 g',
    grams: 100,
    kcal: 40,
    protein: 1.1,
    carbs: 9,
    fat: 0.1,
    confidence: 0.9,
    quality: 'high' as const,
    rawLine: 'onion',
    validatedBy: 'ai',
});

/** An OffFood record that is present, plausible and unmarked — serves cleanly. */
const healthyOffRecord = () => ({
    nutrientsPer100g: { calories: 40, protein: 1.1, carbs: 9, fat: 0.1 },
    servingSize: '100 g',
    servingGrams: 100,
    corruptReason: null,
});

/** Same panel, but triage-marked corrupt ('panel-low' is a real CorruptDirection). */
const corruptOffRecord = () => ({
    ...healthyOffRecord(),
    corruptReason: 'panel-low',
});

/** FDC search candidate carrying its own panel (no hydration network). */
const fdcCandidate = (): UnifiedCandidate => ({
    id: FDC_ID,
    source: 'fdc',
    name: 'Onion',
    brandName: null,
    score: 0.9,
    foodType: 'generic',
    nutrition: { kcal: 40, protein: 1.1, carbs: 9, fat: 0.1, per100g: true },
    rawData: {
        fdcId: 555001,
        description: 'Onion',
        dataType: 'SR Legacy',
        nutrientsPer100g: { calories: 40, protein: 1.1, carbs: 9, fat: 0.1 },
        servings: [],
    },
} as unknown as UnifiedCandidate);

/** What the mocked hydration lane bills for a candidate it accepts. */
const hydrationResultFor = (cand: { id: string; name: string }, conf: number, raw: string) => ({
    source: 'fdc' as const,
    foodId: cand.id,
    foodName: cand.name,
    brandName: null,
    servingId: null,
    servingDescription: '100 g',
    grams: 100,
    kcal: 40,
    protein: 1.1,
    carbs: 9,
    fat: 0.1,
    confidence: conf,
    quality: 'high' as const,
    rawLine: raw,
});

const saveCalls = () => (saveValidatedMapping as jest.Mock).mock.calls;
const lookupMock = getValidatedMappingByNormalizedName as jest.Mock;
const hydrationCandidateIds = () =>
    mockHydrateAndSelectServing.mock.calls.map((c) => (c[0] as { id: string }).id);

beforeEach(() => {
    jest.clearAllMocks();

    (aiNormalizeIngredient as jest.Mock).mockResolvedValue({ status: 'error', reason: 'skip' });
    lookupMock.mockResolvedValue(null);
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
    (requestAiNutrition as jest.Mock).mockResolvedValue({ status: 'error', reason: 'skip' });
    mockOffFindUnique.mockResolvedValue(null);

    // Search wins by default: one FDC candidate, rerank names it.
    // 'single_candidate' is a real simpleRerank reason string.
    mockGatherCandidates.mockResolvedValue([fdcCandidate()]);
    mockSimpleRerank.mockReturnValue({
        winner: { id: FDC_ID, name: 'Onion' },
        confidence: 0.9,
        reason: 'single_candidate',
        sortedCandidates: [],
    });

    // Hydration lane: cached OFF candidates fail, everything else succeeds.
    mockHydrateAndSelectServing.mockImplementation(
        async (cand: { id: string; name: string }, _parsed: unknown, conf: number, raw: string) =>
            cand.id.startsWith('off_') ? null : hydrationResultFor(cand, conf, raw),
    );
});

describe('cluster 5 — readEscapes delivery to the one reader (the save)', () => {
    it('(a) an early-lookup row-quality escape reaches the search-produced save, site-prefixed, with the record targetKey', async () => {
        // Early lookup HITS a row whose off_ record is missing entirely →
        // the missing-nutrition safety net fires → reason 'nutrition_invalid'
        // (real string, from the mapper's own escape chain). Step 1c then
        // misses, search wins, and the save must receive the escape.
        lookupMock.mockResolvedValueOnce(cachedOffRow()); // early: hit
        // subsequent lookups (Step 1c): default null → miss

        const result = (await mapIngredientWithFallback('onion')) as { foodId: string } | null;

        expect(result?.foodId).toBe(FDC_ID);
        expect(saveCalls()).toHaveLength(1);

        const saveOptions = saveCalls()[0][3];
        expect(saveOptions.readEscapes).toEqual([
            { targetKey: OFF_TARGET_KEY, reason: 'early:nutrition_invalid' },
        ]);
        // Tie-in to the one consumer's filter: this reason IS a row-quality
        // class, so the forfeit can match it (real classifier, not a copy).
        expect(isRowQualityEscape('early:nutrition_invalid')).toBe(true);

        // One lookup call per site, legacy fallback short-circuited (the
        // unbranded symmetric and legacy keys are identical): 2 calls total.
        expect(lookupMock).toHaveBeenCalledTimes(2);
    });

    it('(a) a Step-1c corrupt_record escape is delivered with the normalized: prefix', async () => {
        // corrupt_record requires the exclusion flag, which defaults ON.
        expect(isCorruptExclusionEnabled()).toBe(true);

        // Early lookup misses, Step 1c hits a row whose OFF record is
        // triage-marked corrupt — corrupt_record outranks a VALID panel in
        // the escape chain (it is the first arm).
        let call = 0;
        lookupMock.mockImplementation(async () => (++call === 1 ? null : cachedOffRow()));
        mockOffFindUnique.mockResolvedValue(corruptOffRecord());

        const result = (await mapIngredientWithFallback('onion')) as { foodId: string } | null;

        expect(result?.foodId).toBe(FDC_ID);
        expect(saveCalls()).toHaveLength(1);
        expect(saveCalls()[0][3].readEscapes).toEqual([
            { targetKey: OFF_TARGET_KEY, reason: 'normalized:corrupt_record' },
        ]);
        expect(isRowQualityEscape('normalized:corrupt_record')).toBe(true);
    });

    it('(b) ACCUMULATION: both cache layers escaping on one request delivers BOTH records, in site order', async () => {
        // Both lookups return the same row pointing at a MISSING off_ record →
        // nutrition_invalid at the early site AND again at Step 1c. The save
        // must see an array with both, early first — not a last-write slot.
        lookupMock.mockResolvedValue(cachedOffRow());

        const telemetry: MappingTelemetry = {};
        const result = (await mapIngredientWithFallback('onion', { telemetry })) as { foodId: string } | null;

        expect(result?.foodId).toBe(FDC_ID);
        expect(saveCalls()).toHaveLength(1);
        expect(saveCalls()[0][3].readEscapes).toEqual([
            { targetKey: OFF_TARGET_KEY, reason: 'early:nutrition_invalid' },
            { targetKey: OFF_TARGET_KEY, reason: 'normalized:nutrition_invalid' },
        ]);
        // The telemetry slot IS last-write (one string), which is exactly why
        // the save takes the array: the two channels are not interchangeable.
        expect(telemetry.cacheEscape).toBe('normalized:nutrition_invalid');

        // A row-quality escape never reaches hydration — the cached candidate
        // is refused before the synthetic-candidate hydration is built.
        expect(hydrationCandidateIds()).toEqual([FDC_ID]);
    });

    it('(e) the REJECTION channel: a helper-side refusal written to the out-param reaches the save as lookup_-prefixed records', async () => {
        // The two remaining append sites read the CacheLookupRejection
        // out-param (4th argument) that getValidatedMappingByNormalizedName
        // populates via noteRejection() when a row was FOUND and REFUSED.
        // The mock plays the helper's part exactly per that contract: write a
        // REAL noteRejection reason ('core_token_mismatch' — the first arm)
        // plus the refused row's identity, and return null.
        lookupMock.mockImplementation(
            async (
                key: string,
                _source: string,
                _raw: string,
                rejection?: {
                    reason: string | null;
                    normalizedForm?: string;
                    foodName?: string;
                    targetKey?: string | null;
                },
            ) => {
                if (rejection) {
                    rejection.reason = 'core_token_mismatch';
                    rejection.normalizedForm = key;
                    rejection.foodName = 'Onion';
                    // noteRejection stores targetKeyOf(cached) — the RECORD the
                    // refused row pointed at, never the cache key.
                    rejection.targetKey = OFF_TARGET_KEY;
                }
                return null;
            },
        );

        const telemetry: MappingTelemetry = {};
        const result = (await mapIngredientWithFallback('onion', { telemetry })) as { foodId: string } | null;

        expect(result?.foodId).toBe(FDC_ID);
        expect(saveCalls()).toHaveLength(1);
        // Both lookup sites refused → BOTH rejection-channel records, in site
        // order, each carrying the record targetKey the helper wrote.
        expect(saveCalls()[0][3].readEscapes).toEqual([
            { targetKey: OFF_TARGET_KEY, reason: 'lookup_early:core_token_mismatch' },
            { targetKey: OFF_TARGET_KEY, reason: 'lookup_normalized:core_token_mismatch' },
        ]);
        expect(telemetry.cacheEscape).toBe('lookup_normalized:core_token_mismatch');

        // The forfeit tie-in cuts the OTHER way on this channel: an
        // identity-class rejection is not a row-quality escape, so delivery
        // does NOT imply the save-time forfeit can match it.
        expect(isRowQualityEscape('lookup_early:core_token_mismatch')).toBe(false);

        // One helper call per site: for this unbranded line the legacy key
        // equals the symmetric key, so the fallback short-circuits.
        expect(lookupMock).toHaveBeenCalledTimes(2);
    });

    it('(c) the early:hydration_failed fall-through is labelled but NOT recorded as a readEscape', async () => {
        // Early lookup hits a HEALTHY row (no escape reason fires); its
        // hydration fails for this request. The mapper labels telemetry
        // 'early:hydration_failed' and falls through — deliberately without
        // appending to readEscapes, so the incumbent keeps its cross-source
        // margin protection. Step 1c then misses and search wins.
        lookupMock.mockResolvedValueOnce(cachedOffRow()); // early: hit, then default null
        mockOffFindUnique.mockResolvedValue(healthyOffRecord());

        const telemetry: MappingTelemetry = {};
        const result = (await mapIngredientWithFallback('onion', { telemetry })) as { foodId: string } | null;

        expect(result?.foodId).toBe(FDC_ID);
        // The fall-through really ran: the cached candidate WAS hydrated (and
        // failed), then the search winner hydrated successfully.
        expect(hydrationCandidateIds()).toEqual([OFF_FOOD_ID, FDC_ID]);
        expect(telemetry.cacheEscape).toBe('early:hydration_failed');

        // ... and the save receives an EMPTY escape list: no forfeit.
        expect(saveCalls()).toHaveLength(1);
        expect(saveCalls()[0][3].readEscapes).toEqual([]);
    });

    it('(d) a direct-return producer (backfill serve) delivers no escapes because no outer save runs', async () => {
        // Both cache layers escape (missing off_ record), search finds NOTHING,
        // AI-simplify is inert, so the `!winner` AI-nutrition backfill serves
        // the line and returns directly — bypassing finalizeAndSaveResult().
        // The two accumulated escapes are dropped on the floor with it.
        lookupMock.mockResolvedValue(cachedOffRow());
        mockGatherCandidates.mockResolvedValue([]);
        (requestAiNutrition as jest.Mock).mockResolvedValue({
            status: 'success',
            foodId: 'clx_ai_generated_test_1',
            displayName: 'Onion (AI estimate)',
            caloriesPer100g: 40,
            proteinPer100g: 1.1,
            carbsPer100g: 9,
            fatPer100g: 0.1,
            confidence: 0.8,
            cached: false,
        });

        const telemetry: MappingTelemetry = {};
        const result = (await mapIngredientWithFallback('onion', { telemetry })) as
            | { foodId: string; source: string }
            | null;

        // The backfill really served the line…
        expect(requestAiNutrition).toHaveBeenCalledTimes(1);
        expect(result?.source).toBe('ai_generated');
        expect(result?.foodId).toBe('clx_ai_generated_test_1');

        // …the escapes were genuinely recorded on the way (telemetry shows the
        // Step-1c one), and yet NO save ever ran to receive them.
        expect(telemetry.cacheEscape).toBe('normalized:nutrition_invalid');
        expect(saveValidatedMapping).not.toHaveBeenCalled();
    });
});
