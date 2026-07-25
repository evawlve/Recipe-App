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

    it('bills a macro-only "1 serving" record with no grams / no per-100g (Impossible Whopper repro)', async () => {
        // FatSecret generic restaurant record: the ONLY serving is "1 serving"
        // with full per-serving macros but grams null and nutrientsPer100g {}.
        // Pre-fix this returned null (fs.build_result.no_nutrition) and the
        // exact-match FS winner was discarded for a fabricated AI estimate.
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            fsId: '29778811',
            name: 'Impossible Whopper',
            brandName: 'Burger King',
            nutrientsPer100g: {}, // derivePer100gFromServings returned null → {}
            defaultServingId: '27148372',
            servings: [{
                servingId: '27148372',
                description: '1 serving',
                measurementDescription: 'serving',
                grams: null,
                volumeMl: null,
                numberOfUnits: 1,
                nutrients: { calories: 630, protein: 28, carbohydrate: 62, fat: 32 },
            }],
        }));

        const result = await buildFatSecretResult(
            makeCandidate({ id: 'fs_29778811', name: 'Impossible Whopper', brandName: 'Burger King' }),
            parsedLine({ qty: 1, name: 'impossible whopper' }),
            0.98, 'burger king impossible whopper'
        );

        expect(result).not.toBeNull();
        expect(result!.servingTier).toBe('fs_serving_macros_only');
        // Macros are billed DIRECTLY from the serving panel — authoritative.
        expect(result!.kcal).toBe(630);
        expect(result!.protein).toBe(28);
        expect(result!.carbs).toBe(62);
        expect(result!.fat).toBe(32);
        // Grams is a secondary energy-density estimate: 630 / 2.0 = 315
        // (macro mass 122g floor does not bind), density stays a plausible 2.0.
        expect(result!.grams).toBeCloseTo(315, 3);
        expect(result!.servingDescription).toBe('1 serving');
    });

    it('macro-only path scales macros by qty (2 servings = 2x panel)', async () => {
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            fsId: '103243799',
            name: 'McFlurry with OREO Cookies - Regular',
            brandName: "McDonald's",
            nutrientsPer100g: {},
            defaultServingId: '82091818',
            servings: [{
                servingId: '82091818',
                description: '1 serving',
                measurementDescription: 'serving',
                grams: null,
                volumeMl: null,
                numberOfUnits: 1,
                nutrients: { calories: 410, protein: 10, carbohydrate: 64, fat: 13 },
            }],
        }));

        const result = await buildFatSecretResult(
            makeCandidate({ id: 'fs_103243799', name: 'McFlurry with OREO Cookies - Regular', brandName: "McDonald's" }),
            parsedLine({ qty: 2, name: 'mcflurry oreo' }),
            0.9, '2 mcdonalds mcflurry oreo'
        );

        expect(result!.servingTier).toBe('fs_serving_macros_only');
        expect(result!.kcal).toBe(820);
        expect(result!.carbs).toBe(128);
        expect(result!.servingDescription).toBe('2 x 1 serving');
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

