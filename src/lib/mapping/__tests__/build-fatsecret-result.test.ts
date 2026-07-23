/**
 * buildFatSecretResult — hydration + gram/macros resolution for fatsecret
 * retrieval-lane candidates (fs_ prefix), Phase 1.
 *
 * Covers the resolution cascade:
 *   (a) explicit weight unit → direct grams        ('fs_weight_direct')
 *   (b) volume unit → serving volumeMl density     ('fs_label_volume')
 *   (c) count noun → noun-matched serving          ('fs_label_count')
 *       else default serving                       ('fs_default_serving')
 *   (d) per-100g fallback                          ('fs_per100g_fallback')
 * plus: per-serving macros preferred over per-100g rescale, the candidate
 * fallback when the DB row is missing, the bare-query-guard CAP parity on the
 * default-serving path, and the null-when-no-data contract.
 *
 * Mocks only the db (save-gates pattern).
 */

const mockFatSecretFoodFindUnique = jest.fn();

jest.mock('../../db', () => ({
    prisma: {
        fatSecretFood: {
            findUnique: (...args: unknown[]) => mockFatSecretFoodFindUnique(...args),
        },
    },
}));

import { buildFatSecretResult } from '../build-fatsecret-result';
import type { ParsedIngredient } from '../../parse/ingredient-line';

function makeCandidate(overrides: Record<string, unknown> = {}) {
    return {
        id: 'fs_12345',
        source: 'fatsecret' as const,
        name: 'Quest Protein Bar',
        brandName: 'Quest',
        score: 1,
        foodType: 'Brand',
        rawData: {},
        ...overrides,
    } as any;
}

function barServing(overrides: Record<string, unknown> = {}) {
    return {
        servingId: 'sv1',
        description: '1 bar',
        measurementDescription: 'bar',
        grams: 60,
        volumeMl: null,
        numberOfUnits: 1,
        nutrients: { calories: 240, protein: 20, carbohydrate: 24, fat: 8 },
        ...overrides,
    };
}

function makeRow(overrides: Record<string, unknown> = {}) {
    return {
        fsId: '12345',
        name: 'Quest Protein Bar, Chocolate Chip',
        brandName: 'Quest Nutrition',
        foodType: 'Brand',
        nutrientsPer100g: { kcal: 400, protein: 33, carbs: 40, fat: 13 },
        defaultServingId: 'sv1',
        fetchedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        servings: [barServing()],
        ...overrides,
    };
}

function parsedLine(over: Partial<ParsedIngredient>): ParsedIngredient {
    return { qty: 1, multiplier: 1, unit: null, name: '' , ...over } as ParsedIngredient;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockFatSecretFoodFindUnique.mockResolvedValue(null);
});

