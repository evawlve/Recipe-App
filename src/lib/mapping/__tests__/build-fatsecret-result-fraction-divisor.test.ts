/**
 * buildFatSecretResult — a label that states its own fraction outranks
 * `numberOfUnits` on the lexicon-free piece fallback.
 *
 * WHY THIS FILE EXISTS AND WHAT IT IS NOT. Until the label reader learned
 * fractions (2026-08-18), `extractLabelServingUnit("1/2 breast with sauce and
 * cheese")` returned null, so this branch never matched that row and never
 * billed it. Teaching the reader fractions handed the branch 2,389 newly
 * readable FatSecretServing rows while its DIVISOR — `numberOfUnits` — stayed
 * fraction-blind, so `fs` "1/2 breast with sauce and cheese" (grams 159,
 * numberOfUnits 1) would bill ONE breast at 159 g against a truth of 318 g.
 * That is not a regression, because master matched nothing there; it is a new
 * wrong answer that arrived with the new reading, so it is fixed with it.
 *
 * THE MEASUREMENT THAT CHOOSES THE LABEL OVER numberOfUnits (box, 2026-08-18,
 * all 55,004 FatSecretServing rows): 2,394 rows lead with a fraction.
 * `numberOfUnits` disagrees with the label on 2,236 of them — it is 1 on a row
 * whose description says "1/2 cup". On the 158 rows where FatSecret DOES encode
 * the fraction, `labelFractionQuantity()` reproduces `numberOfUnits` EXACTLY,
 * all 158. Where the source is populated the two agree; where they differ, the
 * source is simply unset. 1,835 rows change divisor under this rule, 1,735 of
 * them downward, i.e. billing MORE per unit — the under-bill being corrected.
 *
 * Scoped by construction, not by test: `labelFractionQuantity` gates on the
 * same `leadingLabelFraction()` that lets `extractLabelServingUnit` read the
 * word, so it can only act on rows the fraction reading created.
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
import { labelFractionQuantity } from '../count-label';
import type { ParsedIngredient } from '../../parse/ingredient-line';

function serving(servingId: string, description: string, grams: number, numberOfUnits: number | null) {
    return {
        servingId, description, measurementDescription: 'serving', grams,
        volumeMl: null, numberOfUnits,
        nutrients: { calories: 180, protein: 20, carbohydrate: 4, fat: 9 },
    };
}

/** fs_4884567's shape: a fraction-led piece row whose numberOfUnits is 1. */
function makeRow(over: Record<string, unknown> = {}) {
    return {
        fsId: '4884567', name: 'Stuffed Chicken Breast', brandName: null, foodType: 'Generic',
        nutrientsPer100g: { kcal: 113, protein: 14, carbs: 3, fat: 6 },
        defaultServingId: 'svPanel',
        fetchedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
        servings: [
            serving('svHalf', '1/2 breast with sauce and cheese', 159, 1),
            { ...serving('svPanel', '100 g', 100, 100) },
        ],
        ...over,
    };
}

function parsedLine(over: Partial<ParsedIngredient>): ParsedIngredient {
    return { qty: 1, multiplier: 1, unit: null, name: '', ...over } as ParsedIngredient;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockFatSecretFoodFindUnique.mockResolvedValue(makeRow());
});

describe('the label states the fraction; numberOfUnits does not', () => {
    it('"2 stuffed chicken breasts" bills 2 x 318 g, not 2 x 159 g', async () => {
        // MUTATION: drop `labelFractionQuantity` from the divisor chain and the
        // divisor falls back to numberOfUnits = 1 -> 318 g, a 2x under-bill on
        // a row that master could not reach at all.
        const r = await buildFatSecretResult(
            { id: 'fs_4884567', source: 'fatsecret', name: 'Stuffed Chicken Breast',
              brandName: null, score: 1, foodType: 'Generic', rawData: {} } as never,
            parsedLine({ qty: 2, name: 'stuffed chicken breasts' }), 0.9,
            '2 stuffed chicken breasts',
        );
        expect(r!.grams).toBeCloseTo(636, 6);   // 2 x (159 / 0.5)
    });

    it('when FatSecret DOES encode the fraction, the answer is identical', async () => {
        // The 158-row agreement class, as a pin: same row, numberOfUnits 0.5.
        // The label-derived divisor must reproduce it, or the claim that this
        // rule agrees with the source wherever the source is set is false.
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            servings: [
                serving('svHalf', '1/2 breast with sauce and cheese', 159, 0.5),
                { ...serving('svPanel', '100 g', 100, 100) },
            ],
        }));
        const r = await buildFatSecretResult(
            { id: 'fs_4884567', source: 'fatsecret', name: 'Stuffed Chicken Breast',
              brandName: null, score: 1, foodType: 'Generic', rawData: {} } as never,
            parsedLine({ qty: 2, name: 'stuffed chicken breasts' }), 0.9,
            '2 stuffed chicken breasts',
        );
        expect(r!.grams).toBeCloseTo(636, 6);
    });

    it('CONTROL: a plain-integer label keeps numberOfUnits untouched', () => {
        // The scope of the rule, at its own level: everything that does not
        // state a fraction returns null here, so no row outside the population
        // the fraction reading created can move.
        expect(labelFractionQuantity('13 chips')).toBeNull();
        expect(labelFractionQuantity('2 scoops (46 g)')).toBeNull();
        expect(labelFractionQuantity('1 serving (123 g)')).toBeNull();
        expect(labelFractionQuantity('1 thin slice')).toBeNull();
        expect(labelFractionQuantity(null)).toBeNull();
        expect(labelFractionQuantity('1/2 breast with sauce and cheese')).toBe(0.5);
        expect(labelFractionQuantity('1 1/4 cup')).toBe(1.25);
        // The guards from the same owner still hold here.
        expect(labelFractionQuantity('320 1/2 package (320 g)')).toBeNull();
        expect(labelFractionQuantity('1 /3 cup (151 g)')).toBeNull();
    });
});
