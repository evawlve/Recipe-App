/**
 * PR D pt3 (B6 mapper side + telemetry split) — pipeline-level tests:
 *   - a normalized cache hit must NOT re-save itself (the resave is what let
 *     the escape→overwrite loop churn FoodMapping rows)
 *   - non-cache selection reasons still save, and the save key goes through
 *     deriveCacheKeyName (C1)
 *   - the former catch-all 'normalized:filter_mismatch' telemetry label is
 *     split into per-condition labels
 */

import { mapIngredientWithFallback, type MappingTelemetry } from '../map-ingredient-with-fallback';
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
        foodMapping: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
        ingredient: { findMany: jest.fn().mockResolvedValue([]) },
    },
}));

jest.mock('../ai-normalize');
// Partial mock: the db-backed cache reads/writes are stubbed, but the pure
// read-time-trust predicates (isTrustedHumanRow / isHumanTrustSkippableEscape)
// must stay REAL — the mapper's human-row trust skip depends on them.
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
    return {
        ...actual,
        getCachedFoodWithRelations: jest.fn(),
    };
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
    return {
        ...actual,
        gatherCandidates: jest.fn(),
    };
});

const lightCreamCheeseFood = {
    id: 'cc-1',
    displayName: 'Light Cream Cheese',
    ingredientName: 'light cream cheese',
    caloriesPer100g: 214,
    proteinPer100g: 8,
    carbsPer100g: 6,
    fatPer100g: 17.85,
    servings: [{ id: 'srv-1', label: '1 tbsp', grams: 14 }],
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
});

describe('normalized cache hit re-save skip (B6)', () => {
    it('serves the cached row without calling saveValidatedMapping', async () => {
        // Early lookup misses; the step-1c lookup hits.
        (getValidatedMappingByNormalizedName as jest.Mock)
            .mockResolvedValueOnce(null)
            .mockResolvedValue({
                foodId: 'cc-1',
                foodName: 'Light Cream Cheese',
                brandName: null,
                source: 'ai_generated',
                confidence: 0.9,
            });
        (getCachedFoodWithRelations as jest.Mock).mockResolvedValue(lightCreamCheeseFood);

        const result = await mapIngredientWithFallback('1 tbsp light cream cheese', {
            minConfidence: 0,
            skipFdc: true,
        });

        expect(result).not.toBeNull();
        expect(result && 'foodId' in result ? result.foodId : null).toBe('cc-1');
        // confidence 0.9 >= 0.85 would previously have re-saved the row — the
        // hit-resave skip must keep the cache write path silent.
        expect(saveValidatedMapping).not.toHaveBeenCalled();
    });

    it('still saves for non-cache selection reasons, keyed via deriveCacheKeyName', async () => {
        (gatherCandidates as jest.Mock).mockResolvedValue([
            { id: 'spin-1', source: 'ai_generated', name: 'Spinach', brandName: null, score: 0.9, foodType: 'Generic', rawData: {} },
        ]);
        (getCachedFoodWithRelations as jest.Mock).mockResolvedValue({
            id: 'spin-1',
            displayName: 'Spinach',
            ingredientName: 'spinach',
            caloriesPer100g: 23,
            proteinPer100g: 2.9,
            carbsPer100g: 3.6,
            fatPer100g: 0.4,
            servings: [{ id: 'srv-spin', label: '1 cup', grams: 30, volumeMl: 240 }],
        });

        const result = await mapIngredientWithFallback('1 cup spinach', {
            minConfidence: 0,
            skipFdc: true,
        });

        expect(result).not.toBeNull();
        expect(saveValidatedMapping).toHaveBeenCalledTimes(1);
        // C1: the save key is deriveCacheKeyName(normalizedName, parsed) — for
        // a discriminator-free line that's the canonicalized name unchanged.
        expect(saveValidatedMapping).toHaveBeenCalledWith(
            expect.anything(),
            expect.anything(),
            expect.anything(),
            expect.objectContaining({ canonicalBase: 'spinach' }),
        );
    });
});

