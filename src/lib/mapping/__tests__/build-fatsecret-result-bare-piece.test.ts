/**
 * buildFatSecretResult — bare-request per-piece suppression.
 *
 * The FatSecret count branch matched a piece noun against serving descriptions
 * with NO bare-request guard, so a query meaning "a serving" resolved to one
 * piece: bare `almonds` billed 1.2 g / 7 kcal against the OFF cascade's 28 g /
 * 160 kcal (winner-gate, 2026-08-01). OFF had both rules; this copy had
 * neither, and could not even import the plural predicate.
 *
 * Each test below names the mutation it kills, because the point of this file
 * is that the guards are load-bearing, not that the happy path works.
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
        id: 'fs_900', source: 'fatsecret' as const, name: 'Almonds',
        brandName: null, score: 1, foodType: 'Generic', rawData: {}, ...over,
    } as any;
}

/** A real fs shape: a per-piece serving AND a portion serving on one record. */
function makeRow(over: Record<string, unknown> = {}) {
    return {
        fsId: '900', name: 'Almonds', brandName: null, foodType: 'Generic',
        nutrientsPer100g: { kcal: 579, protein: 21, carbs: 22, fat: 50 },
        defaultServingId: 'svOz',
        fetchedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
        servings: [
            {
                servingId: 'svPiece', description: '1 almond', measurementDescription: 'almond',
                grams: 1.2, volumeMl: null, numberOfUnits: 1,
                nutrients: { calories: 7, protein: 0.3, carbohydrate: 0.3, fat: 0.6 },
            },
            {
                servingId: 'svOz', description: '1 oz (23 whole)', measurementDescription: 'oz',
                grams: 28, volumeMl: null, numberOfUnits: 1,
                nutrients: { calories: 162, protein: 6, carbohydrate: 6, fat: 14 },
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

describe('rule (1) — a bare PLURAL asks for a serving, never one piece', () => {
    it('bare "almonds" does not bill the 1.2g per-piece serving', async () => {
        // MUTATION: drop `barePlural ? null :` from the noun computation.
        const r = await buildFatSecretResult(
            makeCandidate(), parsedLine({ name: 'almonds' }), 0.9, 'almonds'
        );
        expect(r!.servingTier).not.toBe('fs_label_count');
        expect(r!.grams).toBeGreaterThanOrEqual(20);
        expect(r!.grams).not.toBeCloseTo(1.2, 3);
    });

    it('the lexicon-free trailing-token fallback is suppressed too', async () => {
        // The plural noun is not in DISCRETE_ITEM_UNIT_RE, so the FIRST match
        // attempt returns nothing and only the trailing-token fallback can
        // reach the per-piece serving. Without `&& !barePlural` on that branch
        // the whole fix is inert for exactly the case that motivated it.
        // MUTATION: drop `&& !barePlural` from the fallback condition.
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            name: 'Pretzels',
            servings: [
                {
                    servingId: 'svPiece', description: '1 pretzel', measurementDescription: 'pretzel',
                    grams: 2.3, volumeMl: null, numberOfUnits: 1,
                    nutrients: { calories: 9, protein: 0.2, carbohydrate: 1.9, fat: 0.1 },
                },
                {
                    servingId: 'svOz', description: '1 oz', measurementDescription: 'oz',
                    grams: 28, volumeMl: null, numberOfUnits: 1,
                    nutrients: { calories: 108, protein: 2.6, carbohydrate: 22.5, fat: 1 },
                },
            ],
        }));
        const r = await buildFatSecretResult(
            makeCandidate({ name: 'Pretzels' }), parsedLine({ name: 'pretzels' }), 0.9, 'pretzels'
        );
        expect(r!.servingTier).not.toBe('fs_label_count');
        expect(r!.grams).not.toBeCloseTo(2.3, 3);
    });

    it('a plural whose NAME is in the discrete-unit lexicon is suppressed too', async () => {
        // The other plural tests only exercise the trailing-token fallback,
        // because "almond"/"pretzel" are not in DISCRETE_ITEM_UNIT_RE. "nuggets"
        // IS, so it reaches the FIRST match attempt — and only the gate on the
        // noun computation stops it. Without this case that gate is untested.
        // MUTATION: drop `barePlural ? null :` from the noun computation.
        //
        // Note what suppression costs: nothing. The default serving IS the
        // manufacturer's serving, so the fall-through answers "a serving of
        // nuggets" (100g) instead of one nugget (25g).
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            name: 'Chicken Nuggets',
            defaultServingId: 'svServ',
            servings: [
                {
                    servingId: 'svPiece', description: '1 nugget', measurementDescription: 'nugget',
                    grams: 25, volumeMl: null, numberOfUnits: 1,
                    nutrients: { calories: 74, protein: 4, carbohydrate: 4, fat: 5 },
                },
                {
                    servingId: 'svServ', description: '4 nuggets', measurementDescription: 'serving',
                    grams: 100, volumeMl: null, numberOfUnits: 4,
                    nutrients: { calories: 296, protein: 16, carbohydrate: 16, fat: 20 },
                },
            ],
        }));
        const r = await buildFatSecretResult(
            makeCandidate({ name: 'Chicken Nuggets' }),
            parsedLine({ name: 'chicken nuggets' }), 0.9, 'chicken nuggets'
        );
        expect(r!.servingTier).not.toBe('fs_label_count');
        expect(r!.grams).not.toBe(25);
    });

    it('"goldfish" counts as plural without plural morphology', async () => {
        // MUTATION: drop BARE_PLURAL_STYLE_NAMES from isBarePluralRequest.
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            name: 'Goldfish Crackers',
            servings: [
                {
                    servingId: 'svPiece', description: '1 cracker', measurementDescription: 'cracker',
                    grams: 0.5, volumeMl: null, numberOfUnits: 1,
                    nutrients: { calories: 2, protein: 0.1, carbohydrate: 0.3, fat: 0.1 },
                },
                {
                    servingId: 'svOz', description: '55 pieces', measurementDescription: 'pieces',
                    grams: 30, volumeMl: null, numberOfUnits: 1,
                    nutrients: { calories: 140, protein: 3, carbohydrate: 20, fat: 5 },
                },
            ],
        }));
        const r = await buildFatSecretResult(
            makeCandidate({ name: 'Goldfish Crackers' }),
            parsedLine({ name: 'goldfish' }), 0.9, 'goldfish'
        );
        expect(r!.servingTier).not.toBe('fs_label_count');
    });
});

