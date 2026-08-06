/**
 * Phase 1 stage 1c — CHARACTERIZATION, cluster 6: `normalizedName` invariants.
 *
 * The stage-1c census (sync-docs/reports/2026-08-06_phase-1-stage-1c-handoff.md
 * §1, mobile repo) established that every reassignment of `normalizedName`
 * completes BEFORE `let winner` is declared, so every producer in the cascade
 * reads one frozen value. The only deliberate stale-value readers are the
 * EARLY cache lookup (keys off the pre-rewrite value) and `quickGatherName`.
 * These tests pin that shape through the real `mapIngredientWithFallback()`
 * so the stage-1d extraction cannot silently move a rewrite past a reader —
 * or "fix" the early-lookup asymmetry, which is CURRENT DESIGN.
 *
 * Trigger: the unconditional bouillon+volume heuristic — `1 cup beef bouillon`
 * has `normalizedName === 'beef bouillon'` at the early lookup and the quick
 * gather, then `fatsecret.map.bouillon_broth_rewrite` rewrites it to
 * `'beef broth'` before `let winner`. Zero LLM involvement: the normalize gate
 * is stubbed to skip, so the rewrite is the run's ONLY mutation.
 *
 * MEASURED DELTA vs the census's suggested trigger (recorded here on purpose):
 * the pepper spice rewrite (`1 tsp pepper` → 'black pepper') CANNOT exercise
 * the asymmetry on this tree, because `normalizeIngredientName('pepper')`
 * already returns 'black pepper' — NOT via the rules JSON (its
 * `synonym_rewrites` has no bare 'pepper' entry) but via the hardcoded
 * context-aware bare-word rewrite block (PEPPER_COMPOUNDS / PEPPER_SUFFIXES)
 * inside `normalizeIngredientName()` in normalization-rules.ts, which runs
 * AFTER the JSON loop. It fires at the `let normalizedName` initialization,
 * BEFORE the early lookup, so the in-mapper `/^pepper$/` heuristic is
 * unreachable for that shape — and because the pre-emption is TS code, no
 * data-file drift (the box's `data/` never syncs) can re-arm the in-mapper
 * heuristic. The last describe block pins that pre-emption so 1d inherits it
 * knowingly.
 *
 * These are characterization tests: they assert what the code DOES today.
 * A failure here after 1d is a behavior change, not a broken test.
 *
 * Mock preamble mirrors `llm-output-guard-wiring.test.ts` /
 * `abstention-confidence.test.ts` (the proven seams). Two seams of note:
 *  - `../simple-rerank` is stubbed to name a winner so the run traverses the
 *    search producer into `finalizeAndSaveResult()` and we can read the save
 *    key. `reason: 'exact_match'` is a real simpleRerank winner reason
 *    (simple-rerank.ts), not an invented string.
 *  - `../serving/hydration-lane` (the stage-1a seam) is stubbed so hydration
 *    succeeds without touching serving stores.
 */

const mockHydrate = jest.fn();
const mockSimplify = jest.fn();

// Generic prisma stub: every model answers "nothing found" for any verb.
// (House pattern from abstention-confidence.test.ts — enumerating models by
// hand has previously made a sibling file assert nothing.)
jest.mock('../../db', () => {
    const emptyFor = (verb: string) =>
        jest.fn().mockResolvedValue(verb.startsWith('findMany') ? [] : null);
    const model = new Proxy({}, { get: (_t, verb: string) => emptyFor(verb) });
    return { prisma: new Proxy({}, { get: () => model }) };
});