// Funnel fix 5. A literal "100 g" serving is a per-100g PANEL, not a portion.
// FatSecret ships chain-restaurant records with exactly two servings: the
// synthetic `100 g` row and the real `1 serving` row that carries the item's
// macros but no gram weight. Because only the former had grams it was the only
// "usable" one, so `grams` was never null, the macro-only branch never ran, and
// the item billed 100g whatever it was.
describe('repro: "starbucks flat white" (fs_8729727 live data, flat-100g class)', () => {
    const flatWhiteRow = {
        fsId: '8729727',
        name: 'Flat White (Tall)',
        brandName: 'Starbucks',
        foodType: 'Brand',
        nutrientsPer100g: { kcal: 66, protein: 3.53, carbs: 5.29, fat: 2.65 },
        defaultServingId: 'sv-serving',
        fetchedAt: new Date(),
        servings: [
            {
                servingId: 'sv-100', description: '100 g', measurementDescription: 'g',
                grams: 100, volumeMl: null, numberOfUnits: 100,
                nutrients: { calories: 66, protein: 3.53, carbohydrate: 5.29, fat: 2.65 },
            },
            {
                servingId: 'sv-serving', description: '1 serving', measurementDescription: 'serving',
                grams: null, volumeMl: null, numberOfUnits: 1,
                nutrients: { calories: 170, protein: 9, carbohydrate: 13, fat: 9 },
            },
        ],
    };

    it('bills the real serving instead of 100 g of a latte', async () => {
        mockFatSecretFoodFindUnique.mockResolvedValue(flatWhiteRow);
        const result = await buildFatSecretResult(
            makeCandidate({ id: 'fs_8729727', name: 'Flat White (Tall)', brandName: 'Starbucks' }),
            parsedLine({ qty: 1, unit: null, name: 'starbucks flat white' }),
            0.9,
            'starbucks flat white'
        );
        expect(result).not.toBeNull();
        expect(result!.servingTier).toBe('fs_serving_macros_only');
        expect(result!.grams).not.toBe(100);
        // The serving's own macros are authoritative, not a per-100g rescale.
        expect(result!.kcal).toBeCloseTo(170, 0);
        expect(result!.protein).toBeCloseTo(9, 0);
    });

    it('scales by quantity off the real serving', async () => {
        mockFatSecretFoodFindUnique.mockResolvedValue(flatWhiteRow);
        const result = await buildFatSecretResult(
            makeCandidate({ id: 'fs_8729727', name: 'Flat White (Tall)', brandName: 'Starbucks' }),
            parsedLine({ qty: 2, unit: null, name: 'starbucks flat white' }),
            0.9,
            '2 starbucks flat whites'
        );
        expect(result!.kcal).toBeCloseTo(340, 0);
    });

    it('still serves an explicit 100g request from the panel row', async () => {
        mockFatSecretFoodFindUnique.mockResolvedValue(flatWhiteRow);
        const result = await buildFatSecretResult(
            makeCandidate({ id: 'fs_8729727', name: 'Flat White (Tall)', brandName: 'Starbucks' }),
            parsedLine({ qty: 100, unit: 'g', name: 'starbucks flat white' }),
            0.9,
            '100g starbucks flat white'
        );
        expect(result!.grams).toBe(100);
        expect(result!.kcal).toBeCloseTo(66, 0);
    });

    it('does not strip a genuine 100g PRODUCT serving (a 100 g bar)', async () => {
        // numberOfUnits 1 and a descriptive name — this is a real portion that
        // happens to weigh 100 g, not a per-100g panel row.
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            defaultServingId: 'sv-bar',
            servings: [barServing({
                servingId: 'sv-bar', description: '1 bar (100 g)',
                measurementDescription: 'bar', grams: 100, numberOfUnits: 1,
                nutrients: { calories: 400, protein: 33, carbohydrate: 40, fat: 13 },
            })],
        }));
        const result = await buildFatSecretResult(
            makeCandidate({ name: 'Protein Bar' }),
            parsedLine({ qty: 1, unit: null, name: 'protein bar' }),
            0.9,
            'protein bar'
        );
        expect(result!.grams).toBe(100);
        // Resolved as a counted "bar", i.e. through the serving list — proving
        // the row survived the panel filter rather than being dropped to the
        // per-100g fallback.
        expect(result!.servingTier).toBe('fs_label_count');
    });
});

