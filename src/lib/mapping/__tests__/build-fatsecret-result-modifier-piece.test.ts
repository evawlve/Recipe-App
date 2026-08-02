/**
 * buildFatSecretResult — a piece serving labelled with a MODIFIER of the name.
 *
 * The counted-request fallback scanned only the request's LAST token, but
 * FatSecret routinely labels the piece with a modifier of the product name
 * rather than its head noun. `fs_519595` "Cherry Tomatoes" carries `1 cherry`
 * at 17 g — the record's own per-piece row — while the request head noun is
 * `tomatoes`. Nothing matched, so resolution fell through to the declared
 * `1 serving (123 g)` row and `5 cherry tomatoes` billed 5 x 123 = 615 g
 * against golden n-serv-13's [50, 120] band (measured cold 2026-08-02).
 *
 * The fix reuses `labelPieceMatchesItem` from count-label.ts — "is the label's
 * piece word literally one of the words the user is counting?" — whose only
 * caller was the cache escape in map-ingredient-with-fallback. That predicate
 * is also the GUARD: `1 cup` and `1 oz` sit on this same record and are
 * rejected because neither word appears in "cherry tomatoes".
 *
 * Each test names the mutation it kills. The point of this file is that the
 * scan is bounded, not that the happy path works — a scan that matched any
 * serving would pass the first test and fail four others here.
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
        id: 'fs_519595', source: 'fatsecret' as const, name: 'Cherry Tomatoes',
        brandName: null, score: 1, foodType: 'Generic', rawData: {}, ...over,
    } as any;
}

/** fs_519595's real serving set, measured on the box 2026-08-02. */
function makeRow(over: Record<string, unknown> = {}) {
    return {
        fsId: '519595', name: 'Cherry Tomatoes', brandName: null, foodType: 'Generic',
        nutrientsPer100g: { kcal: 18, protein: 0.9, carbs: 3.9, fat: 0.2 },
        defaultServingId: 'sv100',
        fetchedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
        servings: [
            {
                servingId: 'svCherry', description: '1 cherry', measurementDescription: 'cherry',
                grams: 17, volumeMl: null, numberOfUnits: 1,
                nutrients: { calories: 3, protein: 0.15, carbohydrate: 0.66, fat: 0.03 },
            },
            {
                servingId: 'svOz', description: '1 oz', measurementDescription: 'oz',
                grams: 26, volumeMl: null, numberOfUnits: 1,
                nutrients: { calories: 4.7, protein: 0.23, carbohydrate: 1.01, fat: 0.05 },
            },
            {
                servingId: 'sv100', description: '100 g', measurementDescription: 'g',
                grams: 100, volumeMl: null, numberOfUnits: 100,
                nutrients: { calories: 18, protein: 0.9, carbohydrate: 3.9, fat: 0.2 },
            },
            {
                servingId: 'svServing', description: '1 serving (123 g)',
                measurementDescription: 'serving (123g)',
                grams: 123, volumeMl: null, numberOfUnits: 1,
                nutrients: { calories: 22, protein: 1.1, carbohydrate: 4.8, fat: 0.25 },
            },
            {
                servingId: 'svCup', description: '1 cup', measurementDescription: 'cup',
                grams: 149, volumeMl: null, numberOfUnits: 1,
                nutrients: { calories: 27, protein: 1.3, carbohydrate: 5.8, fat: 0.3 },
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

describe('a piece serving named by a modifier of the request', () => {
    it('"5 cherry tomatoes" bills 5 cherries, not 5 servings', async () => {
        // MUTATION: delete the labelPieceMatchesItem scan. Kills it at 615 g —
        // the exact cold-eval failure for golden n-serv-13.
        const r = await buildFatSecretResult(
            makeCandidate(), parsedLine({ qty: 5, name: 'cherry tomatoes' }), 0.9,
            '5 cherry tomatoes',
        );
        expect(r!.grams).toBeCloseTo(85, 1);
        // The band the golden case asserts; 615 is 5x its ceiling.
        expect(r!.grams!).toBeGreaterThanOrEqual(50);
        expect(r!.grams!).toBeLessThanOrEqual(120);
    });

    it('does NOT borrow the `1 cup` or `1 oz` row sitting on the same record', async () => {
        // MUTATION: drop the "word must appear in the request" test and take the
        // first labelled serving instead. `1 cup` -> 745 g, `1 oz` -> 130 g.
        //
        // The measure rows are ordered FIRST here deliberately. With the record's
        // natural order this test passes even against an unbounded scan, because
        // `1 cherry` happens to come first — it asserted nothing until the order
        // was inverted. `usableServings` order is not guaranteed anyway: it is a
        // filter over an unordered DB read.
        const natural = makeRow();
        const byId = (id: string) =>
            (natural.servings as Array<{ servingId: string }>).find(s => s.servingId === id)!;
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            servings: [byId('svCup'), byId('svOz'), byId('svServing'), byId('svCherry')],
        }));
        const r = await buildFatSecretResult(
            makeCandidate(), parsedLine({ qty: 5, name: 'cherry tomatoes' }), 0.9,
            '5 cherry tomatoes',
        );
        expect(r!.grams).not.toBeCloseTo(745, 0);
        expect(r!.grams).not.toBeCloseTo(130, 0);
        expect(r!.grams).toBeCloseTo(85, 1);
    });

    it('scales linearly in PIECES — 10 cherry tomatoes is two of five', async () => {
        // MUTATION: hardcode grams to the matched serving weight instead of
        // qty * perUnit.
        const r = await buildFatSecretResult(
            makeCandidate(), parsedLine({ qty: 10, name: 'cherry tomatoes' }), 0.9,
            '10 cherry tomatoes',
        );
        expect(r!.grams).toBeCloseTo(170, 1);
    });

    it('a request that does not NAME the piece must not borrow it', async () => {
        // MUTATION: scan for any serving, or compare against the record name
        // instead of the request. "grape tomatoes" never says "cherry", so the
        // 17 g row is not its per-piece weight and the declared serving stands.
        //
        // 615 g is itself wrong, but it is a DIFFERENT defect (the record has no
        // piece row this request names) and not one this change claims to fix.
        const r = await buildFatSecretResult(
            makeCandidate(), parsedLine({ qty: 5, name: 'grape tomatoes' }), 0.9,
            '5 grape tomatoes',
        );
        expect(r!.grams).not.toBeCloseTo(85, 1);
    });

    it('the head noun still wins when it matches — the scan is a FALLBACK', async () => {
        // MUTATION: run the modifier scan before the last-token scan. `1 pepper`
        // is the head-noun match at 10 g (50 g), the `1 cherry` row would give 85 g.
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            name: 'Cherry Peppers',
            servings: [
                {
                    servingId: 'svCherry', description: '1 cherry', measurementDescription: 'cherry',
                    grams: 17, volumeMl: null, numberOfUnits: 1,
                    nutrients: { calories: 3, protein: 0.15, carbohydrate: 0.66, fat: 0.03 },
                },
                {
                    servingId: 'svPepper', description: '1 pepper', measurementDescription: 'pepper',
                    grams: 10, volumeMl: null, numberOfUnits: 1,
                    nutrients: { calories: 2, protein: 0.1, carbohydrate: 0.4, fat: 0.02 },
                },
            ],
        }));
        const r = await buildFatSecretResult(
            makeCandidate({ name: 'Cherry Peppers' }),
            parsedLine({ qty: 5, name: 'cherry peppers' }), 0.9, '5 cherry peppers',
        );
        expect(r!.grams).toBeCloseTo(50, 1);
    });

    it('a BARE plural still asks for a serving, not one cherry', async () => {
        // MUTATION: drop the `!barePlural` gate on the fallback block. Kills it at
        // 17 g — bare "cherry tomatoes" means a portion, never a single fruit.
        const r = await buildFatSecretResult(
            makeCandidate(), parsedLine({ qty: 1, name: 'cherry tomatoes' }), 0.9,
            'cherry tomatoes',
        );
        expect(r!.grams).toBeCloseTo(123, 1);
    });
});
