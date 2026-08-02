/**
 * FatSecret cache hits must run the same nutrition-validity check as OFF and FDC.
 *
 * THE GAP THIS CLOSES (found 2026-08-01). Steps 1a and 1c branched
 * `fdc_` / `off_` / else, and the else did
 * `prisma.aiGeneratedFood.findUnique({ where: { id: foodId } })`. That arm was
 * described as dead. It is not — it EXECUTES on every `fs_` cache hit, it just
 * can never match: MEASURED, 0 of the 149 AiGeneratedFood ids carry an
 * fs_/off_/fdc_ prefix (they are cuids), while 570 of 3,509 FoodMapping rows
 * carry an fsId. So for an fs_ hit `nutrients` stayed null, and because the
 * missing-nutrition safety net was gated on `startsWith('off_')`, the hit
 * bypassed hasNullOrInvalidMacros() entirely and was served unchecked.
 *
 * WHAT THE CHECK MUST NOT DO. The first draft escaped whenever
 * `nutrientsPer100g` was `{}`. MEASURED 2026-08-01 on the live box, that is a
 * 100%-false-positive rule: of the 570 fs_ cache rows, 35 have an empty panel
 * and ALL 35 also carry a macro-bearing serving, i.e. every one is correctly
 * billable today —
 *   SELECT count(*) FROM "FoodMapping" m
 *     JOIN "FatSecretFood" f ON f."fsId"=m."fsId"
 *    WHERE f."nutrientsPer100g"::text='{}'
 *      AND EXISTS (SELECT 1 FROM "FatSecretServing" s
 *                   WHERE s."fsId"=f."fsId" AND s.nutrients->>'calories' IS NOT NULL);
 *   -> 35 ; the NOT EXISTS form -> 0
 * They are chain menu items — "Pad Thai (Small)" (usedCount 127), "Quarter
 * Pounder with Cheese", "Filet-O-Fish" — and buildFatSecretResult() bills them
 * through its `anyServingHasMacros` branch, which exists for exactly this shape.
 * So the escape decision asks the billing question through the billing path's
 * own reader, servingMacros(): escape only when the panel is empty AND no
 * serving yields macros (MEASURED: 0 live rows).
 *
 * The remaining 535 pass unchanged, including "Stevia" (0 kcal / 50g carbs),
 * which only survives because the food NAME is now passed to
 * hasNullOrInvalidMacros so its sweetener exception can apply.
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

const fsCacheRow = {
    foodId: 'fs_69219858',
    foodName: 'Ten Vegetable Soup - Bowl',
    brandName: null,
    source: 'fatsecret',
    confidence: 0.9,
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

describe('Step 1a: fs_ early cache hits are nutrition-validated', () => {
    it('escapes an fs_ hit whose FatSecretFood panel is empty and carries no servings', async () => {
        (getValidatedMappingByNormalizedName as jest.Mock).mockResolvedValueOnce(fsCacheRow).mockResolvedValue(null);
        // Panel {} AND no servings at all — nothing to bill from either basis.
        // NOTE: this is NOT the shape of the 35 measured empty-panel rows; every
        // one of those has a macro-bearing serving and is covered by the
        // does-NOT-escape case below.
        (prisma.fatSecretFood.findUnique as jest.Mock).mockResolvedValue({ nutrientsPer100g: {}, servings: [] });

        const telemetry: MappingTelemetry = {};
        await mapIngredientWithFallback('1 bowl ten vegetable soup', {
            minConfidence: 0,
            skipFdc: true,
            telemetry,
        });

        // It must have LOOKED at FatSecretFood, keyed on the un-prefixed fsId...
        expect(prisma.fatSecretFood.findUnique).toHaveBeenCalledWith(
            expect.objectContaining({ where: { fsId: '69219858' } }),
        );
        // ...and it must NOT have gone hunting in AiGeneratedFood for an fs_ id,
        // which is what the old else-arm did on every fs_ hit. (Other call sites
        // legitimately query that table by ingredientName; only an id lookup with
        // an fs_-prefixed id is the bug.)
        expect(prisma.aiGeneratedFood.findUnique).not.toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'fs_69219858' } }),
        );
        // The whole point: the hit is refused, not served with null nutrition.
        expect(telemetry.cacheEscape).toBe('early:nutrition_invalid');
    });

    // THE false-positive guard. An empty per-100g panel is NOT "no nutrition" for
    // the fs lane: FatSecret's generic restaurant records are `nutrientsPer100g={}`
    // plus a gram-less "1 serving" carrying the real macros, and
    // buildFatSecretResult() bills those directly (its `anyServingHasMacros`
    // branch). MEASURED 2026-08-01 on the live DB: ALL 35 empty-panel fs_ mappings
    // have a macro-bearing serving, and 0 do not —
    //   SELECT count(*) FROM "FoodMapping" m JOIN "FatSecretFood" f ON f."fsId"=m."fsId"
    //    WHERE f."nutrientsPer100g"::text='{}'
    //      AND EXISTS (SELECT 1 FROM "FatSecretServing" s
    //                   WHERE s."fsId"=f."fsId" AND s.nutrients->>'calories' IS NOT NULL);
    //   -> 35 ; NOT EXISTS -> 0
    // so escaping on the panel alone was a 100%-false-positive rule that would
    // re-resolve "Quarter Pounder with Cheese" on every request forever.
    it('does NOT escape an empty-panel fs_ hit that has macro-bearing servings', async () => {
        (getValidatedMappingByNormalizedName as jest.Mock)
            .mockResolvedValueOnce({ ...fsCacheRow, foodName: 'Quarter Pounder with Cheese' })
            .mockResolvedValue(null);
        // The real measured shape (fsId 42331): panel {}, one gram-less serving
        // carrying full macros.
        (prisma.fatSecretFood.findUnique as jest.Mock).mockResolvedValue({
            fsId: '69219858',
            name: 'Quarter Pounder with Cheese',
            nutrientsPer100g: {},
            fetchedAt: new Date(),
            servings: [{
                servingId: 's1',
                description: '1 serving',
                measurementDescription: null,
                grams: null,
                volumeMl: null,
                numberOfUnits: 1,
                nutrients: { calories: 520, protein: 30, carbohydrate: 42, fat: 26 },
            }],
        });

        const telemetry: MappingTelemetry = {};
        await mapIngredientWithFallback('1 quarter pounder with cheese', {
            minConfidence: 0,
            skipFdc: true,
            telemetry,
        });

        // The mutation this kills: reverting to `nutrients == null => invalid`
        // for fs_ makes this 'early:nutrition_invalid'.
        expect(telemetry.cacheEscape).not.toBe('early:nutrition_invalid');
        // And it must have ASKED the servings question — a panel-only select
        // cannot answer it.
        expect(prisma.fatSecretFood.findUnique).toHaveBeenCalledWith(
            expect.objectContaining({
                select: expect.objectContaining({ servings: expect.anything() }),
            }),
        );
    });

    it('escapes an fs_ hit with an empty panel AND no macro-bearing serving', async () => {
        (getValidatedMappingByNormalizedName as jest.Mock).mockResolvedValueOnce(fsCacheRow).mockResolvedValue(null);
        // Neither billing basis exists. MEASURED 0 live rows in this state today,
        // so this arm is a guard against future ingests.
        (prisma.fatSecretFood.findUnique as jest.Mock).mockResolvedValue({
            nutrientsPer100g: {},
            servings: [{ servingId: 's1', description: '1 serving', grams: null, nutrients: {} }],
        });

        const telemetry: MappingTelemetry = {};
        await mapIngredientWithFallback('1 bowl ten vegetable soup', {
            minConfidence: 0,
            skipFdc: true,
            telemetry,
        });

        expect(telemetry.cacheEscape).toBe('early:nutrition_invalid');
    });

    it('escapes an fs_ hit whose macros are invalid', async () => {
        (getValidatedMappingByNormalizedName as jest.Mock).mockResolvedValueOnce({ ...fsCacheRow, foodName: 'Chicken Breast' }).mockResolvedValue(null);
        // 314 kcal with zero protein AND zero carbs and little fat — the red-lentil
        // corruption shape hasNullOrInvalidMacros exists to catch.
        (prisma.fatSecretFood.findUnique as jest.Mock).mockResolvedValue({
            nutrientsPer100g: { calories: 314, protein: 0, carbs: 0, fat: 2.86 },
        });

        const telemetry: MappingTelemetry = {};
        await mapIngredientWithFallback('100 g chicken breast', {
            minConfidence: 0,
            skipFdc: true,
            telemetry,
        });

        expect(telemetry.cacheEscape).toBe('early:nutrition_invalid');
    });

    it('serves an fs_ hit whose panel is valid', async () => {
        (getValidatedMappingByNormalizedName as jest.Mock).mockResolvedValueOnce({ ...fsCacheRow, foodName: 'Granola Bar' }).mockResolvedValue(null);
        (prisma.fatSecretFood.findUnique as jest.Mock).mockResolvedValue({
            fsId: '69219858',
            name: 'Granola Bar',
            nutrientsPer100g: { calories: 400, protein: 33.33, carbs: 46.67, fat: 13.33 },
            fetchedAt: new Date(),
            servings: [{ servingId: 's1', description: '1 bar', grams: 40, isDefault: true }],
        });
        (getCachedFoodWithRelations as jest.Mock).mockResolvedValue({
            id: 'fs_69219858',
            displayName: 'Granola Bar',
            ingredientName: 'granola bar',
            caloriesPer100g: 400,
            proteinPer100g: 33.33,
            carbsPer100g: 46.67,
            fatPer100g: 13.33,
            servings: [{ id: 'srv-1', label: '1 bar', grams: 40 }],
        });

        const telemetry: MappingTelemetry = {};
        const result = await mapIngredientWithFallback('1 granola bar', {
            minConfidence: 0,
            skipFdc: true,
            telemetry,
        });

        // 535 of the 570 measured rows are in this state and must be unaffected.
        expect(telemetry.cacheEscape).toBeUndefined();
        expect(result && 'foodId' in result ? result.foodId : null).toBe('fs_69219858');
    });

    it('passes the cached food NAME to the validity check, so the sweetener exception applies', async () => {
        (getValidatedMappingByNormalizedName as jest.Mock).mockResolvedValueOnce({ ...fsCacheRow, foodId: 'fs_555', foodName: 'Stevia' }).mockResolvedValue(null);
        // Measured live row: 0 kcal against 50g carbs. Without the name this trips
        // the macro/calorie consistency check; with it, the sweetener exception holds.
        (prisma.fatSecretFood.findUnique as jest.Mock).mockResolvedValue({
            fsId: '555',
            name: 'Stevia',
            nutrientsPer100g: { calories: 0, protein: 0, carbs: 50, fat: 0 },
            fetchedAt: new Date(),
            servings: [{ servingId: 's1', description: '1 packet', grams: 1, isDefault: true }],
        });
        (getCachedFoodWithRelations as jest.Mock).mockResolvedValue({
            id: 'fs_555',
            displayName: 'Stevia',
            ingredientName: 'stevia',
            caloriesPer100g: 0,
            proteinPer100g: 0,
            carbsPer100g: 50,
            fatPer100g: 0,
            servings: [{ id: 'srv-s', label: '1 packet', grams: 1 }],
        });

        const telemetry: MappingTelemetry = {};
        await mapIngredientWithFallback('1 packet stevia', {
            minConfidence: 0,
            skipFdc: true,
            telemetry,
        });

        expect(telemetry.cacheEscape).toBeUndefined();
    });
});

describe('Step 1c: fs_ normalized cache hits are nutrition-validated', () => {
    // Step 1c's copy of the false-positive guard. Both blocks must agree — the
    // whole defect class here is one of the two drifting from the other.
    it('does NOT escape an empty-panel fs_ normalized hit that has macro-bearing servings', async () => {
        // Same query/foodName pair as the escaping Step 1c cases below, so the
        // ONLY thing that differs is the servings — otherwise the test can pass
        // on an unrelated escape (an earlier draft passed on
        // 'normalized:core_token_mismatch' and would not have caught the bug).
        (getValidatedMappingByNormalizedName as jest.Mock)
            .mockResolvedValueOnce(null)
            .mockResolvedValue(fsCacheRow);
        (prisma.fatSecretFood.findUnique as jest.Mock).mockResolvedValue({
            fsId: '69219858',
            name: 'Ten Vegetable Soup - Bowl',
            nutrientsPer100g: {},
            fetchedAt: new Date(),
            servings: [{
                servingId: 's1',
                description: '1 serving',
                measurementDescription: null,
                grams: null,
                volumeMl: null,
                numberOfUnits: 1,
                nutrients: { calories: 610, protein: 21, carbohydrate: 84, fat: 22 },
            }],
        });

        const telemetry: MappingTelemetry = {};
        await mapIngredientWithFallback('ten vegetable soup', {
            minConfidence: 0,
            skipFdc: true,
            telemetry,
        });

        expect(telemetry.cacheEscape).not.toBe('normalized:nutrition_invalid');
    });

    it('escapes an fs_ normalized hit whose panel is empty and carries no servings', async () => {
        // Early lookup misses; the Step 1c lookup hits.
        (getValidatedMappingByNormalizedName as jest.Mock)
            .mockResolvedValueOnce(null)
            .mockResolvedValue(fsCacheRow);
        (prisma.fatSecretFood.findUnique as jest.Mock).mockResolvedValue({ nutrientsPer100g: {}, servings: [] });

        const telemetry: MappingTelemetry = {};
        await mapIngredientWithFallback('ten vegetable soup', {
            minConfidence: 0,
            skipFdc: true,
            telemetry,
        });

        expect(prisma.fatSecretFood.findUnique).toHaveBeenCalledWith(
            expect.objectContaining({ where: { fsId: '69219858' } }),
        );
        expect(prisma.aiGeneratedFood.findUnique).not.toHaveBeenCalledWith(
            expect.objectContaining({ where: { id: 'fs_69219858' } }),
        );
        expect(telemetry.cacheEscape).toBe('normalized:nutrition_invalid');
    });

    it('escapes an fs_ normalized hit when the FatSecretFood row is missing entirely', async () => {
        // Early lookup misses; the Step 1c lookup hits.
        (getValidatedMappingByNormalizedName as jest.Mock)
            .mockResolvedValueOnce(null)
            .mockResolvedValue(fsCacheRow);
        (prisma.fatSecretFood.findUnique as jest.Mock).mockResolvedValue(null);

        const telemetry: MappingTelemetry = {};
        await mapIngredientWithFallback('ten vegetable soup', {
            minConfidence: 0,
            skipFdc: true,
            telemetry,
        });

        expect(telemetry.cacheEscape).toBe('normalized:nutrition_invalid');
    });
});
