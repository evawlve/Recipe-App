/**
 * WATER-PRODUCT (s459 pd-water): the zero-calorie identity owns its name list in zero-calorie-identity.ts
 * and the mapper reads it at two seats — on the parsed name (preflight, seat 1) and on the NORMALIZED name
 * (seat 2). MEASURED cold on deploy 44: `un vaso de agua` -> normalizer `agua` -> Costa "Agua" water
 * crackers (OFF 7802215501838, 414 kcal/100 g, 33 g / 137 kcal); `2 tazas de agua` -> the same record at
 * 480 g / 1,987 kcal; `hielo` -> normalizer `ice` -> an ice-cream record at 188 kcal/100 g. Real drinks named
 * `agua ...` (jamaica, horchata, fresca, coco, tonica) keep billing their own record.
 * Mock preamble copied from spanish-gate-wiring.test.ts.
 */

import { isZeroCalorieName, lineNamesWaterOrIce, SPANISH_ZERO_CALORIE_INGREDIENTS, ZERO_CALORIE_INGREDIENTS } from '../zero-calorie-identity';

import { mapIngredientWithFallback } from '../map-ingredient-with-fallback';
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
import { shouldNormalizeLlm } from '../normalize-gate';

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
jest.mock('../ai-nutrition-backfill', () => ({
    requestAiNutrition: jest.fn().mockResolvedValue({ status: 'error', reason: 'skip' }),
    extractBaseFoodContext: jest.fn().mockReturnValue(null),
    getAiServingGrams: jest.fn().mockResolvedValue(null),
    createAiNutritionBudget: (max: number) => ({ remaining: max, spent: 0 }),
}));


/** The Costa "Agua" water-cracker record the bare query won on deploy 44 (panel per 100 g). */
const AGUA_CRACKERS = {
    id: 'off_7802215501838',
    displayName: 'Agua',
    ingredientName: 'agua',
    caloriesPer100g: 414,
    proteinPer100g: 6,
    carbsPer100g: 81.3,
    fatPer100g: 7.2,
    servings: [{ id: 'srv-agua', label: '1 serving', grams: 33 }],
};
const JAMAICA = {
    id: 'off_0850021066253',
    displayName: 'Agua de Jamaica, Hibiscus Black Tea',
    ingredientName: 'agua de jamaica',
    caloriesPer100g: 17.6,
    proteinPer100g: 0,
    carbsPer100g: 4.4,
    fatPer100g: 0,
    servings: [{ id: 'srv-jam', label: '1 bottle', grams: 453.6 }],
};

function normalizerSays(name: string): void {
    (shouldNormalizeLlm as jest.Mock).mockReturnValue({ shouldCallLlm: true, reason: 'test', confidence: 0.9 });
    (aiNormalizeIngredient as jest.Mock).mockResolvedValue({
        status: 'success',
        normalizedName: name,
        canonicalBase: name,
        prepPhrases: [],
        sizePhrases: [],
        synonyms: [],
        isBranded: false,
        isMultiIngredient: false,
    });
}

function retrievalOffers(record: typeof AGUA_CRACKERS): void {
    (gatherCandidates as jest.Mock).mockResolvedValue([
        { id: record.id, source: 'openfoodfacts', name: record.displayName, brandName: null, score: 0.95, rawData: {} },
    ]);
    (getCachedFoodWithRelations as jest.Mock).mockResolvedValue(record);
}

