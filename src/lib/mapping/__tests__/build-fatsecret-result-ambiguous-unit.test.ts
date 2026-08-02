/**
 * buildFatSecretResult — ambiguous / count units ("handful", "sleeve", "bowl").
 *
 * `buildOffResult()` and `buildFdcResult()` both resolve these through
 * `getOrCreateAmbiguousServing()`. This cascade never called it, so the request
 * fell to the record's declared default — whichever single piece it leads with.
 *
 * Latent while the FatSecret lane reached the reranker on 16.9% of queries; the
 * lane-composition fix made FatSecret the winner for these lines and the gate
 * measured it (2026-08-02, regression pool):
 *     1 handful almonds          30g       ->  1.2g
 *     1 sleeve saltine crackers  113g/490kcal -> 3g/13kcal
 * one almond and one cracker respectively.
 *
 * Note what is NOT the fix, because it was the obvious one: banding the
 * declared default. This builder is terminal, so a rejection lands on the flat
 * per-100g tier, and the bare-query guard's digit gate excludes every one of
 * these lines. 100g for a handful of almonds is wrong in the other direction.
 * The request needs an answer, not a veto.
 */

const mockFatSecretFoodFindUnique = jest.fn();
const mockGetOrCreateAmbiguousServing = jest.fn();

jest.mock('../../db', () => ({
    prisma: {
        fatSecretFood: {
            findUnique: (...args: unknown[]) => mockFatSecretFoodFindUnique(...args),
        },
    },
}));

jest.mock('../ambiguous-unit-backfill', () => ({
    isAmbiguousUnit: jest.requireActual('../ambiguous-unit-backfill').isAmbiguousUnit,
    getOrCreateAmbiguousServing: (...args: unknown[]) => mockGetOrCreateAmbiguousServing(...args),
}));

import { buildFatSecretResult } from '../build-fatsecret-result';
import type { ParsedIngredient } from '../../parse/ingredient-line';

function makeCandidate(over: Record<string, unknown> = {}) {
    return {
        id: 'fs_37040', source: 'fatsecret' as const, name: 'Almonds',
        brandName: null, score: 1, foodType: 'Generic', rawData: {}, ...over,
    } as any;
}

/** fs_37040's real shape: the declared default IS the 1.2g single almond. */
function makeRow(over: Record<string, unknown> = {}) {
    return {
        fsId: '37040', name: 'Almonds', brandName: null, foodType: 'Generic',
        nutrientsPer100g: { kcal: 578, protein: 21, carbs: 22, fat: 50 },
        defaultServingId: 'svPiece',
        fetchedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
        servings: [
            {
                servingId: 'svPiece', description: '1 almond', measurementDescription: 'almond',
                grams: 1.2, volumeMl: null, numberOfUnits: 1,
                nutrients: { calories: 7, protein: 0.3, carbohydrate: 0.3, fat: 0.6 },
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
    mockGetOrCreateAmbiguousServing.mockResolvedValue({ status: 'success', grams: 30 });
});

describe('the unit reaches the shared resolver', () => {
    it('"1 handful almonds" bills the resolved handful, not the 1.2g almond', async () => {
        // MUTATION: delete the (c2) block -> falls to fs_default_serving at 1.2g.
        const r = await buildFatSecretResult(
            makeCandidate(),
            parsedLine({ unit: 'handful', name: 'almonds' }),
            0.9, '1 handful almonds'
        );
        expect(r!.grams).toBe(30);
        expect(r!.servingTier).toBe('count_unit_ai');
        expect(mockGetOrCreateAmbiguousServing).toHaveBeenCalledWith(
            'fs_37040', 'Almonds', 'handful', null
        );
    });

    it('a cached resolution is tiered as cached, not as a fresh estimate', async () => {
        // The tier is how the flywheel tells a cache hit from an LLM spend.
        mockGetOrCreateAmbiguousServing.mockResolvedValue({ status: 'cached', grams: 113 });
        const r = await buildFatSecretResult(
            makeCandidate({ name: 'Saltine Crackers' }),
            parsedLine({ unit: 'sleeve', name: 'saltine crackers' }),
            0.9, '1 sleeve saltine crackers'
        );
        expect(r!.grams).toBe(113);
        expect(r!.servingTier).toBe('count_unit_cached');
    });

    it('scales by qty — "2 bowls cereal" is two resolved bowls', async () => {
        mockGetOrCreateAmbiguousServing.mockResolvedValue({ status: 'success', grams: 50 });
        const r = await buildFatSecretResult(
            makeCandidate({ name: 'Cereal' }),
            parsedLine({ qty: 2, unit: 'bowl', name: 'cereal' }),
            0.9, '2 bowls cereal'
        );
        expect(r!.grams).toBe(100);
    });
});

describe('ordering — a label the record genuinely enumerates still wins', () => {
    it('"2 bars" matches the record\'s own bar serving and never consults the resolver', async () => {
        // MUTATION: move the (c2) block ABOVE the noun match -> the resolver
        // answers a unit the label already defines, and this call count is 1.
        mockFatSecretFoodFindUnique.mockResolvedValue(makeRow({
            name: 'Protein Bar', defaultServingId: 'svBar',
            servings: [{
                servingId: 'svBar', description: '1 bar', measurementDescription: 'bar',
                grams: 60, volumeMl: null, numberOfUnits: 1, nutrients: null,
            }],
        }));
        const r = await buildFatSecretResult(
            makeCandidate({ name: 'Protein Bar' }),
            parsedLine({ qty: 2, unit: 'bar', name: 'bars' }),
            0.9, '2 bars'
        );
        expect(r!.grams).toBe(120);
        expect(r!.servingTier).toBe('fs_label_count');
        expect(mockGetOrCreateAmbiguousServing).not.toHaveBeenCalled();
    });

    it('an explicit weight unit never reaches the resolver', async () => {
        const r = await buildFatSecretResult(
            makeCandidate(),
            parsedLine({ qty: 50, unit: 'g', name: 'almonds' }),
            0.9, '50g almonds'
        );
        expect(r!.grams).toBe(50);
        expect(mockGetOrCreateAmbiguousServing).not.toHaveBeenCalled();
    });

    it('a bare request has no unit and never reaches the resolver', async () => {
        await buildFatSecretResult(
            makeCandidate(), parsedLine({ name: 'almonds' }), 0.9, 'almonds'
        );
        expect(mockGetOrCreateAmbiguousServing).not.toHaveBeenCalled();
    });
});

describe('the resolver failing is not a crash and not a fabrication', () => {
    it('an unresolved unit falls through to the existing cascade', async () => {
        // MUTATION: drop the status/grams guard and bill `ambiguous.grams`
        // unconditionally -> NaN grams reach the caller.
        mockGetOrCreateAmbiguousServing.mockResolvedValue({ status: 'error', error: 'no estimate' });
        const r = await buildFatSecretResult(
            makeCandidate(),
            parsedLine({ unit: 'handful', name: 'almonds' }),
            0.9, '1 handful almonds'
        );
        expect(r).not.toBeNull();
        expect(Number.isFinite(r!.grams)).toBe(true);
        expect(r!.servingTier).not.toBe('count_unit_ai');
    });

    it('a zero or negative resolution is refused', async () => {
        mockGetOrCreateAmbiguousServing.mockResolvedValue({ status: 'success', grams: 0 });
        const r = await buildFatSecretResult(
            makeCandidate(),
            parsedLine({ unit: 'handful', name: 'almonds' }),
            0.9, '1 handful almonds'
        );
        expect(r!.grams).not.toBe(0);
        expect(r!.servingTier).not.toBe('count_unit_ai');
    });
});