jest.mock('../ai-normalize');
jest.mock('../normalize-gate', () => {
    const actual = jest.requireActual('../normalize-gate');
    return { ...actual, shouldNormalizeLlm: jest.fn() };
});
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
jest.mock('../simple-rerank', () => {
    const actual = jest.requireActual('../simple-rerank');
    return { ...actual, simpleRerank: jest.fn() };
});
// Stage-1a seam: ALL 10 mapper call sites route through this import.
jest.mock('../serving/hydration-lane', () => {
    const actual = jest.requireActual('../serving/hydration-lane');
    return { ...actual, hydrateAndSelectServing: (...a: unknown[]) => mockHydrate(...a) };
});
// TRAP (handoff §5): AI_NUTRITION_BACKFILL_ENABLED defaults TRUE — an unmocked
// backfill dials the jest LLM blackhole and fails as ECONNREFUSED.
jest.mock('../ai-nutrition-backfill', () => ({
    requestAiNutrition: jest.fn().mockResolvedValue({ status: 'error', reason: 'skip' }),
    extractBaseFoodContext: jest.fn().mockReturnValue(null),
    getAiServingGrams: jest.fn().mockResolvedValue(null),
    createAiNutritionBudget: (max: number) => ({ remaining: max, spent: 0 }),
}));
// Step 2b-ii seam: the mapper dynamic-imports './ai-simplify'; jest.mock still
// intercepts it (producer-simplify-exits.test.ts pattern).
jest.mock('../ai-simplify', () => {
    const actual = jest.requireActual('../ai-simplify');
    return { ...actual, aiSimplifyIngredient: (...a: unknown[]) => mockSimplify(...a) };
});
// The Mac .env sets ENABLE_MAPPING_ANALYSIS=true; unmocked, every run of this
// file wrote a real logs/mapping-analysis-*.json session file from inside jest
// (measured). Automock suffices — producer-cache-failure-research.test.ts
// proves it against the full mapper.
jest.mock('../mapping-logger');
// Unmocked, the first gather loads the real ONNX embedding model
// (embedding.model_loaded fired after every run of this file — measured).
jest.mock('../../search/query-embedding', () => ({
    SEMANTIC_SEARCH_ENABLED: false,
    CORPUS_POOLING: 'cls',
    warmupEmbedder: jest.fn(),
    embedQuery: jest.fn().mockResolvedValue(null),
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
import { aiNormalizeIngredient } from '../ai-normalize';
import { shouldNormalizeLlm } from '../normalize-gate';
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
import { gatherCandidates, type UnifiedCandidate } from '../gather-candidates';
import { simpleRerank } from '../simple-rerank';
import { requestAiNutrition } from '../ai-nutrition-backfill';
import { deriveMappingCacheKey, deriveCacheKeyName } from '../cache-key';
import { detectBrandInQuery } from '../brand-detector';
import { normalizeIngredientName } from '../normalization-rules';
import { AI_NUTRITION_BACKFILL_ENABLED } from '../config';

const LINE = '1 cup beef bouillon';
const PRE_REWRITE = 'beef bouillon';
const POST_REWRITE = 'beef broth';

/** FDC candidate carrying its own panel (abstention-confidence house shape). */
const cand = (id: string, name: string, score: number): UnifiedCandidate => ({
    id,
    source: 'fdc',
    name,
    brandName: null,
    score,
    nutrition: { kcal: 7, protein: 1.1, carbs: 0.2, fat: 0.2, per100g: true },
    servings: [{ description: '100 g', grams: 100, isDefault: true }],
    rawData: {
        fdcId: Number(id.replace('fdc_', '')),
        description: name,
        dataType: 'SR Legacy',
        nutrientsPer100g: { calories: 7, protein: 1.1, carbs: 0.2, fat: 0.2 },
        servings: [],
    },
});

// FACTORY, not a shared fixture: the mapper enriches candidate objects in
// place, so a module-scope array would leak mutations between the quick and
// full gather and across tests (the documented hazard; A()/B()/C() pattern
// from producer-billed-vs-winner.test.ts).
const BROTH_POOL = () => [
    cand('fdc_1111111', 'Beef Broth', 5.9),
    cand('fdc_2222222', 'Beef Broth Bouillon and Consomme', 4.0),
];

/** normalizedName handed to each gatherCandidates call, in call order. */
const gatherNames = () => (gatherCandidates as jest.Mock).mock.calls.map(c => c[2] as string);
const gatherOpts = () => (gatherCandidates as jest.Mock).mock.calls.map(c => (c[3] ?? {}) as Record<string, unknown>);
/** parsed as the mapper computed it — captured off the first gather call. */
const capturedParsed = () => (gatherCandidates as jest.Mock).mock.calls[0][1];
/** cache keys handed to the lookup helper, in call order. */
const lookupKeys = () => (getValidatedMappingByNormalizedName as jest.Mock).mock.calls.map(c => c[0] as string);

/** The brand input the mapper derives for a line (no options.brand passed). */
const brandInputFor = (line: string) => {
    const det = detectBrandInQuery(line);
    return { isBranded: det.isBranded, matchedBrand: det.matchedBrand };
};

const hydratedResultFor = (winner: UnifiedCandidate, confidence: number): FatsecretMappedIngredient => ({
    source: 'fdc',
    foodId: winner.id,
    foodName: winner.name,
    brandName: null,
    servingId: null,
    servingDescription: '1 cup',
    grams: 240,
    kcal: 16.8,
    protein: 2.6,
    carbs: 0.5,
    fat: 0.5,
    confidence,
    quality: 'high',
    rawLine: LINE,
});

beforeEach(() => {
    jest.clearAllMocks();
    // Normalize gate SKIPS the LLM: the heuristic rewrite is then the run's
    // only normalizedName mutation, so every delta below is attributable to it.
    (shouldNormalizeLlm as jest.Mock).mockReturnValue({ shouldCallLlm: false, reason: 'test_gate_skip', confidence: 0.9 });
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
    (gatherCandidates as jest.Mock).mockImplementation(async () => BROTH_POOL());
    mockSimplify.mockResolvedValue(null);
    // Rerank names the pool head. 'exact_match' is a REAL winner reason and
    // 0.9 clears the 0.85 save gate, so finalizeAndSaveResult() saves.
    (simpleRerank as jest.Mock).mockReturnValue({
        winner: { id: 'fdc_1111111' },
        confidence: 0.9,
        reason: 'exact_match',
        sortedCandidates: [],
    });
    mockHydrate.mockImplementation(async (winner: UnifiedCandidate, _p, confidence: number) =>
        hydratedResultFor(winner, confidence));
});

describe('FROZEN-BEFORE-CASCADE: every producer reads the final rewritten value', () => {
    it('the full gather and the save both read "beef broth", never "beef bouillon"', async () => {
        const result = await mapIngredientWithFallback(LINE);

        expect(result).not.toBeNull();
        expect((result as FatsecretMappedIngredient).foodId).toBe('fdc_1111111');

        // The FULL gather (the one retrieval actually ranks on) got the final value.
        const names = gatherNames();
        expect(names[names.length - 1]).toBe(POST_REWRITE);

        // The save ran, keyed off the SAME final value: canonicalBase is
        // deriveMappingCacheKey(finalName, …) recomputed inside finalize.
        expect(saveValidatedMapping).toHaveBeenCalledTimes(1);
        const saveCall = (saveValidatedMapping as jest.Mock).mock.calls[0];
        const expectedFinalKey = deriveMappingCacheKey(
            POST_REWRITE, capturedParsed(), brandInputFor(LINE), LINE);
        expect(saveCall[3].canonicalBase).toBe(expectedFinalKey);
        expect(saveCall[2].reason).toBe('exact_match');

        // Zero LLM: the rewrite is heuristic, not model output.
        expect(aiNormalizeIngredient).not.toHaveBeenCalled();
        expect(requestAiNutrition).not.toHaveBeenCalled();
    });

    it('KEY SYMMETRY: the Step-1c lookup key and the save key are byte-identical', async () => {
        await mapIngredientWithFallback(LINE);

        const keys = lookupKeys();
        const saveKey = (saveValidatedMapping as jest.Mock).mock.calls[0][3].canonicalBase as string;
        // The Step-1c symmetric lookup used exactly the key the save writes
        // under — the cache-key-symmetry.test.ts pin, extended through a full
        // pipeline run that includes a mid-preamble rewrite.
        expect(keys).toContain(saveKey);
        expect(keys[keys.length - 1]).toBe(saveKey);
    });
});

describe('EARLY-KEY ASYMMETRY: the early lookup keys off the PRE-rewrite value (current design — 1d must not "fix" it)', () => {
    it('first lookup call uses the "beef bouillon" key, the Step-1c call uses the "beef broth" key', async () => {
        await mapIngredientWithFallback(LINE);

        const parsed = capturedParsed();
        const brand = brandInputFor(LINE);
        const preRewriteKey = deriveMappingCacheKey(PRE_REWRITE, parsed, brand, LINE);
        const finalKey = deriveMappingCacheKey(POST_REWRITE, parsed, brand, LINE);
        expect(preRewriteKey).not.toBe(finalKey); // the asymmetry is real, not vacuous

        const keys = lookupKeys();
        // CURRENT BEHAVIOR: exactly two lookup-helper calls — early (symmetric
        // key of the pre-rewrite name) then Step-1c (symmetric key of the final
        // name). No legacy-key calls fire: with no brand detected the legacy
        // key equals the symmetric key and the fallback short-circuits inside
        // lookupValidatedMappingWithLegacyFallback().
        expect(keys).toEqual([preRewriteKey, finalKey]);
    });

    it('the quick gather also reads the PRE-rewrite value — the second stale reader the census names', async () => {
        await mapIngredientWithFallback(LINE);

        const names = gatherNames();
        expect(names.length).toBe(2);
        expect(names[0]).toBe(PRE_REWRITE);   // quick-gate gather, pre-rewrite
        expect(names[1]).toBe(POST_REWRITE);  // full gather, post-rewrite
    });
});

describe('BRANDED LEGACY FALLBACK: preBrandNormalizedName feeds the legacy key (handoff §2.6)', () => {
    it('after the brand-preservation repair, the Step-1c legacy call keys off the PRE-repair model output', async () => {
        // The LLM path this time: the gate calls the model, the model strips
        // the decisive brand ('ghost whey' → 'whey protein'), and the
        // brand-preservation repair re-injects it — setting
        // preBrandNormalizedName to the model's PRE-repair output and
        // normalizedName to 'ghost whey protein'. Fixture copied from
        // legacy-key-fallback.test.ts (proven decisive on this tree).
        const BRANDED_LINE = '1 cup ghost whey';
        const MODEL_OUTPUT = 'whey protein';
        (shouldNormalizeLlm as jest.Mock).mockReturnValue({ shouldCallLlm: true, reason: 'test_gate_call', confidence: 0.5 });
        (aiNormalizeIngredient as jest.Mock).mockResolvedValue({
            status: 'success',
            normalizedName: MODEL_OUTPUT,
            synonyms: [],
            isBranded: true,
        });

        await mapIngredientWithFallback(BRANDED_LINE);

        const parsed = capturedParsed();
        const brand = brandInputFor(BRANDED_LINE);
        // Preconditions: the static detector fires and the repair had a brand
        // to re-inject (keepBrand() prefixes matchedBrand verbatim).
        expect(brand.isBranded).toBe(true);
        expect(brand.matchedBrand).toBe('ghost');
        const repaired = `${brand.matchedBrand} ${MODEL_OUTPUT}`;

        const symmetricKey = deriveMappingCacheKey(repaired, parsed, brand, BRANDED_LINE);
        const legacyKey = deriveCacheKeyName(MODEL_OUTPUT, parsed);
        // The witness that the legacy key MUST derive from the pre-repair
        // value: deriving it from the repaired name yields the symmetric key
        // itself, and lookupValidatedMappingWithLegacyFallback()
        // short-circuits on equality — the legacy call would never fire.
        expect(deriveCacheKeyName(repaired, parsed)).toBe(symmetricKey);
        expect(legacyKey).not.toBe(symmetricKey);

        // CURRENT BEHAVIOR at the Step-1c site: symmetric (brand-prefixed)
        // key first, then — on miss — exactly the legacy key derived from
        // preBrandNormalizedName, adjacent in call order.
        const keys = lookupKeys();
        const si = keys.indexOf(symmetricKey);
        expect(si).toBeGreaterThanOrEqual(0);
        expect(keys[si + 1]).toBe(legacyKey);
    });
});

describe('REUSE INVALIDATION: a rewrite forces a full re-gather', () => {
    it('rewritten line: full gather runs fresh — no seedCandidates, FDC not skipped', async () => {
        await mapIngredientWithFallback(LINE);

        const opts = gatherOpts();
        const fullOpts = opts[opts.length - 1];
        // canReuseQuickGather requires quickGatherName === normalizedName;
        // the rewrite broke that, so the quick-gather pool is NOT re-served.
        expect(fullOpts.seedCandidates).toBeUndefined();
        expect(fullOpts.skipFdc).toBe(false);
    });

    it('control — un-rewritten line: the quick-gather pool IS re-served as seedCandidates', async () => {
        // Minimal-pair control: `1 cup beef broth` is the SAME line shape as
        // `1 cup beef bouillon` — same qty, same volume unit, differing only
        // in the token that trips the mid-preamble bouillon heuristic — so
        // the seedCandidates delta is attributable to the rewrite alone.
        // NOTE: the rules JSON rewrites 'beef broth' → 'beef stock' at the
        // `let normalizedName` init (synonym_rewrites), so both gathers read
        // 'beef stock'. An init-time rewrite is NOT a mid-preamble mutation:
        // quickGatherName === normalizedName still holds and reuse survives.
        (gatherCandidates as jest.Mock).mockImplementation(async () => [
            cand('fdc_3333333', 'Beef Stock', 5.0),
        ]);
        (simpleRerank as jest.Mock).mockReturnValue({
            winner: { id: 'fdc_3333333' },
            confidence: 0.9,
            reason: 'exact_match',
            sortedCandidates: [],
        });

        await mapIngredientWithFallback('1 cup beef broth');

        const names = gatherNames();
        expect(names).toEqual(['beef stock', 'beef stock']);
        const fullOpts = gatherOpts()[1];
        expect(Array.isArray(fullOpts.seedCandidates)).toBe(true);
        expect(fullOpts.skipFdc).toBe(true); // reuse: full gather only adds OFF + semantic
    });
});

describe('the Step-2b simplify COMPARISON reads the same frozen value', () => {
    it('a simplify result equal to the POST-rewrite value does not recurse', async () => {
        // MEASURED DELTA vs the census wording: `aiSimplifyIngredient()`
        // receives the raw `trimmed` line, NOT normalizedName (read Step
        // 2b-ii in the mapper). The frozen value is read by the recursion
        // guard `result.simplified !== normalizedName`. So the pin is on the
        // COMPARISON: returning exactly the post-rewrite value must NOT
        // re-enter the mapper. Had the guard read the PRE-rewrite value
        // ('beef bouillon'), 'beef broth' !== 'beef bouillon' would recurse
        // with rawLine 'beef broth'.
        (gatherCandidates as jest.Mock).mockResolvedValue([]); // no winner ⇒ Step 2b runs (no _skipFallback here)
        mockSimplify.mockResolvedValue({ simplified: POST_REWRITE });

        await mapIngredientWithFallback(LINE);

        expect(mockSimplify).toHaveBeenCalledTimes(1);
        expect(mockSimplify.mock.calls[0][0]).toBe(LINE);          // trimmed raw line, not normalizedName
        expect(mockSimplify.mock.calls[0][1]).toBeUndefined();     // no brand detected on this line

        // No recursion happened: both recursion sites re-enter with a NEW
        // rawLine, so every gather call carrying the original line is the
        // no-recursion witness.
        const rawLines = (gatherCandidates as jest.Mock).mock.calls.map(c => c[0] as string);
        expect(rawLines.length).toBeGreaterThan(0);
        for (const rl of rawLines) expect(rl).toBe(LINE);
        expect(saveValidatedMapping).not.toHaveBeenCalled();
    });
});

describe('the AI-nutrition backfill producer reads the same frozen value', () => {
    it('backfill site 1 receives "beef broth" and returns directly with NO save', async () => {
        // Precondition: site 1 is inside `if (AI_NUTRITION_BACKFILL_ENABLED)`.
        // A silent env flip would skip the producer and green this test
        // vacuously (producer-backfill-after-winner.test.ts pattern).
        expect(AI_NUTRITION_BACKFILL_ENABLED).toBe(true);

        // Empty pool ⇒ no winner. _skipFallback skips both recursions, so the
        // run lands on backfill site 1 (`if (!winner)`), frame-scoped.
        (gatherCandidates as jest.Mock).mockResolvedValue([]);
        (requestAiNutrition as jest.Mock).mockResolvedValue({
            status: 'success',
            foodId: 'ai_test_broth',
            displayName: 'Beef Broth',
            caloriesPer100g: 7,
            proteinPer100g: 1.1,
            carbsPer100g: 0.2,
            fatPer100g: 0.2,
            confidence: 0.9,
            cached: false,
        });

        // _skipFallback is a typed member of the options interface — no cast.
        const result = await mapIngredientWithFallback(LINE, { _skipFallback: true });

        // The backfill producer read the FINAL rewritten value.
        expect(requestAiNutrition).toHaveBeenCalledTimes(1);
        expect((requestAiNutrition as jest.Mock).mock.calls[0][0]).toBe(POST_REWRITE);

        // Direct-return exit: bypasses finalizeAndSaveResult() entirely.
        const r = result as FatsecretMappedIngredient;
        expect(r.source).toBe('ai_generated');
        expect(r.foodId).toBe('ai_test_broth');
        // getAiServingGrams (mocked null) ⇒ the flat-100g default tier.
        // 'flat_100g_default' is copied from the producer, not invented.
        expect(r.servingTier).toBe('flat_100g_default');
        expect(r.grams).toBe(100);
        expect(saveValidatedMapping).not.toHaveBeenCalled();
    });
});

describe('MEASURED DELTA: the census\'s pepper trigger is pre-empted inside normalizeIngredientName()', () => {
    it('normalizeIngredientName already rewrites "pepper" → "black pepper", so the in-mapper spice heuristic never fires', async () => {
        // The stage-1c handoff (and the plan) name `1 tsp pepper` →
        // `fatsecret.map.pepper_spice_rewrite` as the cheapest asymmetry
        // trigger. On this tree that rewrite is DEAD for the bare-'pepper'
        // shape — and the pre-emptor is NOT the rules JSON (its
        // synonym_rewrites has no bare 'pepper' entry): it is the hardcoded
        // context-aware bare-word rewrite block (PEPPER_COMPOUNDS /
        // PEPPER_SUFFIXES) in normalizeIngredientName() itself
        // (normalization-rules.ts), which fires at the
        // `let normalizedName = normalizeIngredientName(baseName)` init,
        // BEFORE the early lookup — so there is no early/late asymmetry at
        // all. Pinned so 1d inherits the pre-emption knowingly — and so this
        // assertion fails loudly if that TS block is ever removed (which
        // would silently re-arm the in-mapper heuristic). Data-file drift
        // cannot re-arm it: the pre-emptor is code, not a JSON entry.
        expect(normalizeIngredientName('pepper').cleaned).toBe('black pepper');

        (gatherCandidates as jest.Mock).mockImplementation(async () => [
            cand('fdc_4444444', 'Black Pepper', 5.9),
        ]);
        (simpleRerank as jest.Mock).mockReturnValue({
            winner: { id: 'fdc_4444444' },
            confidence: 0.9,
            reason: 'exact_match',
            sortedCandidates: [],
        });

        await mapIngredientWithFallback('1 tsp pepper');

        // BOTH gathers and BOTH lookups already see the post-rules value:
        // no mid-preamble mutation, so quick-gather reuse survives.
        expect(gatherNames()).toEqual(['black pepper', 'black pepper']);
        const keys = lookupKeys();
        expect(keys.length).toBe(2);
        expect(keys[0]).toBe(keys[1]);
        expect(Array.isArray(gatherOpts()[1].seedCandidates)).toBe(true);
    });
});
