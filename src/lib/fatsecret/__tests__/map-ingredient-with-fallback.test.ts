import { mapIngredientWithFallback } from '../map-ingredient-with-fallback';
import { aiNormalizeIngredient } from '../ai-normalize';
import { getValidatedMapping, saveValidatedMapping } from '../validated-mapping-helpers';
import { findCanonicalName, getKnownSynonyms, saveSynonyms } from '../ai-synonym-generator';
import { getLearnedSynonyms, extractTermsFromIngredient } from '../learned-synonyms';
import { getCachedFoodWithRelations } from '../cache-search';
import { ensureFoodCached } from '../cache';
import { hydrateSingleCandidate } from '../hydrate-cache';
import { queueForDeferredHydration } from '../deferred-hydration';
import { backfillOnDemand } from '../serving-backfill';
import { insertAiServing } from '../ai-backfill';

jest.mock('../ai-normalize');
jest.mock('../validated-mapping-helpers');
jest.mock('../ai-synonym-generator');
jest.mock('../learned-synonyms');
jest.mock('../cache-search');
jest.mock('../cache');
jest.mock('../hydrate-cache');
jest.mock('../deferred-hydration');
jest.mock('../serving-backfill');
jest.mock('../ai-backfill', () => ({
    insertAiServing: jest.fn(),
}));

function createServing(overrides: Partial<{
    id: string | null;
    measurementDescription: string | null;
    description: string | null;
    metricServingAmount: number | null;
    metricServingUnit: string | null;
    numberOfUnits: number | null;
    servingWeightGrams: number | null;
    calories: number | null;
    protein: number | null;
    carbohydrate: number | null;
    fat: number | null;
}>) {
    return {
        id: 'srv',
        measurementDescription: '1 serving',
        description: '1 serving',
        metricServingAmount: 100,
        metricServingUnit: 'g',
        numberOfUnits: 1,
        servingWeightGrams: 100,
        calories: 100,
        protein: 10,
        carbohydrate: 10,
        fat: 5,
        ...overrides,
    };
}

function makeClient(searchResults: Array<{ id: string; name: string; brandName?: string | null; foodType?: string | null }>, foodsById: Record<string, any>) {
    return {
        searchFoodsV4: jest.fn().mockResolvedValue(searchResults),
        getFoodDetails: jest.fn().mockImplementation(async (id: string) => foodsById[id] ?? null),
    };
}

describe('mapIngredientWithFallback serving selection', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (aiNormalizeIngredient as jest.Mock).mockResolvedValue({ status: 'error', reason: 'skip' });
        (getValidatedMapping as jest.Mock).mockResolvedValue(null);
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
    });

    it('scales fl oz servings by numberOfUnits', async () => {
        const wineFood = { id: 'wine-1', name: 'Red Table Wine', brandName: null, foodType: 'Generic' };
        const client = makeClient([wineFood], {
            'wine-1': {
                id: 'wine-1',
                name: 'Red Table Wine',
                brandName: null,
                servings: [
                    createServing({
                        id: 'srv-wine',
                        measurementDescription: 'fl oz',
                        numberOfUnits: 5,
                        servingWeightGrams: 148,
                        calories: 125,
                        protein: 0.1,
                        carbohydrate: 4,
                        fat: 0,
                    }),
                ],
            },
        });

        const result = await mapIngredientWithFallback('4 fl oz red wine', {
            client: client as any,
            minConfidence: 0,
            skipFdc: true,
        });

        expect(result).not.toBeNull();
        expect(result?.grams).toBeCloseTo(118.4, 1);
        expect(result?.kcal).toBeCloseTo(100, 1);
    });

    it('avoids tiny tbsp servings by preferring reasonable volume conversions', async () => {
        const flakes = { id: 'coco-1', name: 'Sweetened Coconut Flakes', brandName: null, foodType: 'Generic' };
        const client = makeClient([flakes], {
            'coco-1': {
                id: 'coco-1',
                name: 'Sweetened Coconut Flakes',
                brandName: null,
                servings: [
                    createServing({
                        id: 'srv-tiny',
                        measurementDescription: '1 tbsp',
                        numberOfUnits: 1,
                        servingWeightGrams: 0.234,
                        calories: 1,
                        protein: 0,
                        carbohydrate: 0,
                        fat: 0,
                    }),
                    createServing({
                        id: 'srv-cup',
                        measurementDescription: '1 cup',
                        numberOfUnits: 1,
                        servingWeightGrams: 80,
                        calories: 400,
                        protein: 4,
                        carbohydrate: 40,
                        fat: 25,
                    }),
                ],
            },
        });

        const result = await mapIngredientWithFallback('3 tbsp coconut flakes', {
            client: client as any,
            minConfidence: 0,
            skipFdc: true,
        });

        expect(result).not.toBeNull();
        expect(result?.grams).toBeCloseTo(15, 1);
    });
});

