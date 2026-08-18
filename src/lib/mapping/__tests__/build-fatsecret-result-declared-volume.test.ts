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
    measurementDescription: string | null = null,
) {
    return {
        servingId, description, measurementDescription,
        grams, volumeMl: null, numberOfUnits: 1, nutrients,
    };
}

/** A literal "100 g" panel row — `isPer100gPanelServing()` demotes exactly this. */
function panelRow(servingId: string, nutrients: Record<string, number>) {
    return { ...serving(servingId, '100 g', 100, nutrients, 'g'), numberOfUnits: 100 };
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
        //
        // The fixture drops fs_4501's OTHER cup row ("1 cup cooked" 158 g) on
        // purpose. With the declaration no longer scoped to `defaultServingId`
        // that row would answer the request itself, so the mutation above would
        // land on `unitDeclarations.length === 1` instead and bill 120 g — the
        // test would still pass while no longer testing the yield rule. One cup
        // row, and it is the yield row, is the only fixture on which "570" is
        // what a broken yield rule actually bills.
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            defaultServingId: '15284',
            servings: [
                serving('15284', '1 cup, dry, yields', 570,
                    { calories: 735, protein: 15.16, carbohydrate: 159.03, fat: 1.6 }, 'cup'),
                serving('17592', '1 serving (105 g)', 105,
                    { calories: 135, protein: 2.79, carbohydrate: 29.3, fat: 0.29 }),
            ],
        }));
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

    it('FIRES on a non-default serving that names the unit — a cup row is a cup row', async () => {
        // FLIPPED 2026-08-18. Was `does not fire on a non-default serving that
        // happens to name the unit`, whose stated reason was: "fs_4501 holds TWO
        // cup rows, and picking among them without a declaration is a positional
        // pick."
        //
        // That reason does not survive its own fixture. fs_4501's second cup row
        // is `1 cup, dry, yields`, and `declaredVolumeUnitGrams()` refuses
        // /yield/i BEFORE anything is counted — commit b3821f4 says so itself,
        // four lines above the count it wrote. There was exactly ONE candidate
        // here and nothing to guess between; what the `defaultServingId` gate
        // actually refused was a correct answer.
        //
        // What it refused, measured on the box 2026-08-18: the old gate fires on
        // 6,194 (record, unit) pairs, this one on 9,276 — 3,082 newly admitted,
        // 0 lost. There is no pair the old gate answers and this one does not.
        //
        // MUTATION: restore the `declaredDefault &&` scoping -> 120 g /
        // fs_volume_density, which is what production billed.
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({ defaultServingId: '17592' }));
        const r = await buildFatSecretResult(
            makeCandidate(), CUP_RICE(), 0.98, '1 cup white rice'
        );
        expect(r!.servingTier).toBe('fs_label_volume_declared');
        expect(r!.grams).toBe(158);
        // The macros come from the row that answered, not from the default.
        expect(r!.servingId).toBe('16834');
        expect(r!.kcal).toBeCloseTo(204, 5);
    });

    it('still refuses TWO non-yield rows naming the unit when the default names none', async () => {
        // The guard the flip above leaves doing ALL the work — and on the newly
        // admitted set it does about 11x more of it: the single-declaration rate
        // is 86.4% for cup there (90.4% across all units) against 96.7-98.8% on
        // the default set (box, 2026-08-18). The old gate could not see this
        // case at all: with the default naming no volume unit it refused for the
        // wrong reason, so nothing pinned the ambiguity rule on a NON-default
        // pair until now.
        //
        // fs_39558 "Brown Sugar" again, with the default moved to its "1 oz" row
        // so `declaredDefault` is no longer what refuses.
        // MUTATION: drop `unitDeclarations.length === 1` -> bills 145 or 220 by
        // whichever row Postgres returned first, the positional pick this module
        // already had to fix once at the hydrate step.
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            fsId: '39558', name: 'Brown Sugar',
            nutrientsPer100g: { calories: 380, protein: 0.1, carbs: 98.1, fat: 0 },
            defaultServingId: '45797',
            servings: [
                serving('45797', '1 oz', 28.35, null, 'oz'),
                serving('40099', '1 cup unpacked', 145, null, 'cup'),
                serving('40098', '1 cup packed', 220, null, 'cup'),
            ],
        }));
        const r = await buildFatSecretResult(
            makeCandidate({ id: 'fs_39558', name: 'Brown Sugar' }),
            parsedLine({ qty: 1, unit: 'cup', name: 'brown sugar' }), 0.9, '1 cup brown sugar'
        );
        expect(r!.servingTier).toBe('fs_volume_density');
        expect(r!.grams).not.toBe(145);
        expect(r!.grams).not.toBe(220);
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