describe('read-time trust for human-triage rows (B6, HUMAN_ROW_TRUST)', () => {
    const ORIGINAL_TRUST = process.env.HUMAN_ROW_TRUST;

    beforeEach(() => {
        delete process.env.HUMAN_ROW_TRUST; // default = trust on
    });

    afterAll(() => {
        if (ORIGINAL_TRUST === undefined) delete process.env.HUMAN_ROW_TRUST;
        else process.env.HUMAN_ROW_TRUST = ORIGINAL_TRUST;
    });

    // Query 'light cream cheese' + cached full-fat 'Cream Cheese' trips the
    // critical-modifier heuristic ('modifier_mismatch') — the mapper analogue
    // of the helper-level 'Light Mayonnaise' kill.
    function mockCachedRow(overrides: Record<string, unknown> = {}) {
        (getValidatedMappingByNormalizedName as jest.Mock)
            .mockResolvedValueOnce(null) // early lookup misses; step-1c hits
            .mockResolvedValue({
                foodId: 'cc-full',
                foodName: 'Cream Cheese',
                brandName: null,
                source: 'ai_generated',
                confidence: 0.9,
                validatedBy: 'human-triage',
                ...overrides,
            });
    }

    it('a human-triage row tripping a name-heuristic escape is SERVED, not escaped', async () => {
        // multi_ingredient heuristic: query 'jelly' is the secondary
        // ingredient of the cached 'Peanut Butter & Jelly' — normally escaped
        // (normalized:multi_ingredient), but the row is a human repoint so it
        // serves. (The modifier heuristic is exercised by the kill-switch and
        // ai-row tests below; its trust-served path additionally hits the
        // macro-verified late-hydration modifier check, which — like
        // nutrition-invalid — stays active for all rows.)
        (getValidatedMappingByNormalizedName as jest.Mock)
            .mockResolvedValueOnce(null)
            .mockResolvedValue({
                foodId: 'pbj-1',
                foodName: 'Peanut Butter & Jelly',
                brandName: null,
                source: 'ai_generated',
                confidence: 0.9,
                validatedBy: 'human-triage',
            });
        (getCachedFoodWithRelations as jest.Mock).mockResolvedValue({
            id: 'pbj-1',
            displayName: 'Peanut Butter & Jelly',
            ingredientName: 'peanut butter & jelly',
            caloriesPer100g: 250,
            proteinPer100g: 6,
            carbsPer100g: 40,
            fatPer100g: 8,
            servings: [{ id: 'srv-pbj', label: '1 tbsp', grams: 15 }],
        });

        const telemetry: MappingTelemetry = {};
        const result = await mapIngredientWithFallback('1 tbsp jelly', {
            minConfidence: 0,
            skipFdc: true,
            telemetry,
        });

        expect(telemetry.cacheEscape).toBeUndefined();
        expect(telemetry.cacheHit).toBe('normalized');
        expect(result && 'foodId' in result ? result.foodId : null).toBe('pbj-1');
        // The trusted hit is still a normalized_cache_hit — no re-save.
        expect(saveValidatedMapping).not.toHaveBeenCalled();
    });

    it('the EARLY cache block trusts human rows the same way', async () => {
        // No mockResolvedValueOnce(null): the early (pre-AI-normalize) lookup
        // hits, trips multi_ingredient, and must serve via the early path.
        (getValidatedMappingByNormalizedName as jest.Mock).mockResolvedValue({
            foodId: 'pbj-1',
            foodName: 'Peanut Butter & Jelly',
            brandName: null,
            source: 'ai_generated',
            confidence: 0.9,
            validatedBy: 'human-triage',
        });
        (getCachedFoodWithRelations as jest.Mock).mockResolvedValue({
            id: 'pbj-1',
            displayName: 'Peanut Butter & Jelly',
            ingredientName: 'peanut butter & jelly',
            caloriesPer100g: 250,
            proteinPer100g: 6,
            carbsPer100g: 40,
            fatPer100g: 8,
            servings: [{ id: 'srv-pbj', label: '1 tbsp', grams: 15 }],
        });

        const telemetry: MappingTelemetry = {};
        const result = await mapIngredientWithFallback('1 tbsp jelly', {
            minConfidence: 0,
            skipFdc: true,
            telemetry,
        });

        expect(telemetry.cacheEscape).toBeUndefined();
        expect(telemetry.cacheHit).toBe('early');
        expect(result && 'foodId' in result ? result.foodId : null).toBe('pbj-1');
    });

    it("HUMAN_ROW_TRUST='0' restores the escape (old behavior)", async () => {
        process.env.HUMAN_ROW_TRUST = '0';
        mockCachedRow();
        (gatherCandidates as jest.Mock).mockResolvedValue([
            { id: 'cc-1', source: 'ai_generated', name: 'Light Cream Cheese', brandName: null, score: 0.9, rawData: {} },
        ]);
        (getCachedFoodWithRelations as jest.Mock).mockResolvedValue(lightCreamCheeseFood);

        const telemetry: MappingTelemetry = {};
        await mapIngredientWithFallback('1 tbsp light cream cheese', {
            minConfidence: 0,
            skipFdc: true,
            telemetry,
        });

        expect(telemetry.cacheEscape).toBe('normalized:modifier_mismatch');
    });

    it("an 'ai' row tripping the same heuristic still escapes (trust is provenance-gated)", async () => {
        mockCachedRow({ validatedBy: 'ai' });
        (gatherCandidates as jest.Mock).mockResolvedValue([
            { id: 'cc-1', source: 'ai_generated', name: 'Light Cream Cheese', brandName: null, score: 0.9, rawData: {} },
        ]);
        (getCachedFoodWithRelations as jest.Mock).mockResolvedValue(lightCreamCheeseFood);

        const telemetry: MappingTelemetry = {};
        await mapIngredientWithFallback('1 tbsp light cream cheese', {
            minConfidence: 0,
            skipFdc: true,
            telemetry,
        });

        expect(telemetry.cacheEscape).toBe('normalized:modifier_mismatch');
    });

    it('nutrition-invalid STILL escapes a human-triage row (trust does not cover nutrition)', async () => {
        // Identity matches the query — only the corrupt macros (314 kcal with
        // zero protein AND carbs) can reject this row.
        mockCachedRow({
            foodId: 'off_5550001112223',
            foodName: 'Light Cream Cheese',
            source: 'openfoodfacts',
        });
        const { prisma } = jest.requireMock('../../db');
        (prisma.offFood.findUnique as jest.Mock).mockResolvedValueOnce({
            nutrientsPer100g: { calories: 314, protein: 0, carbs: 0, fat: 2.86 },
            servingSize: null,
            servingGrams: null,
        });
        (gatherCandidates as jest.Mock).mockResolvedValue([
            { id: 'cc-1', source: 'ai_generated', name: 'Light Cream Cheese', brandName: null, score: 0.9, rawData: {} },
        ]);
        (getCachedFoodWithRelations as jest.Mock).mockResolvedValue(lightCreamCheeseFood);

        const telemetry: MappingTelemetry = {};
        await mapIngredientWithFallback('1 tbsp light cream cheese', {
            minConfidence: 0,
            skipFdc: true,
            telemetry,
        });

        expect(telemetry.cacheEscape).toBe('normalized:nutrition_invalid');
    });

    it('counted-piece serving escape STILL fires on a human-triage row', async () => {
        // '4 saltine crackers' counts pieces; the cached OFF record has no
        // per-piece label — a human repoint fixes identity, not serving shape.
        mockCachedRow({
            foodId: 'off_5550001112224',
            foodName: 'Saltine Crackers',
            source: 'openfoodfacts',
        });
        const { prisma } = jest.requireMock('../../db');
        (prisma.offFood.findUnique as jest.Mock).mockResolvedValueOnce({
            nutrientsPer100g: { calories: 421, protein: 9, carbs: 74, fat: 9 },
            servingSize: null,
            servingGrams: null,
        });
        (gatherCandidates as jest.Mock).mockResolvedValue([
            { id: 'crk-1', source: 'ai_generated', name: 'Saltine Crackers', brandName: null, score: 0.9, rawData: {} },
        ]);
        (getCachedFoodWithRelations as jest.Mock).mockResolvedValue({
            id: 'crk-1',
            displayName: 'Saltine Crackers',
            ingredientName: 'saltine crackers',
            caloriesPer100g: 421,
            proteinPer100g: 9,
            carbsPer100g: 74,
            fatPer100g: 9,
            servings: [{ id: 'srv-crk', label: '1 cracker', grams: 3 }],
        });

        const telemetry: MappingTelemetry = {};
        await mapIngredientWithFallback('4 saltine crackers', {
            minConfidence: 0,
            skipFdc: true,
            telemetry,
        });

        expect(telemetry.cacheEscape).toBe('normalized:count_label');
    });

    it('cooked-grain serving escape STILL fires on a human-triage row', async () => {
        // '1 cup rice' soft-prefers a cooked basis; the cached row neither
        // names a cooked state nor shows cooked-window nutrition.
        mockCachedRow({
            foodId: 'rice-dry-1',
            foodName: 'White Rice',
            source: 'ai_generated',
        });
        (gatherCandidates as jest.Mock).mockResolvedValue([
            { id: 'rice-ck-1', source: 'ai_generated', name: 'Cooked White Rice', brandName: null, score: 0.9, rawData: {} },
        ]);
        (getCachedFoodWithRelations as jest.Mock).mockResolvedValue({
            id: 'rice-ck-1',
            displayName: 'Cooked White Rice',
            ingredientName: 'cooked white rice',
            caloriesPer100g: 130,
            proteinPer100g: 2.7,
            carbsPer100g: 28,
            fatPer100g: 0.3,
            servings: [{ id: 'srv-rice', label: '1 cup', grams: 158, volumeMl: 240 }],
        });

        const telemetry: MappingTelemetry = {};
        await mapIngredientWithFallback('1 cup rice', {
            minConfidence: 0,
            skipFdc: true,
            telemetry,
        });

        expect(telemetry.cacheEscape).toBe('normalized:grain_cooked');
    });
});

