/**
 * buildFatSecretResult — a serving label that enumerates its own pieces.
 *
 * `numberOfUnits` counts SERVINGS, not pieces. fs_63588 ("Tortilla Chips")
 * carries one usable serving reading `13 chips` at 28.35 g with
 * numberOfUnits 1, so dividing by numberOfUnits declared the whole 13-chip
 * serving to be ONE chip and `13 tortilla chips` billed 13 x 28.35 = 368.55 g
 * / 1950 kcal against a [28, 70] band (golden n-serv-35 and n-tot-05, measured
 * cold 2026-08-02).
 *
 * count-label.ts has owned this predicate since the OFF lane adopted it — its
 * module header names "13 tortilla chips" as the motivating query — and lists
 * its callers: buildOffResult, simpleRerank, the cache escape, retrieval.
 * buildFatSecretResult was never one of them, which is why the identical line
 * is right through OFF and wrong here.
 *
 * Each test names the mutation it kills: the point of this file is that the
 * divisor choice is load-bearing, not that the happy path works.
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
        id: 'fs_63588', source: 'fatsecret' as const, name: 'Tortilla Chips',
        brandName: null, score: 1, foodType: 'Generic', rawData: {}, ...over,
    } as any;
}

/** fs_63588's real shape: the only piece serving enumerates 13 chips at 28.35 g. */
function makeRow(over: Record<string, unknown> = {}) {
    return {
        fsId: '63588', name: 'Tortilla Chips', brandName: null, foodType: 'Generic',
        nutrientsPer100g: { kcal: 529, protein: 7, carbs: 65, fat: 26 },
        defaultServingId: 'svChips',
        fetchedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
        servings: [
            {
                servingId: 'svChips', description: '13 chips', measurementDescription: 'serving',
                grams: 28.35, volumeMl: null, numberOfUnits: 1,
                nutrients: { calories: 150, protein: 2, carbohydrate: 18, fat: 7 },
            },
            {
                servingId: 'sv100', description: '100 g', measurementDescription: 'g',
                grams: 100, volumeMl: null, numberOfUnits: 100,
                nutrients: { calories: 529, protein: 7, carbohydrate: 65, fat: 26 },
            },
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

describe('the label’s own count is the divisor when it enumerates the noun', () => {
    it('"13 tortilla chips" bills the 13-chip serving ONCE, not 13 times', async () => {
        // MUTATION: restore `unitsPerServing = match.numberOfUnits || 1`.
        // Kills it at 368.55 g — the exact cold-eval failure.
        const r = await buildFatSecretResult(
            makeCandidate(), parsedLine({ qty: 13, name: 'tortilla chips' }), 0.9,
            '13 tortilla chips',
        );
        expect(r!.grams).toBeCloseTo(28.35, 2);
        // The band the golden case asserts; 368.55 is 5x its ceiling.
        expect(r!.grams!).toBeGreaterThanOrEqual(28);
        expect(r!.grams!).toBeLessThanOrEqual(70);
    });

    it('scales linearly in PIECES — 26 chips is two servings', async () => {
        // MUTATION: hardcode grams to the serving weight instead of qty * perUnit.
        const r = await buildFatSecretResult(
            makeCandidate(), parsedLine({ qty: 26, name: 'tortilla chips' }), 0.9,
            '26 tortilla chips',
        );
        expect(r!.grams).toBeCloseTo(56.7, 2);
    });

    it('one chip is one chip, not one serving', async () => {
        // MUTATION: floor the divisor at 1. Kills it at 28.35.
        const r = await buildFatSecretResult(
            makeCandidate(), parsedLine({ qty: 1, name: 'tortilla chip' }), 0.9,
            '1 tortilla chip',
        );
        expect(r!.grams).toBeCloseTo(2.18, 2);
    });
});

describe('the guard — numberOfUnits still wins where the label is not enumerating', () => {
    it('a count of 1 ("1 thin slice") is NOT a piece enumeration', async () => {
        // MUTATION: drop the `count >= 2` requirement in labelLeadingCount.
        // Without it "1 thin slice" divides by 1 anyway, so this test pins the
        // BEHAVIOUR rather than the branch: 4 slices of a 5 g slice = 20 g.
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            fsId: '1517', name: 'Bacon',
            nutrientsPer100g: { kcal: 541, protein: 37, carbs: 1.4, fat: 42 },
            defaultServingId: 'svThin',
            servings: [{
                servingId: 'svThin', description: '1 thin slice',
                measurementDescription: 'thin slice',
                grams: 5, volumeMl: null, numberOfUnits: 1,
                nutrients: { calories: 27, protein: 1.8, carbohydrate: 0.1, fat: 2.1 },
            }],
        }));
        const r = await buildFatSecretResult(
            makeCandidate({ id: 'fs_1517', name: 'Bacon' }),
            parsedLine({ qty: 4, unit: 'slice', name: 'bacon' }), 0.9, '4 slices bacon',
        );
        expect(r!.grams).toBeCloseTo(20, 2);
    });

    it('a fractional numberOfUnits is still honoured ("1/2 breast" → a whole breast)', async () => {
        // MUTATION: replace the `??` fallback with the labelPieceCount alone.
        // This is the n-mq-47 shape the bare-fallback comment documents.
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            fsId: '4881229', name: 'Chicken Breast',
            nutrientsPer100g: { kcal: 165, protein: 31, carbs: 0, fat: 3.6 },
            defaultServingId: 'svHalf',
            servings: [{
                servingId: 'svHalf', description: '1/2 breast, bone and skin removed',
                measurementDescription: 'breast',
                grams: 118, volumeMl: null, numberOfUnits: 0.5,
                nutrients: { calories: 195, protein: 37, carbohydrate: 0, fat: 4.2 },
            }],
        }));
        const r = await buildFatSecretResult(
            makeCandidate({ id: 'fs_4881229', name: 'Chicken Breast' }),
            parsedLine({ qty: 1, unit: 'breast', name: 'chicken breast' }), 0.9,
            '1 breast chicken',
        );
        expect(r!.grams).toBeCloseTo(236, 1);
    });

    it('a WEIGHT-labeled serving is not a piece enumeration, even when it names the noun', async () => {
        // MUTATION: drop the labelWord === pieceNoun check inside
        // servingLabelCountsPiece. This is the shape that makes the check
        // load-bearing rather than decorative: the serving reaches this branch
        // because `servingMatchesNoun` also reads measurementDescription, so
        // `3 oz` / meas `chip` MATCHES the noun "chip" — but its leading 3
        // counts OUNCES, not chips. Dividing by it would bill 3 chips at 85 g.
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            servings: [{
                servingId: 'svOz', description: '3 oz', measurementDescription: 'chip',
                grams: 85, volumeMl: null, numberOfUnits: 1,
                nutrients: { calories: 450, protein: 6, carbohydrate: 55, fat: 22 },
            }],
        }));
        const r = await buildFatSecretResult(
            makeCandidate(), parsedLine({ qty: 3, unit: 'chip', name: 'tortilla chips' }), 0.9,
            '3 chips',
        );
        // divisor stays numberOfUnits=1 → 3 x 85 g, NOT 3 x 28.3 g.
        expect(r!.grams).toBeCloseTo(255, 1);
    });

    it('generalises past the one record: "2 tortillas" divides to a per-tortilla weight', async () => {
        // Not a guard — the positive case the first block asserts, on a second
        // record shape, so the fix is not read as a fs_63588 special case.
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            servings: [{
                servingId: 'svTort', description: '2 tortillas',
                measurementDescription: 'tortilla',
                grams: 50, volumeMl: null, numberOfUnits: 1,
                nutrients: { calories: 150, protein: 4, carbohydrate: 26, fat: 3 },
            }],
        }));
        const r = await buildFatSecretResult(
            makeCandidate(), parsedLine({ qty: 3, unit: 'tortilla', name: 'tortillas' }), 0.9,
            '3 tortillas',
        );
        expect(r!.grams).toBeCloseTo(75, 1);
    });
});