beforeEach(() => {
    jest.clearAllMocks();
    (shouldNormalizeLlm as jest.Mock).mockReturnValue({ shouldCallLlm: false, reason: 'test_high_confidence', confidence: 0.9 });
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

describe('isZeroCalorieName(): whole-name plain water and ice, English and Spanish', () => {
    it.each([
        'agua', 'Agua', 'agua natural', 'agua mineral', 'agua con gas', 'agua mineral sin gas',
        'agua fría', 'AGUA  FRIA', 'agua purificada', 'hielo', 'cubos de hielo',
        'water', 'ice', 'sparkling water', 'mineral water', '100% liquid',
    ])('%s is plain water or ice', (name) => {
        expect(isZeroCalorieName(name)).toBe(true);
    });

    it.each([
        // real drinks with calories keep their own name
        'agua de jamaica', 'agua de horchata', 'agua fresca', 'agua de coco', 'agua tónica', 'agua con limón',
        'agua de tamarindo', 'agua de sandía', 'coconut water', 'tonic water', 'lemon water',
        // the whole-name anchor (2026-07-21): containing water is not being water
        'canned tuna in water', 'tuna in spring water', 'un vaso de agua', 'aguacate', 'water crackers',
        '', 'leche',
    ])('%s is NOT', (name) => {
        expect(isZeroCalorieName(name)).toBe(false);
    });

    it('every list entry is already in the folded, lowercase, single-spaced form it is compared in', () => {
        for (const n of [...ZERO_CALORIE_INGREDIENTS, ...SPANISH_ZERO_CALORIE_INGREDIENTS]) {
            expect(n).toBe(n.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase().trim().replace(/\s+/g, ' '));
            expect(isZeroCalorieName(n)).toBe(true);
        }
    });
});

describe('seat 1 (parsed name): a Spanish water line never reaches retrieval', () => {
    it.each([
        ['2 tazas de agua', 474],
        ['1 taza de agua', 237],
        ['agua', 237],
        ['agua natural', 237],
        ['agua mineral sin gas', 237],
        ['16 oz agua', 473.12],
        ['hielo', 237],
    ])('%s bills water_default, 0 kcal, %d g', async (line, grams) => {
        retrievalOffers(AGUA_CRACKERS);
        const r = await mapIngredientWithFallback(line, { minConfidence: 0, skipFdc: true });
        expect(r?.foodId).toBe('water_default');
        expect(r?.kcal).toBe(0);
        expect(r?.grams).toBeCloseTo(grams, 1);
        expect(aiNormalizeIngredient).not.toHaveBeenCalled();
    });
});

describe('seat 2 (normalized name): the normalizer hands back plain water', () => {
    it('`un vaso de agua` -> `agua` bills one glass of water, not the 414 kcal/100 g crackers', async () => {
        normalizerSays('agua');
        retrievalOffers(AGUA_CRACKERS);
        const r = await mapIngredientWithFallback('un vaso de agua', { minConfidence: 0, skipFdc: true });
        expect(aiNormalizeIngredient).toHaveBeenCalled();
        expect(r?.foodId).toBe('water_default');
        expect(r?.kcal).toBe(0);
        expect(r?.grams).toBeCloseTo(237, 1);
    });

    it('`dos vasos de agua` -> `agua` bills two glasses', async () => {
        normalizerSays('agua');
        retrievalOffers(AGUA_CRACKERS);
        const r = await mapIngredientWithFallback('dos vasos de agua', { minConfidence: 0, skipFdc: true });
        expect(r?.foodId).toBe('water_default');
        expect(r?.grams).toBeCloseTo(474, 1);
    });

    it('`un vaso de agua fría` -> `agua fría` (accented answer) is water', async () => {
        normalizerSays('agua fría');
        retrievalOffers(AGUA_CRACKERS);
        const r = await mapIngredientWithFallback('un vaso de agua fría', { minConfidence: 0, skipFdc: true });
        expect(r?.foodId).toBe('water_default');
    });

    it('`un vaso de hielo` -> `ice` is water, and retrieval is never asked', async () => {
        normalizerSays('ice');
        retrievalOffers(AGUA_CRACKERS);
        const r = await mapIngredientWithFallback('un vaso de hielo', { minConfidence: 0, skipFdc: true });
        expect(r?.foodId).toBe('water_default');
        // only the quick gate gather ran (before normalize); no full gather after seat 2
        expect((gatherCandidates as jest.Mock).mock.calls.length).toBe(1);
    });

    it('`un vaso de agua de jamaica` -> `agua de jamaica` keeps its drink record', async () => {
        normalizerSays('agua de jamaica');
        retrievalOffers(JAMAICA as typeof AGUA_CRACKERS);
        const r = await mapIngredientWithFallback('un vaso de agua de jamaica', { minConfidence: 0, skipFdc: true });
        expect(r?.foodId).not.toBe('water_default');
    });

    it('`100g canned tuna in water` -> `canned tuna in water` is not water (the 2026-07-21 anchor, seat 2)', async () => {
        normalizerSays('canned tuna in water');
        const r = await mapIngredientWithFallback('100g canned tuna in water', { minConfidence: 0, skipFdc: true });
        expect(r?.foodId ?? null).not.toBe('water_default');
    });
});

describe('seat 2 reads a MODEL answer, so the user line must name water or ice (s459 rf-water)', () => {
    it.each([
        'un vaso de agua', 'dos vasos de agua', 'a glass of water', 'un vaso de hielo', 'HIELO', '1.5 liters of agua',
    ])('%s names water or ice', (line) => {
        expect(lineNamesWaterOrIce(line)).toBe(true);
    });

    it.each([
        'un electrolit', '1 packet of liquid iv', 'un suero oral', 'una botella de topo chico', 'aguacate', 'watermelon', 'iced tea', '',
    ])('%s does NOT', (line) => {
        expect(lineNamesWaterOrIce(line)).toBe(false);
    });

    it.each([
        ['un electrolit', 'agua'],
        ['1 packet of liquid iv', 'liquid'],
        ['un suero oral', 'water'],
    ])('`%s` -> model answer `%s` still goes to retrieval, never water_default', async (line, answer) => {
        normalizerSays(answer);
        retrievalOffers(JAMAICA as typeof AGUA_CRACKERS);
        const r = await mapIngredientWithFallback(line, { minConfidence: 0, skipFdc: true });
        expect(aiNormalizeIngredient).toHaveBeenCalled();
        expect(r?.foodId ?? null).not.toBe('water_default');
    });
});