describe('buildFatSecretResult — gram resolution cascade', () => {
    it('(a) explicit weight unit bills direct grams from per-100g', async () => {
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow());

        const result = await buildFatSecretResult(
            makeCandidate(), parsedLine({ qty: 2, unit: 'oz', name: 'protein bar' }),
            0.9, '2 oz protein bar'
        );

        expect(result).not.toBeNull();
        expect(result!.servingTier).toBe('fs_weight_direct');
        expect(result!.grams).toBeCloseTo(56.7, 3);
        // Weight path has no picked serving — macros come from per-100g.
        expect(result!.kcal).toBeCloseTo(400 * 0.567, 3);
        expect(result!.foodId).toBe('fs_12345');
        expect(result!.source).toBe('fatsecret');
        expect(result!.foodName).toBe('Quest Protein Bar, Chocolate Chip');
    });

    it('(b) volume unit scales through a serving with volumeMl (own density)', async () => {
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            name: 'Plain Greek Yogurt',
            defaultServingId: 'svCup',
            servings: [{
                servingId: 'svCup',
                description: '1 cup',
                measurementDescription: 'cup',
                grams: 245,
                volumeMl: 240,
                numberOfUnits: 1,
                nutrients: { calories: 150, protein: 25, carbohydrate: 9, fat: 1 },
            }],
        }));

        const result = await buildFatSecretResult(
            makeCandidate({ id: 'fs_777', name: 'Plain Greek Yogurt' }),
            parsedLine({ qty: 0.5, unit: 'cup', name: 'greek yogurt' }),
            0.9, '1/2 cup greek yogurt'
        );

        expect(result!.servingTier).toBe('fs_label_volume');
        expect(result!.grams).toBeCloseTo(120 * (245 / 240), 3); // 122.5
        // Per-serving macros scaled by grams ratio, not per-100g rescale.
        expect(result!.kcal).toBeCloseTo(150 * (122.5 / 245), 3); // 75
    });

    it('(c) count noun "1 protein bar" picks the "1 bar" serving grams', async () => {
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow());

        const result = await buildFatSecretResult(
            makeCandidate(), parsedLine({ qty: 1, name: 'protein bar' }),
            0.9, '1 protein bar'
        );

        expect(result!.servingTier).toBe('fs_label_count');
        expect(result!.grams).toBe(60);
        expect(result!.servingId).toBe('sv1');
        expect(result!.kcal).toBe(240);
    });

    it('(c) explicit count unit divides multi-unit servings by numberOfUnits', async () => {
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            name: 'Whey Protein Powder',
            defaultServingId: 'svScoop',
            servings: [{
                servingId: 'svScoop',
                description: '2 scoops',
                measurementDescription: 'scoops',
                grams: 46,
                volumeMl: null,
                numberOfUnits: 2,
                nutrients: { calories: 180, protein: 36, carbohydrate: 4, fat: 2 },
            }],
        }));

        const result = await buildFatSecretResult(
            makeCandidate({ id: 'fs_888', name: 'Whey Protein Powder' }),
            parsedLine({ qty: 1, unit: 'scoop', name: 'whey protein' }),
            0.9, '1 scoop whey protein'
        );

        expect(result!.servingTier).toBe('fs_label_count');
        expect(result!.grams).toBe(23);
        expect(result!.kcal).toBeCloseTo(90, 3);
    });

    it('per-serving macros are preferred over the per-100g rescale', async () => {
        // Deliberately inconsistent per-100g so the preference is observable:
        // 60g at 1000 kcal/100g would be 600 kcal; the serving panel says 240.
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            nutrientsPer100g: { kcal: 1000, protein: 1, carbs: 1, fat: 1 },
        }));

        const result = await buildFatSecretResult(
            makeCandidate(), parsedLine({ qty: 1, name: 'protein bar' }),
            0.9, '1 protein bar'
        );

        expect(result!.kcal).toBe(240);
        expect(result!.protein).toBe(20);
    });

    it('(d) falls back to per-100g x qty when the food has no servings', async () => {
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            name: 'Mystery Gruel',
            defaultServingId: null,
            servings: [],
        }));

        const result = await buildFatSecretResult(
            makeCandidate({ id: 'fs_999', name: 'Mystery Gruel' }),
            parsedLine({ qty: 2, name: 'mystery gruel' }),
            0.9, '2 mystery gruel'
        );

        expect(result!.servingTier).toBe('fs_per100g_fallback');
        expect(result!.grams).toBe(200);
        expect(result!.kcal).toBeCloseTo(800, 3);
    });

    it('returns null when there is no row and the candidate carries no usable data', async () => {
        mockFatSecretFoodFindUnique.mockResolvedValue(null);

        const result = await buildFatSecretResult(
            makeCandidate({ rawData: {}, servings: undefined, nutrition: undefined }),
            parsedLine({ qty: 1, name: 'protein bar' }),
            0.9, '1 protein bar'
        );

        expect(result).toBeNull();
    });

    it('falls back to the candidate inline servings/nutrition when the DB row is missing', async () => {
        mockFatSecretFoodFindUnique.mockResolvedValue(null);

        const result = await buildFatSecretResult(
            makeCandidate({
                servings: [{ description: '1 bar', grams: 55 }],
                nutrition: { kcal: 400, protein: 30, carbs: 40, fat: 10, per100g: true },
            }),
            parsedLine({ qty: 1, name: 'protein bar' }),
            0.9, '1 protein bar'
        );

        expect(result!.servingTier).toBe('fs_label_count');
        expect(result!.grams).toBe(55);
        // Inline servings carry no per-serving macros — per-100g rescale.
        expect(result!.kcal).toBeCloseTo(400 * 0.55, 3);
        expect(result!.foodName).toBe('Quest Protein Bar');
    });

    it('bare unitless qty-1 uses the default serving (fs_default_serving)', async () => {
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            name: 'Vanilla Yogurt Cup',
            defaultServingId: 'svCup',
            servings: [{
                servingId: 'svCup',
                description: '1 container',
                measurementDescription: 'container',
                grams: 170,
                volumeMl: null,
                numberOfUnits: 1,
                nutrients: { calories: 150, protein: 12, carbohydrate: 18, fat: 3 },
            }],
        }));

        const result = await buildFatSecretResult(
            makeCandidate({ id: 'fs_555', name: 'Vanilla Yogurt Cup' }),
            parsedLine({ qty: 1, name: 'vanilla yogurt' }),
            0.9, 'vanilla yogurt'
        );

        expect(result!.servingTier).toBe('fs_default_serving');
        expect(result!.grams).toBe(170);
        expect(result!.kcal).toBe(150);
    });

    it('bare-query guard CAPs a package-scale default serving (olive oil 250g -> 14g)', async () => {
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            name: 'Extra Virgin Olive Oil',
            defaultServingId: 'svBottle',
            nutrientsPer100g: { kcal: 884, protein: 0, carbs: 0, fat: 100 },
            servings: [{
                servingId: 'svBottle',
                description: '1 bottle',
                measurementDescription: 'bottle',
                grams: 250,
                volumeMl: null,
                numberOfUnits: 1,
                nutrients: { calories: 2210, protein: 0, carbohydrate: 0, fat: 250 },
            }],
        }));

        const result = await buildFatSecretResult(
            makeCandidate({ id: 'fs_333', name: 'Extra Virgin Olive Oil' }),
            parsedLine({ qty: 1, name: 'olive oil' }),
            0.9, 'olive oil'
        );

        expect(result!.servingTier).toBe('bare_category_default');
        expect(result!.grams).toBe(14);
        // Per-serving macros rescaled to the capped grams.
        expect(result!.kcal).toBeCloseTo(2210 * (14 / 250), 3);
    });
});