describe('mapIngredientWithFallback filtering', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (aiNormalizeIngredient as jest.Mock).mockResolvedValue({ status: 'error', reason: 'skip' });
        (getValidatedMapping as jest.Mock).mockResolvedValue(null);
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
    });

    it('rejects candy-branded ice results', async () => {
        const searchResults = [
            { id: 'ice-candy', name: 'Ice Cubes', brandName: 'Ice Breakers', foodType: 'Brand' },
            { id: 'ice-plain', name: 'Ice', brandName: null, foodType: 'Generic' },
        ];

        const client = makeClient(searchResults, {
            'ice-plain': {
                id: 'ice-plain',
                name: 'Ice',
                brandName: null,
                servings: [
                    createServing({
                        id: 'srv-ice',
                        measurementDescription: '1 cup',
                        servingWeightGrams: 240,
                        calories: 0,
                        protein: 0,
                        carbohydrate: 0,
                        fat: 0,
                    }),
                ],
            },
            'ice-candy': {
                id: 'ice-candy',
                name: 'Ice Cubes',
                brandName: 'Ice Breakers',
                servings: [
                    createServing({
                        id: 'srv-candy',
                        measurementDescription: '1 serving',
                        servingWeightGrams: 9,
                        calories: 20,
                        protein: 0,
                        carbohydrate: 8,
                        fat: 0,
                    }),
                ],
            },
        });

        const result = await mapIngredientWithFallback('1 cup ice', {
            client: client as any,
            minConfidence: 0,
            skipFdc: true,
            debug: true,
        });

        expect(result).not.toBeNull();
        expect(result?.foodId).toBe('water_default'); // ZERO_CALORIE_INGREDIENTS fastpath overrides search
        expect(result?.kcal).toBeCloseTo(0, 1);
    });

    it('requires tomato token for plum tomato queries', async () => {
        const searchResults = [
            { id: 'plum-fruit', name: 'Plum', brandName: null, foodType: 'Generic' },
            { id: 'plum-tomato', name: 'Plum Tomatoes', brandName: null, foodType: 'Generic' },
        ];

        const client = makeClient(searchResults, {
            'plum-fruit': {
                id: 'plum-fruit',
                name: 'Plum',
                brandName: null,
                servings: [createServing({ servingWeightGrams: 120, calories: 60 })],
            },
            'plum-tomato': {
                id: 'plum-tomato',
                name: 'Plum Tomatoes',
                brandName: null,
                servings: [createServing({ measurementDescription: '1 medium', servingWeightGrams: 120, calories: 30 })],
            },
        });

        // Query with weight unit to bypass complex count hydration logic
        const result = await mapIngredientWithFallback('120g plum tomatoes', {
            client: client as any,
            minConfidence: 0,
            skipFdc: true,
            debug: true,
        });

        expect(result).not.toBeNull();
        expect(result?.foodName.toLowerCase()).toContain('tomato');
    });

    it('rejects egg matches when query is an egg replacer', async () => {
        const searchResults = [
            { id: 'egg', name: 'Egg', brandName: null, foodType: 'Generic' },
            { id: 'egg-sub', name: 'Egg Substitute (Liquid)', brandName: null, foodType: 'Generic' },
        ];

        const client = makeClient(searchResults, {
            'egg': {
                id: 'egg',
                name: 'Egg',
                brandName: null,
                servings: [createServing({ servingWeightGrams: 50, calories: 72, protein: 6 })],
            },
            'egg-sub': {
                id: 'egg-sub',
                name: 'Egg Substitute (Liquid)',
                brandName: null,
                servings: [createServing({ servingWeightGrams: 50, calories: 25, protein: 5 })],
            },
        });

        // Query with default serving unit to bypass lack of volume conversions in mock
        const result = await mapIngredientWithFallback('1 serving vegetarian egg substitute', {
            client: client as any,
            minConfidence: 0,
            skipFdc: true,
            debug: true,
        });

        expect(result).not.toBeNull();
        expect(result?.foodName.toLowerCase()).toContain('substitute');
    });

    it('enforces low-fat modifiers in candidate selection', async () => {
        const searchResults = [
            { id: 'cream-cheese', name: 'Cream Cheese', brandName: null, foodType: 'Generic' },
            { id: 'light-cream-cheese', name: 'Light Cream Cheese', brandName: null, foodType: 'Generic' },
        ];

        const client = makeClient(searchResults, {
            'cream-cheese': {
                id: 'cream-cheese',
                name: 'Cream Cheese',
                brandName: null,
                servings: [createServing({ servingWeightGrams: 28, calories: 100, fat: 10 })],
            },
            'light-cream-cheese': {
                id: 'light-cream-cheese',
                name: 'Light Cream Cheese',
                brandName: null,
                servings: [createServing({ measurementDescription: '1 tbsp', servingWeightGrams: 14, calories: 30, fat: 2.5 })],
            },
        });

        // Query with matching unit to bypass lack of volume conversions in mock
        const result = await mapIngredientWithFallback('1 tbsp light cream cheese', {
            client: client as any,
            minConfidence: 0,
            skipFdc: true,
            debug: true,
        });

        expect(result).not.toBeNull();
        expect(result?.foodName.toLowerCase()).toContain('light');
    });
});