describe('LIVE RECORDS — the row that answers need not be defaultServingId', () => {
    // Four records read verbatim off the box 2026-08-18 (read-only SELECT over
    // FatSecretFood + FatSecretServing, ordered by servingId ascending as the
    // hydrate include's orderBy returns them; only the fields this module reads
    // are kept). Every one of them:
    //   - holds exactly ONE non-yield row naming the requested unit, so the
    //     ambiguity guard passes;
    //   - carries volumeMl NULL on every row, so `volMatch` cannot pre-empt;
    //   - is NOT that row's `defaultServingId`, so the old gate refused it and
    //     the 240 ml x category-density class constant billed instead.
    //
    // The defaults are the two shapes the gate never accounted for: a literal
    // "100 g" panel row that `isPer100gPanelServing()` has already demoted out
    // of `usableServings` (cilantro, parsley, shakshuka — so `declaredDefault`
    // resolves to undefined and the record has NO default to speak of), and a
    // piece row that names a different measure entirely (leek's "1 leek").
    //
    // MUTATION for every case below: restore the `declaredDefault &&` scoping ->
    // each one falls back to fs_volume_density and the class constant.

    /** fs_36457 "Parsley" — one cup row AND one tbsp row, neither the default. */
    const PARSLEY = () => makeRow({
        fsId: '36457', name: 'Parsley',
        nutrientsPer100g: { calories: 36, protein: 2.97, carbs: 6.33, fat: 0.79 },
        defaultServingId: '59188',
        servings: [
            serving('34330', '1 cup', 60,
                { calories: 22, protein: 1.78, carbohydrate: 3.8, fat: 0.47 }, 'cup'),
            serving('34331', '1 tbsp', 3.8,
                { calories: 1, protein: 0.11, carbohydrate: 0.24, fat: 0.03 }, 'tbsp'),
            serving('34332', '10 sprigs', 10, null, 'sprigs'),
            serving('44202', '1 oz', 28.35, null, 'oz'),
            panelRow('59188', { calories: 36, protein: 2.97, carbohydrate: 6.33, fat: 0.79 }),
        ],
    });

    it('fs_6242 Cilantro — 1 cup = 16 g; the default is a demoted "100 g" panel', async () => {
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            fsId: '6242', name: 'Cilantro',
            nutrientsPer100g: { calories: 23, protein: 2.13, carbs: 3.67, fat: 0.52 },
            defaultServingId: '54922',
            servings: [
                serving('183724', '1 oz', 28.35, null, 'oz'),
                serving('23482', '1 sprig', 1.1, null, 'sprig'),
                serving('24288', '1 cup', 16,
                    { calories: 4, protein: 0.34, carbohydrate: 0.59, fat: 0.08 }, 'cup'),
                serving('24609', '1 bunch', 102, null, 'bunch'),
                panelRow('54922', { calories: 23, protein: 2.86, carbohydrate: 3.67, fat: 0.52 }),
            ],
        }));
        const r = await buildFatSecretResult(
            makeCandidate({ id: 'fs_6242', name: 'Cilantro' }),
            parsedLine({ qty: 1, unit: 'cup', name: 'cilantro' }), 0.95, '1 cup cilantro'
        );
        expect(r!.servingTier).toBe('fs_label_volume_declared');
        expect(r!.grams).toBe(16);
        // The row that answered is also the row the macros are read off, so the
        // kcal stop being a per-100g rescale of a guessed weight.
        expect(r!.servingId).toBe('24288');
        expect(r!.kcal).toBeCloseTo(4, 5);
    });

    it('fs_6249 Leek — 1 cup = 89 g; the default is the "1 leek" piece row', async () => {
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            fsId: '6249', name: 'Leek',
            nutrientsPer100g: { calories: 61, protein: 1.5, carbs: 14.15, fat: 0.3 },
            defaultServingId: '23995',
            servings: [
                serving('183729', '1 oz', 28.35, null, 'oz'),
                serving('22299', '1 slice', 6, null, 'slice'),
                serving('23946', '1 cup', 89,
                    { calories: 54, protein: 1.34, carbohydrate: 12.59, fat: 0.27 }, 'cup'),
                serving('23995', '1 leek', 89,
                    { calories: 54, protein: 1.34, carbohydrate: 12.59, fat: 0.27 }, 'leek'),
                panelRow('54929', { calories: 61, protein: 1.5, carbohydrate: 14.15, fat: 0.3 }),
            ],
        }));
        const r = await buildFatSecretResult(
            makeCandidate({ id: 'fs_6249', name: 'Leek' }),
            parsedLine({ qty: 1, unit: 'cup', name: 'leek' }), 0.95, '1 cup leek'
        );
        expect(r!.servingTier).toBe('fs_label_volume_declared');
        expect(r!.grams).toBe(89);
        // "1 leek" weighs the same 89 g, so grams alone cannot show WHICH row
        // answered — the servingId can, and it must be the cup row.
        expect(r!.servingId).toBe('23946');
    });

    it('fs_36457 Parsley — 1 cup = 60 g', async () => {
        mockFatSecretFoodFindUnique.mockResolvedValue(PARSLEY());
        const r = await buildFatSecretResult(
            makeCandidate({ id: 'fs_36457', name: 'Parsley' }),
            parsedLine({ qty: 1, unit: 'cup', name: 'parsley' }), 0.95, '1 cup parsley'
        );
        expect(r!.servingTier).toBe('fs_label_volume_declared');
        expect(r!.grams).toBe(60);
        expect(r!.servingId).toBe('34330');
    });

    it('fs_36457 Parsley — and 1 tbsp = 3.8 g off the OTHER non-default row', async () => {
        // The same record answers two different units from two different
        // non-default rows. Neither is ambiguous FOR ITS OWN UNIT, which is the
        // per-unit shape of the guard (`:220` pins the same thing on the default
        // side) — and this is the case a "prefer the default when ambiguous"
        // widening would have got wrong in both directions.
        mockFatSecretFoodFindUnique.mockResolvedValue(PARSLEY());
        const r = await buildFatSecretResult(
            makeCandidate({ id: 'fs_36457', name: 'Parsley' }),
            parsedLine({ qty: 1, unit: 'tbsp', name: 'parsley' }), 0.95, '1 tbsp parsley'
        );
        expect(r!.servingTier).toBe('fs_label_volume_declared');
        expect(r!.grams).toBeCloseTo(3.8, 5);
        expect(r!.servingId).toBe('34331');
    });

    it('fs_17779963 Shakshuka — 1 cup = 300 g', async () => {
        // The sibling row "1 serving (300 g)" names no volume unit, so it is not
        // counted and the cup declaration stays unambiguous.
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            fsId: '17779963', name: 'Shakshuka',
            nutrientsPer100g: { calories: 131, protein: 6.62, carbs: 4.78, fat: 9.77 },
            defaultServingId: '16766063',
            servings: [
                serving('16766061', '1 cup', 300,
                    { calories: 393, protein: 19.86, carbohydrate: 14.35, fat: 29.31 }, 'cup'),
                serving('16766062', '1 serving (300 g)', 300,
                    { calories: 393, protein: 19.86, carbohydrate: 14.35, fat: 29.31 },
                    'serving (300g)'),
                panelRow('16766063', { calories: 131, protein: 6.62, carbohydrate: 4.78, fat: 9.77 }),
                serving('16766075', '1 oz', 28.35, null, 'oz'),
            ],
        }));
        const r = await buildFatSecretResult(
            makeCandidate({ id: 'fs_17779963', name: 'Shakshuka' }),
            parsedLine({ qty: 1, unit: 'cup', name: 'shakshuka' }), 0.95, '1 cup shakshuka'
        );
        expect(r!.servingTier).toBe('fs_label_volume_declared');
        expect(r!.grams).toBe(300);
        expect(r!.servingId).toBe('16766061');
    });

    it('CANDIDATE FALLBACK — the un-persisted path the census could not see', async () => {
        // The second serving source, and the one no census over
        // `FatSecretServing` can measure: `FATSECRET_PERSIST_RUNNERS_UP` defaults
        // to 0 and nothing overrides it, so `searchFatSecretLane()` persists no
        // hit speculatively and `ensureFatSecretParentPersisted()` does not run
        // until SAVE. Every not-yet-seen FatSecret food therefore arrives here
        // with `row` null and bills off `candidate.servings`.
        //
        // On this branch the OLD gate could not fire AT ALL, two ways over: there
        // is no `row`, hence no `defaultServingId`; and `toUnifiedCandidate()`
        // maps servings to {description, grams} only, so `servingId` is null
        // regardless. `volMatch` cannot pre-empt either — no `volumeMl` is
        // mapped. So 100% of the declared-volume bills on this path are new.
        // MUTATION: restore `declaredDefault &&` -> 120 g, unconditionally, for
        // every un-persisted FatSecret food in existence.
        mockFatSecretFoodFindUnique.mockResolvedValue(null);
        const r = await buildFatSecretResult(
            makeCandidate({
                id: 'fs_6242', name: 'Cilantro',
                servings: [{ description: '1 cup', grams: 16 }, { description: '1 sprig', grams: 1.1 }],
                nutrition: { kcal: 23, protein: 2.13, carbs: 3.67, fat: 0.52, per100g: true },
            }),
            parsedLine({ qty: 1, unit: 'cup', name: 'cilantro' }), 0.95, '1 cup cilantro'
        );
        expect(r!.servingTier).toBe('fs_label_volume_declared');
        expect(r!.grams).toBe(16);
        // The inline mapping carries neither `servingId` nor `nutrients`, so the
        // row that answered has no panel and the macros fall to the SAME
        // per-100g rescale they used before. Only GRAMS move on this path — the
        // widening degrades safely when the source is thin.
        expect(r!.servingId).toBeNull();
        expect(r!.kcal).toBeCloseTo(23 * 0.16, 5);
    });

    it('NEGATIVE CONTROL fs_36577 Spinach — 1 cup = 30 g, green on BOTH trees', async () => {
        // Spinach is already right in production, but only by accident of
        // FatSecret having flagged its cup row as the default — so the OLD gate
        // fires on it too. It is here to prove the rewrite MOVES NOTHING that
        // already worked: if this test is the one that goes red, the change is
        // wrong. Golden n-prose-08 ("approximately 2 cups of spinach", band
        // [40, 100] g) is built on this record's 30 g.
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            fsId: '36577', name: 'Spinach',
            nutrientsPer100g: { calories: 23, protein: 2.86, carbs: 3.63, fat: 0.39 },
            defaultServingId: '34521',
            servings: [
                serving('34521', '1 cup', 30,
                    { calories: 7, protein: 0.86, carbohydrate: 1.09, fat: 0.12 }, 'cup'),
                serving('34523', '1 leaf', 10, null, 'leaf'),
                serving('44322', '1 oz', 28.35, null, 'oz'),
                panelRow('59308', { calories: 23, protein: 2.86, carbohydrate: 3.63, fat: 0.39 }),
            ],
        }));
        const r = await buildFatSecretResult(
            makeCandidate({ id: 'fs_36577', name: 'Spinach' }),
            parsedLine({ qty: 1, unit: 'cup', name: 'spinach' }), 0.95, '1 cup spinach'
        );
        expect(r!.servingTier).toBe('fs_label_volume_declared');
        expect(r!.grams).toBe(30);
        expect(r!.servingId).toBe('34521');
    });
});