describe('repro: "15 pretzels" (fs_4349 live data, eval n-serv-20 675g regression)', () => {
    it('matches the per-piece serving via the lexicon-free trailing-token fallback', async () => {
        mockFatSecretFoodFindUnique.mockResolvedValue({
            fsId: '4349',
            name: 'Pretzels',
            brandName: null,
            foodType: 'Generic',
            nutrientsPer100g: { calories: 380, protein: 10.34, carbs: 79.76, fat: 2.63, fiber: 3, sugars: 2.76, sodium: 1.357, saturatedFat: 0.501 },
            defaultServingId: 'sv-serving',
            fetchedAt: new Date(),
            servings: [
                { servingId: 'sv-serving', description: '1 serving (28 g)', measurementDescription: 'serving', grams: 28, volumeMl: null, numberOfUnits: 1, nutrients: { calories: 106, protein: 2.9, carbohydrate: 22.33, fat: 0.74 } },
                { servingId: 'sv-cup', description: '1 cup', measurementDescription: 'cup', grams: 45, volumeMl: null, numberOfUnits: 1, nutrients: { calories: 171, protein: 4.65, carbohydrate: 35.89, fat: 1.18 } },
                { servingId: 'sv-100', description: '100 g', measurementDescription: 'g', grams: 100, volumeMl: null, numberOfUnits: 100, nutrients: { calories: 380, protein: 10.34, carbohydrate: 79.76, fat: 2.63 } },
                { servingId: 'sv-oz', description: '1 oz', measurementDescription: 'oz', grams: 28.35, volumeMl: null, numberOfUnits: 1, nutrients: { calories: 108, protein: 2.93, carbohydrate: 22.61, fat: 0.75 } },
                { servingId: 'sv-piece', description: '1 pretzel (Include nuggets)', measurementDescription: 'pretzel', grams: 3, volumeMl: null, numberOfUnits: 1, nutrients: { calories: 11, protein: 0.31, carbohydrate: 2.39, fat: 0.08 } },
            ],
        });
        const result = await buildFatSecretResult(
            makeCandidate({ id: 'fs_4349', name: 'Pretzels', brandName: null }),
            parsedLine({ qty: 15, unit: null, name: 'pretzels' }),
            0.9,
            '15 pretzels'
        );
        expect(result).not.toBeNull();
        expect(result!.grams).toBe(45); // 15 x 3g per-piece serving, NOT 15 x 45g cup = 675
        expect(result!.servingTier).toBe('fs_label_count');
    });
});
