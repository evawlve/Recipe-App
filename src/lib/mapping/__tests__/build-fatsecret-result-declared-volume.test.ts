/**
 * buildFatSecretResult — what answers a VOLUME request when the record states
 * the answer in a serving description but carries no `volumeMl`.
 *
 * The volume branch resolved grams as `totalMl * (grams / volumeMl)` and so
 * filtered `usableServings` on `volumeMl != null` BEFORE any description was
 * consulted. A label reading "1 cup cooked" = 158 g was therefore structurally
 * unreachable: the filter dropped it, `servingMatchesVolumeUnit()` never saw it,
 * and the request fell to the category density fallback.
 *
 * That is not a rare shape. Measured on the box 2026-08-03: 7,768
 * FatSecretServing rows carry grams and a volume-named description with NULL
 * volumeMl, against 2,478 rows the density path can see at all — 3.1x more
 * unreachable than reachable.
 *
 * `fs_4501` "White Rice" is the worked case (golden eval n-tot-02,
 * "1 cup white rice", band [160, 260] kcal). Live cold on build
 * cqJKyfD4ps_ZPNPpBDCoA it billed 120 g / 154.8 kcal — 240 ml x the 0.5 g/ml
 * category density — while the record's own declared default serving says a cup
 * is 158 g / 204 kcal.
 *
 * The fixture is the real fs_4501 row, verbatim from the box, ordered by
 * `servingId` ascending as the include's `orderBy` returns it.
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

function makeCandidate(over: Record<string, unknown> = {}) {
    return {
        id: 'fs_4501', source: 'fatsecret' as const, name: 'White Rice',
        brandName: null, score: 1, foodType: 'Generic', rawData: {}, ...over,
    } as any;
}

function serving(
    servingId: string, description: string, grams: number,
    nutrients: Record<string, number> | null = null,
) {
    return {
        servingId, description, measurementDescription: null,
        grams, volumeMl: null, numberOfUnits: 1, nutrients,
    };
}

function makeRow(over: Record<string, unknown> = {}) {
    return {
        fsId: '4501', name: 'White Rice', brandName: null, foodType: 'Generic',
        nutrientsPer100g: { calories: 129, protein: 2.66, carbs: 27.9, fat: 0.28 },
        // "1 cup cooked" — the row the volumeMl filter was hiding.
        defaultServingId: '16834',
        fetchedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
        servings: [
            serving('15284', '1 cup, dry, yields', 570,
                { calories: 735, protein: 15.16, carbohydrate: 159.03, fat: 1.6 }),
            serving('16834', '1 cup cooked', 158,
                { calories: 204, protein: 4.2, carbohydrate: 44.08, fat: 0.44 }),
            serving('17592', '1 serving (105 g)', 105,
                { calories: 135, protein: 2.79, carbohydrate: 29.3, fat: 0.29 }),
            serving('18252', '1 oz, dry, yields', 87,
                { calories: 112, protein: 2.31, carbohydrate: 24.27, fat: 0.24 }),
            {
                ...serving('53181', '100 g', 100,
                    { calories: 129, protein: 2.66, carbohydrate: 27.9, fat: 0.28 }),
                numberOfUnits: 100,
            },
        ],
        ...over,
    };
}

function parsedLine(over: Partial<ParsedIngredient>): ParsedIngredient {
    return { qty: 1, multiplier: 1, unit: null, name: '', ...over } as ParsedIngredient;
}

const CUP_RICE = () => parsedLine({ qty: 1, unit: 'cup', name: 'white rice' });

beforeEach(() => {
    jest.clearAllMocks();
    mockFatSecretFoodFindUnique.mockResolvedValue(makeRow());
});

describe('n-tot-02 — "1 cup white rice" reads the record\'s own cup label', () => {
    it('bills the declared 158 g cup, not the 120 g category density guess', async () => {
        // MUTATION: delete the `declaredGramsPerUnit` branch -> falls to
        // volumeToGrams() and bills 240ml * 0.5 = 120 g / 154.8 kcal, which is
        // what production did before this change.
        const r = await buildFatSecretResult(
            makeCandidate(), CUP_RICE(), 0.98, '1 cup white rice'
        );
        expect(r).not.toBeNull();
        expect(r!.grams).toBe(158);
        expect(r!.servingTier).toBe('fs_label_volume_declared');
    });

    it('lands inside the golden case band the density fallback missed', async () => {
        const r = await buildFatSecretResult(
            makeCandidate(), CUP_RICE(), 0.98, '1 cup white rice'
        );
        // The serving carries its own panel, so the cup bills the label's 204
        // kcal directly. Band is [160, 260]; the old path billed 154.8.
        expect(r!.kcal).toBeCloseTo(204, 0);
        expect(r!.kcal).toBeGreaterThan(160);
        expect(r!.kcal).toBeLessThan(260);
    });

    it('scales with quantity', async () => {
        const r = await buildFatSecretResult(
            makeCandidate(), parsedLine({ qty: 2, unit: 'cups', name: 'white rice' }), 0.98,
            '2 cups white rice'
        );
        expect(r!.grams).toBe(316);
    });
});

describe('a YIELD is not a portion', () => {
    it('refuses "1 cup, dry, yields" even when the record declares it default', async () => {
        // 570 g is what a cup of DRY rice becomes after cooking, not what a cup
        // weighs — billing it is ~3.6x wrong. Only 5 of the 3,677 cup-named
        // default servings on the box say "yield", but they are the worst-wrong
        // rows in the set.
        // MUTATION: drop the /yield/i test -> this bills 570 g / 735 kcal.
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({ defaultServingId: '15284' }));
        const r = await buildFatSecretResult(
            makeCandidate(), CUP_RICE(), 0.98, '1 cup white rice'
        );
        expect(r!.grams).not.toBe(570);
        expect(r!.servingTier).toBe('fs_volume_density');
    });

    it('does NOT refuse a plain "dry" portion', async () => {
        // 77 of those defaults read "1/4 cup dry" = 43 g and similar. Those are
        // ordinary fractional portions and a correct answer to a volume request;
        // only an explicit yield is a different measurement.
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            defaultServingId: '99001',
            servings: [serving('99001', '1/4 cup dry', 43, null)],
        }));
        const r = await buildFatSecretResult(
            makeCandidate(), CUP_RICE(), 0.98, '1 cup white rice'
        );
        expect(r!.servingTier).toBe('fs_label_volume_declared');
        expect(r!.grams).toBeCloseTo(172, 5);   // 43 / 0.25
    });
});

describe('the label\'s own leading quantity is divided out', () => {
    // 1,474 of the 3,677 cup-named default servings (40.1%) lead with a
    // fraction, and 91 more are mixed numbers. Reading them as one unit
    // under-bills a full cup by 2-4x. `labelLeadingCount()` in count-label.ts
    // cannot be reused for this: it is integer-only and returns null below 2,
    // i.e. null for every shape below.
    it.each([
        ['1 cup cooked', 158, 158],
        ['1/2 cup', 56, 112],
        ['1/4 cup', 45, 180],
        ['2/3 cup', 100, 150],
        // NOT 90g: 90/0.75 = 120, which collides exactly with the density
        // fallback's 240ml * 0.5 — the case passed with the branch deleted.
        ['3/4 cup', 120, 160],
        ['1 1/4 cups', 250, 200],
        ['2 cups', 300, 150],
    ])('%s = %ig -> one cup is %ig', async (description, grams, expected) => {
        // MUTATION: treat the leading quantity as 1 -> every fractional row
        // bills its raw grams and under-bills the cup.
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            defaultServingId: '99002',
            servings: [serving('99002', description as string, grams as number, null)],
        }));
        const r = await buildFatSecretResult(
            makeCandidate(), CUP_RICE(), 0.98, '1 cup white rice'
        );
        expect(r!.grams).toBeCloseTo(expected as number, 5);
    });
});

describe('the declaration must be UNAMBIGUOUS for the requested unit', () => {
    // A record can carry several rows naming one unit, and then the default's
    // choice among them is a claim about product FORM, not about the request.
    // fs_39558 "Brown Sugar" verbatim from the box: three tsp rows, and the
    // declared default is the UNPACKED one. Golden n-dens-03 bands [3.5, 5.5]
    // because a recipe's "1 tsp brown sugar" means packed.
    const BROWN_SUGAR = (over: Record<string, unknown> = {}) => makeRow({
        fsId: '39558', name: 'Brown Sugar',
        nutrientsPer100g: { calories: 380, protein: 0.1, carbs: 98.1, fat: 0 },
        defaultServingId: '40102',
        servings: [
            serving('40102', '1 tsp unpacked', 3),
            serving('40100', '1 tsp brownulated', 3.2),
            serving('40101', '1 tsp packed', 4.6),
            serving('45797', '1 oz', 28.35),
            serving('40099', '1 cup unpacked', 145),
            serving('40098', '1 cup packed', 220),
        ],
        ...over,
    });

    it('refuses when the record holds sibling rows for that unit', async () => {
        // MUTATION: drop the `sameUnitDeclarations === 1` test -> this bills the
        // unpacked 3 g and reopens n-dens-03.
        mockFatSecretFoodFindUnique.mockResolvedValue(BROWN_SUGAR());
        const r = await buildFatSecretResult(
            makeCandidate({ id: 'fs_39558', name: 'Brown Sugar' }),
            parsedLine({ qty: 1, unit: 'tsp', name: 'brown sugar' }), 0.9, '1 tsp brown sugar'
        );
        expect(r!.servingTier).toBe('fs_volume_density');
        expect(r!.grams).not.toBe(3);
    });

    it('refuses per-unit, not globally — cup is ambiguous on this record too', async () => {
        // The default must NAME the unit for the guard to be what refuses; with
        // the tsp default this case falls through for a different reason and
        // would pass even with the guard deleted. Point the default at the cup
        // row so the ambiguity is genuinely what is being tested.
        // MUTATION: drop the guard -> this bills the unpacked 145 g.
        mockFatSecretFoodFindUnique.mockResolvedValue(
            BROWN_SUGAR({ defaultServingId: '40099' })
        );
        const r = await buildFatSecretResult(
            makeCandidate({ id: 'fs_39558', name: 'Brown Sugar' }),
            parsedLine({ qty: 1, unit: 'cup', name: 'brown sugar' }), 0.9, '1 cup brown sugar'
        );
        // "1 cup unpacked" 145 and "1 cup packed" 220 — same ambiguity.
        expect(r!.servingTier).toBe('fs_volume_density');
        expect(r!.grams).not.toBe(145);
    });

    it('a YIELD sibling does not make the declaration ambiguous', async () => {
        // fs_4501 holds TWO cup rows, but "1 cup, dry, yields" is removed by the
        // yield rule before the count is taken — so white rice still resolves.
        // MUTATION: count siblings before applying the yield rule -> n-tot-02
        // reopens.
        const r = await buildFatSecretResult(
            makeCandidate(), CUP_RICE(), 0.98, '1 cup white rice'
        );
        expect(r!.servingTier).toBe('fs_label_volume_declared');
        expect(r!.grams).toBe(158);
    });
});

describe('scope — the rule stays out of paths that already work', () => {
    it('a volumeMl-bearing serving still wins (density is more precise)', async () => {
        // MUTATION: put the declared branch BEFORE the volMatch branch -> this
        // bills 158 g instead of the 240 g the record's own density gives.
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            servings: [
                { ...serving('16834', '1 cup cooked', 158), volumeMl: 240 },
                serving('17592', '1 serving (105 g)', 105),
            ],
        }));
        const r = await buildFatSecretResult(
            makeCandidate(), CUP_RICE(), 0.98, '1 cup white rice'
        );
        expect(r!.servingTier).toBe('fs_label_volume');
        expect(r!.grams).toBeCloseTo(158, 5);
    });

    it('only fires for the unit the description actually names', async () => {
        // The default says "cup"; a tbsp request must not read it.
        const r = await buildFatSecretResult(
            makeCandidate(), parsedLine({ qty: 1, unit: 'tbsp', name: 'white rice' }), 0.98,
            '1 tbsp white rice'
        );
        expect(r!.servingTier).toBe('fs_volume_density');
    });

    it('does not fire on a non-default serving that happens to name the unit', async () => {
        // Deliberate scope limit: fs_4501 holds TWO cup rows, and picking among
        // them without a declaration is a positional pick. With the default
        // pointing elsewhere, the request falls through rather than guess.
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({ defaultServingId: '17592' }));
        const r = await buildFatSecretResult(
            makeCandidate(), CUP_RICE(), 0.98, '1 cup white rice'
        );
        expect(r!.servingTier).toBe('fs_volume_density');
    });

    it('leaves an explicit WEIGHT request alone', async () => {
        const r = await buildFatSecretResult(
            makeCandidate(), parsedLine({ qty: 100, unit: 'g', name: 'white rice' }), 0.98,
            '100g white rice'
        );
        expect(r!.servingTier).toBe('fs_weight_direct');
        expect(r!.grams).toBe(100);
    });
});