describe('rule (2) — a bare SINGULAR must not bill a tiny piece either', () => {
    it('bare "almond" is suppressed by the 20g piece floor', async () => {
        // MUTATION: delete the `bareSingular && perUnitGrams < BARE_MIN_...`
        // branch. "almond" is not morphologically plural, so ONLY this rule
        // stands between the query and a 1.2g bill.
        const r = await buildFatSecretResult(
            makeCandidate(), parsedLine({ name: 'almond' }), 0.9, 'almond'
        );
        expect(r!.servingTier).not.toBe('fs_label_count');
        expect(r!.grams).not.toBeCloseTo(1.2, 3);
    });

    it('a piece AT the floor passes — the floor is >=, not >', async () => {
        // MUTATION: `<` -> `<=` in the floor comparison.
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            name: 'Rice Cakes',
            servings: [{
                servingId: 'svPiece', description: '1 cake', measurementDescription: 'cake',
                grams: 20, volumeMl: null, numberOfUnits: 1,
                nutrients: { calories: 35, protein: 1, carbohydrate: 7, fat: 0.3 },
            }],
            defaultServingId: 'svPiece',
        }));
        const r = await buildFatSecretResult(
            makeCandidate({ name: 'Rice Cake' }), parsedLine({ name: 'rice cake' }), 0.9, 'rice cake'
        );
        expect(r!.servingTier).toBe('fs_label_count');
        expect(r!.grams).toBe(20);
    });

    it('a real single-piece food keeps its piece weight (banana, 118g)', async () => {
        // The floor must not swallow foods where one piece IS the serving.
        // MUTATION: raise BARE_MIN_PIECE_SERVING_GRAMS above 118.
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            name: 'Banana',
            servings: [{
                servingId: 'svPiece', description: '1 medium banana', measurementDescription: 'banana',
                grams: 118, volumeMl: null, numberOfUnits: 1,
                nutrients: { calories: 105, protein: 1.3, carbohydrate: 27, fat: 0.4 },
            }],
            defaultServingId: 'svPiece',
        }));
        const r = await buildFatSecretResult(
            makeCandidate({ name: 'Banana' }), parsedLine({ name: 'banana' }), 0.9, 'banana'
        );
        expect(r!.servingTier).toBe('fs_label_count');
        expect(r!.grams).toBe(118);
    });
});

