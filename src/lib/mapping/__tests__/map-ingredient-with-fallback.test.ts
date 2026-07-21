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
import { gatherCandidates } from '../gather-candidates';

jest.mock('../../db', () => ({
  prisma: {
    fdcFood: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    offFood: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    aiGeneratedFood: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    foodMapping: {
      findUnique: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
    },
    ingredient: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  },
}));

jest.mock('../ai-normalize');
jest.mock('../validated-mapping-helpers');
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
        
        (gatherCandidates as jest.Mock).mockResolvedValue([
            {
                id: 'wine-1',
                source: 'ai_generated',
                name: 'Red Table Wine',
                brandName: null,
                score: 1.0,
                rawData: wineFood
            }
        ]);

        (getCachedFoodWithRelations as jest.Mock).mockResolvedValue({
            id: 'wine-1',
            displayName: 'Red Table Wine',
            ingredientName: 'red wine',
            caloriesPer100g: 84.459, // 125 kcal per 148g
            proteinPer100g: 0.067,
            carbsPer100g: 2.7,
            fatPer100g: 0,
            servings: [
                {
                    id: 'srv-wine',
                    label: 'fl oz',
                    grams: 29.6, // 148 / 5
                    volumeMl: 29.6,
                }
            ]
        });

        const result = await mapIngredientWithFallback('4 fl oz red wine', {
            minConfidence: 0,
            skipFdc: true,
        });

        expect(result).not.toBeNull();
        expect(result?.grams).toBeCloseTo(118.4, 1);
        expect(result?.kcal).toBeCloseTo(100, 1);
    });

    it('avoids tiny tbsp servings by preferring reasonable volume conversions', async () => {
        const flakes = { id: 'coco-1', name: 'Sweetened Coconut Flakes', brandName: null, foodType: 'Generic' };
        
        (gatherCandidates as jest.Mock).mockResolvedValue([
            {
                id: 'coco-1',
                source: 'ai_generated',
                name: 'Sweetened Coconut Flakes',
                brandName: null,
                score: 1.0,
                rawData: flakes
            }
        ]);

        (getCachedFoodWithRelations as jest.Mock).mockResolvedValue({
            id: 'coco-1',
            displayName: 'Sweetened Coconut Flakes',
            ingredientName: 'coconut flakes',
            caloriesPer100g: 500, // 400 kcal per 80g
            proteinPer100g: 5,
            carbsPer100g: 50,
            fatPer100g: 31.25,
            servings: [
                {
                    id: 'srv-tiny',
                    label: '1 tbsp',
                    grams: 0.234,
                },
                {
                    id: 'srv-cup',
                    label: '1 cup',
                    grams: 80,
                    volumeMl: 240,
                }
            ]
        });

        const result = await mapIngredientWithFallback('3 tbsp coconut flakes', {
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
            minConfidence: 0,
            skipFdc: true,
            debug: true,
        });

        expect(result).not.toBeNull();
        expect(result?.foodId).toBe('water_default'); // ZERO_CALORIE_INGREDIENTS fastpath overrides search
        expect(result?.kcal).toBeCloseTo(0, 1);
    });

    it('requires tomato token for plum tomato queries', async () => {
        (gatherCandidates as jest.Mock).mockResolvedValue([
            { id: 'plum-fruit', source: 'ai_generated', name: 'Plum', brandName: null, score: 0.9, rawData: {} },
            { id: 'plum-tomato', source: 'ai_generated', name: 'Plum Tomatoes', brandName: null, score: 0.8, rawData: {} }
        ]);

        (getCachedFoodWithRelations as jest.Mock).mockImplementation(async (id: string) => {
            if (id === 'plum-fruit') {
                return {
                    id: 'plum-fruit',
                    displayName: 'Plum',
                    ingredientName: 'plum',
                    caloriesPer100g: 50,
                    proteinPer100g: 1,
                    carbsPer100g: 12,
                    fatPer100g: 0.5,
                    servings: [{ id: 'srv-1', label: 'serving', grams: 120 }]
                };
            }
            if (id === 'plum-tomato') {
                return {
                    id: 'plum-tomato',
                    displayName: 'Plum Tomatoes',
                    ingredientName: 'plum tomatoes',
                    caloriesPer100g: 25,
                    proteinPer100g: 1,
                    carbsPer100g: 5,
                    fatPer100g: 0.2,
                    servings: [{ id: 'srv-2', label: '1 medium', grams: 120 }]
                };
            }
            return null;
        });

        // Query with weight unit to bypass complex count hydration logic
        const result = await mapIngredientWithFallback('120g plum tomatoes', {
            minConfidence: 0,
            skipFdc: true,
            debug: true,
        });

        expect(result).not.toBeNull();
        expect(result?.foodName.toLowerCase()).toContain('tomato');
    });

    it('rejects egg matches when query is an egg replacer', async () => {
        (gatherCandidates as jest.Mock).mockResolvedValue([
            { id: 'egg', source: 'ai_generated', name: 'Egg', brandName: null, score: 0.9, rawData: {} },
            { id: 'egg-sub', source: 'ai_generated', name: 'Egg Substitute (Liquid)', brandName: null, score: 0.8, rawData: {} }
        ]);

        (getCachedFoodWithRelations as jest.Mock).mockImplementation(async (id: string) => {
            if (id === 'egg') {
                return {
                    id: 'egg',
                    displayName: 'Egg',
                    ingredientName: 'egg',
                    caloriesPer100g: 144,
                    proteinPer100g: 12,
                    carbsPer100g: 0,
                    fatPer100g: 10,
                    servings: [{ id: 'srv-1', label: 'serving', grams: 50 }]
                };
            }
            if (id === 'egg-sub') {
                return {
                    id: 'egg-sub',
                    displayName: 'Egg Substitute (Liquid)',
                    ingredientName: 'egg substitute',
                    caloriesPer100g: 50,
                    proteinPer100g: 10,
                    carbsPer100g: 0,
                    fatPer100g: 0,
                    servings: [{ id: 'srv-2', label: 'serving', grams: 50 }]
                };
            }
            return null;
        });

        // Query with default serving unit to bypass lack of volume conversions in mock
        const result = await mapIngredientWithFallback('1 serving vegetarian egg substitute', {
            minConfidence: 0,
            skipFdc: true,
            debug: true,
        });

        expect(result).not.toBeNull();
        expect(result?.foodName.toLowerCase()).toContain('substitute');
    });

    it('fires the zero-calorie fast-path only when the whole line is a water query', async () => {
        // Positive: plain water and water with qty/unit prefixes (qty/unit are
        // stripped by parsing, so baseName is exactly "water").
        for (const line of ['water', '2 cups water', '16 oz water']) {
            const result = await mapIngredientWithFallback(line, {
                minConfidence: 0,
                skipFdc: true,
            });
            expect(result).not.toBeNull();
            expect(result?.foodId).toBe('water_default');
            expect(result?.kcal).toBe(0);
        }
    });

    it('fires the zero-calorie fast-path for whole-line water beverage variants', async () => {
        for (const line of ['sparkling water', 'ice water', 'still water']) {
            const result = await mapIngredientWithFallback(line, {
                minConfidence: 0,
                skipFdc: true,
            });
            expect(result).not.toBeNull();
            expect(result?.foodId).toBe('water_default');
            expect(result?.kcal).toBe(0);
        }
    });

    it('does NOT fast-path "canned tuna in water"', async () => {
        // "canned tuna in water" billed 0 kcal because the old check matched
        // "water" as a suffix/last word of the line. It must map normally.
        (gatherCandidates as jest.Mock).mockResolvedValue([
            { id: 'tuna-water', source: 'ai_generated', name: 'Tuna in Water, Canned', brandName: null, score: 0.9, rawData: {} }
        ]);
        (getCachedFoodWithRelations as jest.Mock).mockResolvedValue({
            id: 'tuna-water',
            displayName: 'Tuna in Water, Canned',
            ingredientName: 'canned tuna in water',
            caloriesPer100g: 90,
            proteinPer100g: 20,
            carbsPer100g: 0,
            fatPer100g: 1,
            servings: [{ id: 'srv-tuna', label: '1 can', grams: 120 }]
        });

        const result = await mapIngredientWithFallback('100g canned tuna in water', {
            minConfidence: 0,
            skipFdc: true,
        });
        expect(result).not.toBeNull();
        expect(result?.foodId).not.toBe('water_default');
        expect(result?.foodName.toLowerCase()).toContain('tuna');
        expect(result?.kcal).toBeGreaterThan(0);
    });

    it('does NOT fast-path "tuna in spring water"', async () => {
        (gatherCandidates as jest.Mock).mockResolvedValue([
            { id: 'tuna-spring', source: 'ai_generated', name: 'Tuna in Spring Water', brandName: null, score: 0.9, rawData: {} }
        ]);
        (getCachedFoodWithRelations as jest.Mock).mockResolvedValue({
            id: 'tuna-spring',
            displayName: 'Tuna in Spring Water',
            ingredientName: 'tuna in spring water',
            caloriesPer100g: 99,
            proteinPer100g: 23,
            carbsPer100g: 0,
            fatPer100g: 0.8,
            servings: [{ id: 'srv-tuna-sp', label: '1 can', grams: 120 }]
        });

        const result = await mapIngredientWithFallback('100g tuna in spring water', {
            minConfidence: 0,
            skipFdc: true,
        });
        expect(result).not.toBeNull();
        expect(result?.foodId).not.toBe('water_default');
        expect(result?.foodName.toLowerCase()).toContain('tuna');
        expect(result?.kcal).toBeGreaterThan(0);
    });

    it('does NOT fast-path "chicken packed in water"', async () => {
        (gatherCandidates as jest.Mock).mockResolvedValue([
            { id: 'chicken-water', source: 'ai_generated', name: 'Chicken Breast, Canned in Water', brandName: null, score: 0.9, rawData: {} }
        ]);
        (getCachedFoodWithRelations as jest.Mock).mockResolvedValue({
            id: 'chicken-water',
            displayName: 'Chicken Breast, Canned in Water',
            ingredientName: 'chicken packed in water',
            caloriesPer100g: 105,
            proteinPer100g: 22,
            carbsPer100g: 0,
            fatPer100g: 2,
            servings: [{ id: 'srv-chx', label: '1 can', grams: 140 }]
        });

        const result = await mapIngredientWithFallback('100g chicken packed in water', {
            minConfidence: 0,
            skipFdc: true,
        });
        expect(result).not.toBeNull();
        expect(result?.foodId).not.toBe('water_default');
        expect(result?.foodName.toLowerCase()).toContain('chicken');
        expect(result?.kcal).toBeGreaterThan(0);
    });

    it('does NOT treat watermelon as water', async () => {
        (gatherCandidates as jest.Mock).mockResolvedValue([
            { id: 'melon-1', source: 'ai_generated', name: 'Watermelon', brandName: null, score: 0.9, rawData: {} }
        ]);
        (getCachedFoodWithRelations as jest.Mock).mockResolvedValue({
            id: 'melon-1',
            displayName: 'Watermelon',
            ingredientName: 'watermelon',
            caloriesPer100g: 30,
            proteinPer100g: 0.6,
            carbsPer100g: 7.6,
            fatPer100g: 0.2,
            servings: [{ id: 'srv-melon', label: '1 cup', grams: 152 }]
        });

        const result = await mapIngredientWithFallback('100g watermelon', {
            minConfidence: 0,
            skipFdc: true,
        });
        expect(result).not.toBeNull();
        expect(result?.foodId).not.toBe('water_default');
        expect(result?.foodName.toLowerCase()).toContain('watermelon');
        expect(result?.kcal).toBeGreaterThan(0);
    });

    it('enforces low-fat modifiers in candidate selection', async () => {
        (gatherCandidates as jest.Mock).mockResolvedValue([
            { id: 'cream-cheese', source: 'ai_generated', name: 'Cream Cheese', brandName: null, score: 0.9, rawData: {} },
            { id: 'light-cream-cheese', source: 'ai_generated', name: 'Light Cream Cheese', brandName: null, score: 0.8, rawData: {} }
        ]);

        (getCachedFoodWithRelations as jest.Mock).mockImplementation(async (id: string) => {
            if (id === 'cream-cheese') {
                return {
                    id: 'cream-cheese',
                    displayName: 'Cream Cheese',
                    ingredientName: 'cream cheese',
                    caloriesPer100g: 350,
                    proteinPer100g: 6,
                    carbsPer100g: 4,
                    fatPer100g: 35,
                    servings: [{ id: 'srv-1', label: 'serving', grams: 28 }]
                };
            }
            if (id === 'light-cream-cheese') {
                return {
                    id: 'light-cream-cheese',
                    displayName: 'Light Cream Cheese',
                    ingredientName: 'light cream cheese',
                    caloriesPer100g: 214,
                    proteinPer100g: 8,
                    carbsPer100g: 6,
                    fatPer100g: 17.85,
                    servings: [{ id: 'srv-2', label: '1 tbsp', grams: 14 }]
                };
            }
            return null;
        });

        // Query with matching unit to bypass lack of volume conversions in mock
        const result = await mapIngredientWithFallback('1 tbsp light cream cheese', {
            minConfidence: 0,
            skipFdc: true,
            debug: true,
        });

        expect(result).not.toBeNull();
        expect(result?.foodName.toLowerCase()).toContain('light');
    });
});