// Beverage weight recovery. Fix 5 let the real serving through, but grams then
// came from a 2.0 kcal/g PREPARED-SOLID density — which reads a 5 kcal brewed
// coffee as 2.5 grams. The record's own per-100g panel is a far better source:
// FatSecret derives it FROM the serving, so inverting it returns the true
// weight. All fixtures below are verbatim box rows.
describe('per-100g panel inversion recovers the true serving weight', () => {
    // fs 103646771, Starbucks Matcha Latte (Tall) — a tall cup is 12 fl oz/355ml.
    const matchaLatteTall = makeRow({
        fsId: '103646771',
        name: 'Matcha Latte (Tall)',
        brandName: 'Starbucks',
        nutrientsPer100g: { calories: 50, protein: 2.35, carbs: 6.47, fat: 1.47 },
        defaultServingId: 'sv-serving',
        servings: [
            {
                servingId: 'sv-100', description: '100 g', measurementDescription: 'g',
                grams: 100, volumeMl: null, numberOfUnits: 100,
                nutrients: { calories: 50, protein: 2.35, carbohydrate: 6.47, fat: 1.47 },
            },
            {
                servingId: 'sv-serving', description: '1 serving', measurementDescription: 'serving',
                grams: null, volumeMl: null, numberOfUnits: 1,
                nutrients: { calories: 170, protein: 8, carbohydrate: 22, fat: 5 },
            },
        ],
    });

    it('bills a tall matcha latte at drink weight, not solid-food density', async () => {
        mockFatSecretFoodFindUnique.mockResolvedValue(matchaLatteTall);
        const result = await buildFatSecretResult(
            makeCandidate({ id: 'fs_103646771', name: 'Matcha Latte (Tall)', brandName: 'Starbucks' }),
            parsedLine({ qty: 1, unit: null, name: 'starbucks matcha latte' }),
            0.9,
            'starbucks matcha latte'
        );
        expect(result!.servingTier).toBe('fs_serving_macros_only');
        // Every nutrient independently implies ~340g; the energy-density
        // estimate this replaces would have said 170/2.0 = 85g.
        expect(result!.grams).toBeGreaterThan(320);
        expect(result!.grams).toBeLessThan(360);
        expect(result!.kcal).toBeCloseTo(170, 0);
    });

    // fs 103646474, Starbucks Decaf Pike Place Roast. The pathological case: a
    // 1 kcal/100g panel quantizes calories to +-50%, so calories alone says
    // 500g. Protein (1 / 0.22) says 455g and the median splits them — brewed
    // coffee really is ~473ml.
    it('survives a 1 kcal/100g panel by taking the median across nutrients', async () => {
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            fsId: '103646474',
            name: 'Decaf Roast - Pike Place Roast',
            brandName: 'Starbucks',
            nutrientsPer100g: { calories: 1, protein: 0.22, carbs: 0, fat: 0 },
            defaultServingId: 'sv-serving',
            servings: [
                {
                    servingId: 'sv-100', description: '100 g', measurementDescription: 'g',
                    grams: 100, volumeMl: null, numberOfUnits: 100,
                    nutrients: { calories: 1, protein: 0.22, carbohydrate: 0, fat: 0 },
                },
                {
                    servingId: 'sv-serving', description: '1 serving', measurementDescription: 'serving',
                    grams: null, volumeMl: null, numberOfUnits: 1,
                    nutrients: { calories: 5, protein: 1, carbohydrate: 0, fat: 0 },
                },
            ],
        }));
        const result = await buildFatSecretResult(
            makeCandidate({ id: 'fs_103646474', name: 'Pike Place Roast', brandName: 'Starbucks' }),
            parsedLine({ qty: 1, unit: null, name: 'starbucks pike place roast' }),
            0.9,
            'starbucks pike place roast'
        );
        // A cup of coffee, not 2.5 grams of one.
        expect(result!.grams).toBeGreaterThan(400);
        expect(result!.grams).toBeLessThan(560);
        expect(result!.kcal).toBeCloseTo(5, 0);
    });

    // A zero-nutrient serving carries no weight signal at all, so a 0-value
    // panel nutrient must not vote a 0g estimate into the median.
    it('ignores nutrients that are zero on either side', async () => {
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            nutrientsPer100g: { calories: 40, protein: 2, carbs: 5, fat: 1.2 },
            defaultServingId: 'sv-serving',
            servings: [
                {
                    servingId: 'sv-100', description: '100 g', measurementDescription: 'g',
                    grams: 100, volumeMl: null, numberOfUnits: 100,
                    nutrients: { calories: 40, protein: 2, carbohydrate: 5, fat: 1.2 },
                },
                {
                    // fat rounded down to 0 against a positive panel fat.
                    servingId: 'sv-serving', description: '1 serving', measurementDescription: 'serving',
                    grams: null, volumeMl: null, numberOfUnits: 1,
                    nutrients: { calories: 100, protein: 5, carbohydrate: 12.5, fat: 0 },
                },
            ],
        }));
        const result = await buildFatSecretResult(
            makeCandidate({ name: 'Some Drink' }),
            parsedLine({ qty: 1, unit: null, name: 'some drink' }),
            0.9,
            'some drink'
        );
        expect(result!.grams).toBeCloseTo(250, 0);
    });

    // fs-shaped Diet Coke: every panel nutrient is 0, so nothing is derivable.
    // Demoting the panel here would swap a 100g display for a 1g one showing
    // the same correct 0 kcal, so the row is deliberately left in place.
    it('leaves a genuinely zero-calorie drink exactly as it was', async () => {
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            name: 'Diet Coke (Can)',
            brandName: 'Coca-Cola',
            nutrientsPer100g: { calories: 0, protein: 0, carbs: 0, fat: 0 },
            defaultServingId: 'sv-100',
            servings: [
                {
                    servingId: 'sv-100', description: '100 g', measurementDescription: 'g',
                    grams: 100, volumeMl: null, numberOfUnits: 100,
                    nutrients: { calories: 0, protein: 0, carbohydrate: 0, fat: 0 },
                },
                {
                    servingId: 'sv-serving', description: '1 serving', measurementDescription: 'serving',
                    grams: null, volumeMl: null, numberOfUnits: 1,
                    nutrients: { calories: 0, protein: 0, carbohydrate: 0, fat: 0 },
                },
            ],
        }));
        const result = await buildFatSecretResult(
            makeCandidate({ name: 'Diet Coke', brandName: 'Coca-Cola' }),
            parsedLine({ qty: 1, unit: null, name: 'diet coke' }),
            0.9,
            'diet coke'
        );
        expect(result!.grams).toBe(100);
        expect(result!.kcal).toBe(0);
    });

    // Records with NO panel at all — the shape estimateServingGrams was written
    // for — must keep using it.
    it('still falls back to the energy-density estimate when there is no panel', async () => {
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            name: 'Impossible Whopper',
            nutrientsPer100g: {},
            defaultServingId: 'sv-serving',
            servings: [{
                servingId: 'sv-serving', description: '1 serving', measurementDescription: 'serving',
                grams: null, volumeMl: null, numberOfUnits: 1,
                nutrients: { calories: 630, protein: 28, carbohydrate: 62, fat: 32 },
            }],
        }));
        const result = await buildFatSecretResult(
            makeCandidate({ name: 'Impossible Whopper', brandName: 'Burger King' }),
            parsedLine({ qty: 1, unit: null, name: 'impossible whopper' }),
            0.9,
            'impossible whopper'
        );
        expect(result!.servingTier).toBe('fs_serving_macros_only');
        expect(result!.grams).toBeCloseTo(315, 0); // 630 / 2.0
        expect(result!.kcal).toBeCloseTo(630, 0);
    });
});