describe('the default-serving sink — suppression alone was not enough', () => {
    /**
     * The real fs_37040 "Almonds" record, read off the box 2026-08-01:
     *   35301  1 almond                  1.2g   <- defaultServingId
     *   44764  1 oz                     28.35g
     *   35300  1 oz (23 whole kernels)  28.35g
     *   59771  100 g                     100g
     *   35299  1 cup whole                143g
     * Suppressing the count branch moved `almonds` from fs_label_count to
     * fs_default_serving and left the billed grams at 1.2 — the declared
     * default IS the per-piece row. A fix that only suppresses is inert here.
     */
    function almondsRow() {
        return makeRow({
            defaultServingId: 'svPiece',
            servings: [
                {
                    servingId: 'svPiece', description: '1 almond', measurementDescription: 'almond',
                    grams: 1.2, volumeMl: null, numberOfUnits: 1,
                    nutrients: { calories: 7, protein: 0.3, carbohydrate: 0.2, fat: 0.6 },
                },
                {
                    servingId: 'svOz', description: '1 oz (23 whole kernels)', measurementDescription: 'oz',
                    grams: 28.35, volumeMl: null, numberOfUnits: 1,
                    nutrients: { calories: 164, protein: 6, carbohydrate: 6.1, fat: 14.2 },
                },
                {
                    servingId: 'svCup', description: '1 cup whole', measurementDescription: 'cup',
                    grams: 143, volumeMl: null, numberOfUnits: 1,
                    nutrients: { calories: 827, protein: 30.4, carbohydrate: 30.8, fat: 71.4 },
                },
            ],
        });
    }

    it('bare "almonds" bills a serving, not the 1.2g declared default', async () => {
        // MUTATION: delete the bareServingUsable() band on the default-serving
        // branch -> 1.2g comes straight back, with every other test still green.
        mockFatSecretFoodFindUnique.mockResolvedValue(almondsRow());
        const r = await buildFatSecretResult(
            makeCandidate(), parsedLine({ name: 'almonds' }), 0.9, 'almonds'
        );
        expect(r!.grams).toBe(28);           // bare-query lexicon: 1 oz
        expect(r!.servingTier).toBe('bare_category_default');
    });

    it('rejects, and does NOT substitute another serving off the record', async () => {
        // The tempting fix is "take the next in-band serving". It is not safe:
        // prisma include has no orderBy, so the next in-band row here is either
        // 28.35g or 143g depending on DB order. Falling through to the guard is
        // deterministic. This asserts we never land on the cup.
        mockFatSecretFoodFindUnique.mockResolvedValue(almondsRow());
        const r = await buildFatSecretResult(
            makeCandidate(), parsedLine({ name: 'almonds' }), 0.9, 'almonds'
        );
        expect(r!.grams).not.toBe(143);
        expect(r!.grams).not.toBe(28.35);
    });

    it('an in-band declared default is still billed untouched', async () => {
        // The band must only fire where the answer was already out of band.
        // MUTATION: invert the band condition -> this goes red.
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            name: 'Greek Yogurt',
            defaultServingId: 'svCup',
            servings: [{
                servingId: 'svCup', description: '1 container', measurementDescription: 'container',
                grams: 170, volumeMl: null, numberOfUnits: 1,
                nutrients: { calories: 100, protein: 17, carbohydrate: 6, fat: 0 },
            }],
        }));
        const r = await buildFatSecretResult(
            makeCandidate({ name: 'Greek Yogurt' }),
            parsedLine({ name: 'greek yogurt' }), 0.9, 'greek yogurt'
        );
        expect(r!.servingTier).toBe('fs_default_serving');
        expect(r!.grams).toBe(170);
    });

    it('a NON-bare request keeps an out-of-band default serving', async () => {
        // The band is bare-only. "3 almonds" is an explicit count and must still
        // resolve per piece. MUTATION: drop the bare gate from bareServingUsable.
        mockFatSecretFoodFindUnique.mockResolvedValue(almondsRow());
        const r = await buildFatSecretResult(
            makeCandidate(), parsedLine({ qty: 3, name: 'almonds' }), 0.9, '3 almonds'
        );
        expect(r!.grams).toBeCloseTo(3.6, 3);
    });
});

describe('what the suppression must NOT touch', () => {
    it('an explicit count keeps per-piece resolution ("3 almonds" -> 3.6g)', async () => {
        // The digit gate is the whole reason a counted request still works.
        // MUTATION: remove the `/\d/.test(rawLine)` gate from either predicate.
        const r = await buildFatSecretResult(
            makeCandidate(), parsedLine({ qty: 3, name: 'almonds' }), 0.9, '3 almonds'
        );
        expect(r!.servingTier).toBe('fs_label_count');
        expect(r!.grams).toBeCloseTo(3.6, 3);
    });

    it('an explicit count unit is unaffected ("2 bars")', async () => {
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            name: 'Quest Protein Bar',
            servings: [{
                servingId: 'svBar', description: '1 bar', measurementDescription: 'bar',
                grams: 60, volumeMl: null, numberOfUnits: 1,
                nutrients: { calories: 200, protein: 21, carbohydrate: 21, fat: 8 },
            }],
            defaultServingId: 'svBar',
        }));
        const r = await buildFatSecretResult(
            makeCandidate({ name: 'Quest Protein Bar' }),
            parsedLine({ qty: 2, unit: 'bar', name: 'protein bar' }), 0.9, '2 bars'
        );
        expect(r!.servingTier).toBe('fs_label_count');
        expect(r!.grams).toBe(120);
    });

    it('a bare singular with an explicit weight unit is untouched', async () => {
        const r = await buildFatSecretResult(
            makeCandidate(), parsedLine({ qty: 50, unit: 'g', name: 'almonds' }), 0.9, '50g almonds'
        );
        expect(r!.servingTier).toBe('fs_weight_direct');
        expect(r!.grams).toBe(50);
    });
});
