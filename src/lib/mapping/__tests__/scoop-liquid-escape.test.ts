/**
 * Scoop-on-liquid escape (s459 pd-keyn) — pins for scoop-liquid-escape.ts and
 * its two wirings in map-ingredient-with-fallback.ts:
 *   - both cache layers escape a SCOOP line off a ready-to-drink OFF row;
 *   - the escaped request is served but NOT written back (the bare line keeps
 *     its row): funnel `save_rejected:scoop_liquid`, saveValidatedMapping
 *     never called;
 *   - the bare line, a powder row and a human-triage row are untouched;
 *   - the suppression is class-specific (a corrupt_record escape still saves).
 * Fixtures are the measured records (OffFood, live DB 2026-11-15).
 * Mock preamble copied from producer-read-escapes-delivery.test.ts.
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
// keep the real trust classifier, which this suite pins for scoop_liquid.
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
    isHumanTrustSkippableEscape,
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
import type { UnifiedCandidate } from '../gather-candidates';

import {
    isScoopUnit,
    looksReadyToDrink,
    isScoopOnLiquidRecord,
    isScoopLiquidEscape,
} from '../scoop-liquid-escape';

// ── Pure predicate ──────────────────────────────────────────────────────────

describe('looksReadyToDrink — the measured members', () => {
    it.each([
        ['muscle milk (bottle)', 'muscle milk', '1 serving (330 ml)', 330, 48.5],
        ['meal replacement shake (carton)', 'Meal replacement shake', '1 CARTON (325 ml)', 325, 95],
        ['muscle milk chocolate (bottle)', 'Muscle Milk Chocolate Protein Shake', '1 bottle (414 ml)', 414, 41.1],
        ['Ideal Protein vanilla (gram label, density arm)', 'Vanilla Protein', '335g', 335, 38.8],
    ])('%s reads as ready-to-drink', (_l, name, servingSize, servingGrams, kcalPer100g) => {
        expect(looksReadyToDrink({ name, servingSize, servingGrams, kcalPer100g })).toBe(true);
    });
});

describe('looksReadyToDrink — scoopable records stay servable', () => {
    it.each([
        ['whey powder', 'Optimum Gold Standard 100% Whey Protein', '1 scoop (32 g)', 32, 375],
        ['pre-workout, gram label', 'Pre Workout', '1 portion (10 g)', 10, 43],
        ['pre-workout, label names a scoop and the water', 'Pre-workout', '1 scoop (11 g) in 12 fl oz water', 11, 43],
        ['mashed potatoes', 'Mashed Potatoes', '1 portion (200 g)', 200, 97],
        ['meal tray, dilute and big but not drink-named', "Church's Chicken, Mashed Potatoes & Gravy", '382g', 382, 93],
        ['tuna, "can" is not a drink container', 'Bumble bee Tuna', '1 can drained (113 g)', 113, 124],
        ['ice cream, gram label', 'Vanilla ice cream', '2/3 cup (92 g)', 92, 196],
        ['dense ml-labelled food', 'Chunky Monkey', '0.5 cup (125 ml)', 125, 280],
        ['unknown calories never escape', 'muscle milk', '1 serving (330 ml)', 330, null],
        // s459 rf-keyn: dilute ml-labelled FOODS on live FoodMapping rows. A volume
        // label is not a drink; without the name gate these escape and the cold
        // pick is served — `1 scoop chipotle fajita veggies` warm 44 kcal (this
        // record) vs cold 165/183 kcal (a veggie burger), 2 of 2 draws.
        ['Chipotle fajita vegetables, ml label', 'Chipotle, Fajita Vegetables', '73.93375mL', 73.93375, 55.5],
        ['Chipotle black beans, ml label', 'Chipotle, Black Beans', '118.29399999999998mL', 118.294, 95.5],
        ['ice cream, ml label', 'Cookies And Cream', '0.75 tasse (188 ml)', 188, 117],
        ['light ice cream, ml label', 'Halo top birthday cake', '118 ml', 118, 59],
        ['curry, ml label', 'Panang curry', '0.5 cup (120 ml)', 120, 75],
        ['soup, ml label', 'French onion soup', '250 ml', 250, 19.6],
        ['yogurt cup labelled "bottle"', 'Greek Yogurt Peach', '1 bottle (207 g)', 207, 67.6],
    ])('%s', (_l, name, servingSize, servingGrams, kcalPer100g) => {
        expect(looksReadyToDrink({ name, servingSize, servingGrams, kcalPer100g })).toBe(false);
    });
});

describe('isScoopOnLiquidRecord — unit and lane gates', () => {
    const bottle = { name: 'muscle milk', servingSize: '1 serving (330 ml)', servingGrams: 330, kcalPer100g: 48.5 };
    it('fires for scoop / scoops on an off_ record', () => {
        expect(isScoopUnit('scoop')).toBe(true);
        expect(isScoopUnit('Scoops')).toBe(true);
        expect(isScoopOnLiquidRecord('scoop', 'off_0052000051032', bottle)).toBe(true);
    });
    it('never fires without the scoop unit, or off the OFF lane', () => {
        expect(isScoopOnLiquidRecord(null, 'off_0052000051032', bottle)).toBe(false);
        expect(isScoopOnLiquidRecord('cup', 'off_0052000051032', bottle)).toBe(false);
        expect(isScoopOnLiquidRecord('scoop', 'fs_123', bottle)).toBe(false);
        expect(isScoopOnLiquidRecord('scoop', 'fdc_123', bottle)).toBe(false);
    });
    it('classifies site-prefixed reasons and is human-trust-skippable', () => {
        expect(isScoopLiquidEscape('early:scoop_liquid')).toBe(true);
        expect(isScoopLiquidEscape('normalized:scoop_liquid')).toBe(true);
        expect(isScoopLiquidEscape('early:count_label')).toBe(false);
        expect(isHumanTrustSkippableEscape('scoop_liquid')).toBe(true);
    });
});

// ── Mapper wiring ───────────────────────────────────────────────────────────

const RTD_FOOD_ID = 'off_0052000051032';
const FDC_ID = 'fdc_777001';

const rtdRow = (validatedBy = 'ai') => ({
    source: 'openfoodfacts',
    foodId: RTD_FOOD_ID,
    foodName: 'muscle milk',
    brandName: 'Muscle Milk',
    servingId: null,
    servingDescription: '1 serving (330 ml)',
    grams: 330,
    kcal: 160,
    protein: 25,
    carbs: 9,
    fat: 4.5,
    confidence: 0.98,
    quality: 'high' as const,
    rawLine: 'muscle milk',
    validatedBy,
});
const rtdRecord = (corruptReason: string | null = null) => ({
    nutrientsPer100g: { calories: 48.5, protein: 7.58, carbohydrate: 2.73, fat: 1.36 },
    servingSize: '1 serving (330 ml)',
    servingGrams: 330,
    corruptReason,
});
const powderRow = () => ({ ...rtdRow(), foodId: 'off_0748927069440', foodName: 'Optimum Gold Standard 100% Whey Protein', brandName: 'Optimum Nutrition' });
const powderRecord = () => ({
    nutrientsPer100g: { calories: 375, protein: 75, carbohydrate: 12, fat: 4 },
    servingSize: '1 scoop (32 g)',
    servingGrams: 32,
    corruptReason: null,
});

const powderCandidate = (): UnifiedCandidate => ({
    id: FDC_ID,
    source: 'fdc',
    name: 'Muscle Milk protein powder',
    brandName: null,
    score: 0.95,
    foodType: 'generic',
    nutrition: { kcal: 400, protein: 50, carbs: 30, fat: 9, per100g: true },
    rawData: { fdcId: 777001, description: 'Muscle Milk protein powder', dataType: 'Branded', nutrientsPer100g: { calories: 400 }, servings: [] },
} as unknown as UnifiedCandidate);

const billed = (cand: { id: string; name: string }, conf: number, raw: string, grams: number, kcal: number) => ({
    source: cand.id.startsWith('off_') ? 'openfoodfacts' : 'fdc',
    foodId: cand.id,
    foodName: cand.name,
    brandName: null,
    servingId: null,
    servingDescription: '1 scoop',
    grams,
    kcal,
    protein: 1,
    carbs: 1,
    fat: 1,
    confidence: conf,
    quality: 'high' as const,
    rawLine: raw,
});

const saveCalls = () => (saveValidatedMapping as jest.Mock).mock.calls;
const lookupMock = getValidatedMappingByNormalizedName as jest.Mock;

beforeEach(() => {
    jest.clearAllMocks();
    (aiNormalizeIngredient as jest.Mock).mockResolvedValue({ status: 'error', reason: 'skip' });
    lookupMock.mockReset();
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
    mockGatherCandidates.mockResolvedValue([powderCandidate()]);
    mockSimpleRerank.mockReturnValue({
        winner: { id: FDC_ID, name: 'Muscle Milk protein powder' },
        confidence: 0.95,
        reason: 'single_candidate',
        sortedCandidates: [],
    });
    // Every candidate hydrates: the cached drink bills a 35 g scoop of a
    // 48.5 kcal/100 g panel (the live 17 kcal), the powder bills 140.
    mockHydrateAndSelectServing.mockImplementation(
        async (cand: { id: string; name: string }, _p: unknown, conf: number, raw: string) =>
            cand.id.startsWith('off_') ? billed(cand, conf, raw, 35, 17) : billed(cand, conf, raw, 35, 140),
    );
});

describe('mapper: a scoop line on a ready-to-drink row', () => {
    it('escapes at BOTH cache layers, serves the cold pick, and writes nothing back', async () => {
        lookupMock.mockResolvedValue(rtdRow());
        mockOffFindUnique.mockResolvedValue(rtdRecord());
        const telemetry: MappingTelemetry = {};

        const result = (await mapIngredientWithFallback('1 scoop muscle milk', { telemetry })) as { foodId: string; kcal: number } | null;

        expect(result?.foodId).toBe(FDC_ID);
        expect(result?.kcal).toBe(140);
        expect(telemetry.cacheEscape).toBe('normalized:scoop_liquid');
        expect(telemetry.cacheHit).toBeUndefined();
        expect(telemetry.funnelStage).toBe('save_rejected');
        expect(telemetry.dropReason).toBe('save_rejected:scoop_liquid');
        expect(saveCalls()).toHaveLength(0);
    });

    it('the bare line on the same row is a plain cache hit (the row stays the bare line\'s)', async () => {
        lookupMock.mockResolvedValue(rtdRow());
        mockOffFindUnique.mockResolvedValue(rtdRecord());
        const telemetry: MappingTelemetry = {};

        const result = (await mapIngredientWithFallback('muscle milk', { telemetry })) as { foodId: string } | null;

        expect(result?.foodId).toBe(RTD_FOOD_ID);
        expect(telemetry.cacheHit).toBe('early');
        expect(telemetry.cacheEscape).toBeUndefined();
        expect(saveCalls()).toHaveLength(0);
    });

    it('a scoop line on a POWDER row is a plain cache hit', async () => {
        lookupMock.mockResolvedValue(powderRow());
        mockOffFindUnique.mockResolvedValue(powderRecord());
        const telemetry: MappingTelemetry = {};

        const result = (await mapIngredientWithFallback('1 scoop whey protein', { telemetry })) as { foodId: string } | null;

        expect(result?.foodId).toBe('off_0748927069440');
        expect(telemetry.cacheHit).toBe('early');
        expect(telemetry.cacheEscape).toBeUndefined();
    });

    it('a HUMAN-TRIAGE drink row is trusted: no escape, no bypass', async () => {
        lookupMock.mockResolvedValue(rtdRow('human-triage'));
        mockOffFindUnique.mockResolvedValue(rtdRecord());
        const telemetry: MappingTelemetry = {};

        const result = (await mapIngredientWithFallback('1 scoop muscle milk', { telemetry })) as { foodId: string } | null;

        expect(result?.foodId).toBe(RTD_FOOD_ID);
        expect(telemetry.cacheHit).toBe('early');
        expect(telemetry.cacheEscape).toBeUndefined();
    });

    it('the suppression is class-specific: a corrupt_record escape on a scoop line still saves', async () => {
        lookupMock.mockResolvedValue(rtdRow());
        mockOffFindUnique.mockResolvedValue(rtdRecord('panel-low'));
        const telemetry: MappingTelemetry = {};

        await mapIngredientWithFallback('1 scoop muscle milk', { telemetry });

        expect(telemetry.cacheEscape).toBe('normalized:corrupt_record');
        expect(saveCalls()).toHaveLength(1);
        expect(saveCalls()[0][3].readEscapes.map((e: { reason: string }) => e.reason))
            .toEqual(['early:corrupt_record', 'normalized:corrupt_record']);
    });
});