describe('cache-escape telemetry label split', () => {
    it('labels a modifier escape normalized:modifier_mismatch (was filter_mismatch)', async () => {
        (getValidatedMappingByNormalizedName as jest.Mock)
            .mockResolvedValueOnce(null)
            .mockResolvedValue({
                foodId: 'cc-full',
                foodName: 'Cream Cheese', // full-fat: fails the 'light' modifier check
                brandName: null,
                source: 'ai_generated',
                confidence: 0.9,
            });
        (gatherCandidates as jest.Mock).mockResolvedValue([
            { id: 'cc-1', source: 'ai_generated', name: 'Light Cream Cheese', brandName: null, score: 0.9, rawData: {} },
        ]);
        (getCachedFoodWithRelations as jest.Mock).mockResolvedValue(lightCreamCheeseFood);

        const telemetry: MappingTelemetry = {};
        const result = await mapIngredientWithFallback('1 tbsp light cream cheese', {
            minConfidence: 0,
            skipFdc: true,
            telemetry,
        });

        expect(telemetry.cacheEscape).toBe('normalized:modifier_mismatch');
        // The escape re-resolves to the correct (light) product.
        expect(result && 'foodName' in result ? result.foodName : '').toContain('Light');
    });
});

// ============================================================
// ESCAPED INCUMBENTS FORFEIT (2026-08-01) — mapper side.
//
// The save gate can only waive an incumbent's cross-source margin if the mapper
// actually tells it which rows the read path refused. The signal is EXPLICIT
// (options.readEscapes), so a missing thread here is silent: the save behaves
// exactly as before and the zombie row stays frozen. These tests are the only
// thing standing between "implemented" and "wired".
// ============================================================
describe('read escapes are threaded to the save gate', () => {
    it('hands saveValidatedMapping the RECORD identity of the row it escaped', async () => {
        // A cache row pointing at an OFF record that no longer resolves — the
        // read path escapes ('nutrition_invalid') and the pipeline re-resolves.
        (getValidatedMappingByNormalizedName as jest.Mock)
            .mockResolvedValueOnce(null) // early lookup misses; step-1c hits
            .mockResolvedValue({
                foodId: 'off_9999999999999',
                foodName: 'Cream Cheese',
                brandName: null,
                source: 'openfoodfacts',
                confidence: 0.98,
                validatedBy: 'ai',
            });
        (gatherCandidates as jest.Mock).mockResolvedValue([
            { id: 'cc-1', source: 'ai_generated', name: 'Light Cream Cheese', brandName: null, score: 0.9, rawData: {} },
        ]);
        (getCachedFoodWithRelations as jest.Mock).mockResolvedValue(lightCreamCheeseFood);

        const telemetry: MappingTelemetry = {};
        await mapIngredientWithFallback('1 tbsp light cream cheese', {
            minConfidence: 0,
            skipFdc: true,
            telemetry,
        });

        expect(telemetry.cacheEscape).toBe('normalized:nutrition_invalid');
        expect(saveValidatedMapping).toHaveBeenCalledTimes(1);
        const opts = (saveValidatedMapping as jest.Mock).mock.calls[0][3];
        // targetKey, not foodId and not the cache key: the save gate matches on
        // the record, because the escaped key and the save key are not always
        // the same row (AI normalize rewrites the key after the early layer).
        expect(opts.readEscapes).toEqual([
            { targetKey: 'off:9999999999999', reason: 'normalized:nutrition_invalid' },
        ]);
    });

    it('a legacy_brand_mismatch forfeit names the LEGACY row, not the symmetric-key row', async () => {
        // `CacheLookupRejection` is ONE slot shared by both lookups inside
        // lookupValidatedMappingWithLegacyFallback(). The symmetric-key lookup
        // here refuses row A and writes its identity into that slot; the legacy
        // lookup then finds brandless row B and refuses it too, on
        // legacy_brand_mismatch. That branch sets reason/normalizedForm/foodName
        // inline, so without also rewriting targetKey the escape reported row
        // B's NAME against row A's RECORD — and that object is what feeds both
        // the save-time forfeit and the cross_source_margin_waived_read_escape
        // audit line, i.e. the one counter for waivers pointed at the wrong row.
        // Both rows really were refused, so either is a legitimate forfeit; only
        // a self-consistent one is diagnosable.
        //
        // The two-key lookup is driven through the STEP-1C brand-preservation
        // repair, NOT through options.brand. It used to be the latter: the line
        // was "1 cup protein shake" with options.brand "optimum nutrition", and
        // the symmetric key was brand-prefixed only because
        // hasDecisiveBrandContext() short-circuited on token count without
        // checking the line. Now the line names the brand and AI normalize
        // strips it, which is the real production shape that makes symmetric and
        // legacy keys differ — and it yields the same two keys mocked below.
        const ROW_A = 'off:1111111111111';   // refused by the symmetric-key lookup
        const ROW_B = '2222222222222';       // refused by the legacy lookup (brand mismatch)
        (getValidatedMappingByNormalizedName as jest.Mock).mockImplementation(
            async (key: string, _src: string, _raw: string, rejection?: { reason: string | null; targetKey?: string | null }) => {
                if (key === 'nutrition optimum protein shake') {
                    // Row A found and rejected: writes reason AND targetKey.
                    if (rejection) { rejection.reason = 'core_token_mismatch'; rejection.targetKey = ROW_A; }
                    return null;
                }
                if (key === 'protein shake') {
                    // Row B: generic, carries none of the detected brand, so
                    // legacyHitReflectsBrand() is false and the branch fires.
                    return {
                        foodId: `off_${ROW_B}`,
                        foodName: 'Protein Shake',
                        brandName: null,
                        source: 'openfoodfacts',
                        confidence: 0.98,
                        validatedBy: 'ai',
                    };
                }
                return null;
            },
        );
        // First gather feeds the normalize GATE: with no candidates it returns
        // `no_candidates` and the LLM normalize runs, which is what lets the
        // brand-preservation repair set preBrandNormalizedName and so make the
        // step-1c symmetric and legacy keys differ. Later gathers feed selection.
        (gatherCandidates as jest.Mock)
            .mockResolvedValueOnce([])
            .mockResolvedValue([
                { id: 'ps-2', source: 'ai_generated', name: 'Optimum Nutrition Protein Shake', brandName: 'Optimum Nutrition', score: 0.9, rawData: {} },
            ]);
        (getCachedFoodWithRelations as jest.Mock).mockResolvedValue({
            id: 'ps-2',
            displayName: 'Optimum Nutrition Protein Shake',
            ingredientName: 'protein shake',
            caloriesPer100g: 44,
            proteinPer100g: 10,
            carbsPer100g: 1.5,
            fatPer100g: 0.4,
            servings: [{ id: 'srv-ps2', label: '1 cup', grams: 240, volumeMl: 240 }],
        });

        (aiNormalizeIngredient as jest.Mock).mockResolvedValue({
            status: 'success',
            normalizedName: 'protein shake',   // brand stripped by the model
            synonyms: [],
            isBranded: true,
        });

        await mapIngredientWithFallback('1 cup optimum nutrition protein shake', {
            minConfidence: 0,
            skipFdc: true,
            brand: 'optimum nutrition',
        });

        expect(saveValidatedMapping).toHaveBeenCalled();
        const escapes = (saveValidatedMapping as jest.Mock).mock.calls[0][3].readEscapes as
            Array<{ targetKey: string; reason: string }>;
        const brandMismatch = escapes.filter(e => e.reason.endsWith('legacy_brand_mismatch'));
        expect(brandMismatch.length).toBeGreaterThan(0);
        for (const e of brandMismatch) {
            expect(e.targetKey).toBe(`off:${ROW_B}`);
            expect(e.targetKey).not.toBe(ROW_A);
        }
    });

    it('sends an EMPTY list when nothing was escaped — a cold key forfeits nothing', async () => {
        // The negative assertion. An implementation that passed a non-empty list
        // unconditionally would waive the margin for every save in the corpus.
        (getValidatedMappingByNormalizedName as jest.Mock).mockResolvedValue(null);
        (gatherCandidates as jest.Mock).mockResolvedValue([
            { id: 'spin-1', source: 'ai_generated', name: 'Spinach', brandName: null, score: 0.9, foodType: 'Generic', rawData: {} },
        ]);
        (getCachedFoodWithRelations as jest.Mock).mockResolvedValue({
            id: 'spin-1',
            displayName: 'Spinach',
            ingredientName: 'spinach',
            caloriesPer100g: 23,
            proteinPer100g: 2.9,
            carbsPer100g: 3.6,
            fatPer100g: 0.4,
            servings: [{ id: 'srv-spin', label: '1 cup', grams: 30, volumeMl: 240 }],
        });

        await mapIngredientWithFallback('1 cup spinach', { minConfidence: 0, skipFdc: true });

        expect(saveValidatedMapping).toHaveBeenCalledTimes(1);
        expect((saveValidatedMapping as jest.Mock).mock.calls[0][3].readEscapes).toEqual([]);
    });

    it('records nothing for a row that names no record (unprefixed legacy id)', async () => {
        // targetKeyOfFoodId returns null, so there is no identity to forfeit —
        // and such a row can never be a cross-source incumbent anyway.
        (getValidatedMappingByNormalizedName as jest.Mock)
            .mockResolvedValueOnce(null)
            .mockResolvedValue({
                foodId: 'cc-full',
                foodName: 'Cream Cheese',
                brandName: null,
                source: 'ai_generated',
                confidence: 0.9,
                validatedBy: 'ai',
            });
        (gatherCandidates as jest.Mock).mockResolvedValue([
            { id: 'cc-1', source: 'ai_generated', name: 'Light Cream Cheese', brandName: null, score: 0.9, rawData: {} },
        ]);
        (getCachedFoodWithRelations as jest.Mock).mockResolvedValue(lightCreamCheeseFood);

        const telemetry: MappingTelemetry = {};
        await mapIngredientWithFallback('1 tbsp light cream cheese', {
            minConfidence: 0,
            skipFdc: true,
            telemetry,
        });

        expect(telemetry.cacheEscape).toBe('normalized:modifier_mismatch');
        expect((saveValidatedMapping as jest.Mock).mock.calls[0][3].readEscapes).toEqual([]);
    });
});
