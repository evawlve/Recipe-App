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
import { labelFractionQuantity, labelLeadingCount, servingLabelCountsPiece } from '../count-label';
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
});

describe('a label that states a fraction is not a piece count (the third guard)', () => {
    it('"1 great value spicy pickle spear" bills the label\'s 42 g, never the numerator\'s 14 g', async () => {
        // THE ONE ROW THIS PR REGRESSED, and the reason the refusal is in it
        // rather than behind it. `labelLeadingCount()` reads
        // `^\s*(\d+(?:\.\d+)?)`, so on "2/3 spear" it reads the NUMERATOR 2
        // and calls it a piece count. That was inert while the reader returned
        // null on a fraction-led label — `servingLabelCountsPiece` was false
        // because the WORD never matched, not because the count was sound.
        // Teaching the reader fractions removed the accident and left the
        // misread count deciding, putting a non-null `labelPieceCount` first in
        // the `??` chain so `labelFractionQuantity` was never consulted:
        // 28 g on master, 14 g here, against a label that says 2/3 of a spear
        // weighs 28 g and therefore one spear weighs 42.
        //
        // MUTATION: drop `leadingLabelFraction(servingSize)` from
        // servingLabelCountsPiece and this returns 14 — the only one of the
        // three numbers no reading of the label supports.
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            fsId: '22330689', name: 'Spicy Pickle Spears', brandName: 'Great Value',
            servings: [
                serving('svSpear', '2/3 spear', 28, 1),
                { ...serving('svPanel', '100 g', 100, 100) },
            ],
        }));
        const r = await buildFatSecretResult(
            { id: 'fs_22330689', source: 'fatsecret', name: 'Spicy Pickle Spears',
              brandName: 'Great Value', score: 1, foodType: 'Brand', rawData: {} } as never,
            parsedLine({ qty: 1, name: 'great value spicy pickle spear' }), 0.9,
            '1 great value spicy pickle spear',
        );
        expect(r!.grams).toBeCloseTo(42, 6);   // 28 / (2/3)
        expect(r!.servingTier).toBe('fs_label_count');
    });

    it('the refusal is structural, not a spear rule: the predicate declines every fraction-led label', () => {
        // Corpus, box 2026-08-19, all 55,004 FatSecretServing rows: the new
        // reading flipped `servingLabelCountsPiece` TRUE on 403 of them and
        // false on 0. This refusal returns all 403. 400 carry a volume word
        // (cup 396, tbsp 2, oz 1, tsp 1) and are intercepted by the volume
        // branch; the 3 that reach the piece fallback are fs_4655924 and
        // fs_22330689 ("2/3 spear", 28 g) and fs_34355793 ("3/4 serving", 5 g).
        expect(servingLabelCountsPiece('2/3 spear', 28, 'spear')).toBe(false);
        expect(servingLabelCountsPiece('3/4 serving', 5, 'serving')).toBe(false);
        expect(servingLabelCountsPiece('2/3 cup (100 g)', 100, 'cup')).toBe(false);
        expect(servingLabelCountsPiece('1 1/3 cookie (28 g)', 28, 'cookie')).toBe(false);
        // And it cannot cost the fraction divisor a row: every row that rule
        // moves leads with numerator 1, where labelLeadingCount was already
        // null. The two populations are disjoint by construction.
        expect(labelLeadingCount('1/2 naan')).toBeNull();
        expect(labelFractionQuantity('1/2 naan')).toBe(0.5);
        // Plain-integer piece labels are untouched — this is the class the
        // predicate exists for.
        expect(servingLabelCountsPiece('14 chips (28 g)', 28, 'chip')).toBe(true);
        expect(servingLabelCountsPiece('15 pieces (28 g)', 28, 'pretzel')).toBe(true);
    });
});

describe('scope of the divisor rule', () => {
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
