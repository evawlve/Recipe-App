/**
 * Characterization: hydration-lane serving math is INDEPENDENT of
 * countedPieceNoun for qty<2 lines (count_label escape narrowing, Aug 2026).
 *
 * countedPieceNoun's qty >= 2 gate silences the counted-piece RETRIEVAL
 * preference and the count_label cache ESCAPE for bare/qty-1 lines — it must
 * not move a resolved record's grams or servingTier. buildOffResult derives
 * its own nouns (labelUnitWord from the record's label; pieceNounInName on the
 * item name for the generic-pieces and package-count gates) and gates counts
 * on its own `qty >= 1` integer check, so these pins hold identically before
 * and after the predicate change. If either pin breaks under a countedPieceNoun
 * edit, serving math has grown a dependency on the query-side predicate — the
 * exact coupling this file exists to forbid.
 *
 * The FatSecret builder's half of the same claim is already pinned by
 * build-fatsecret-result-label-count.test.ts ("one chip is one chip, not one
 * serving" — qty=1, 2.18 g): build-fatsecret-result.ts does not import
 * countedPieceNoun at all.
 *
 * Owner: sync-docs/reports/2026-08-09_serving-class-keys-the-pick-is-already-unit-aware.md §8.
 */

import { buildOffResult } from '../map-ingredient-with-fallback';
import { hydrateOffCandidate } from '../../openfoodfacts/hydrate';
import { getOrCreateAmbiguousServing } from '../ambiguous-unit-backfill';
import type { ParsedIngredient } from '../../parse/ingredient-line';

jest.mock('../../db', () => ({
    prisma: {
        $queryRaw: jest.fn().mockResolvedValue([]),
        fdcFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        offFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        aiGeneratedFood: {
            findMany: jest.fn().mockResolvedValue([]),
            findFirst: jest.fn().mockResolvedValue(null),
            findUnique: jest.fn().mockResolvedValue(null),
        },
        foodMapping: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    },
}));

jest.mock('../../openfoodfacts/hydrate', () => ({
    hydrateOffCandidate: jest.fn(),
}));

jest.mock('../ambiguous-unit-backfill', () => {
    const actual = jest.requireActual('../ambiguous-unit-backfill');
    return {
        ...actual,
        getOrCreateAmbiguousServing: jest.fn(),
    };
});

function makeCandidate(name: string) {
    return {
        id: 'off_100',
        source: 'openfoodfacts' as const,
        name,
        score: 1,
        foodType: 'generic',
        rawData: {},
    } as any;
}

function makeHydrated(overrides: Record<string, unknown>) {
    return {
        foodId: 'off_100',
        foodName: 'Food',
        brandName: null,
        nutrientsPer100g: { calories: 500, protein: 10, carbs: 50, fat: 25 },
        servingGrams: null,
        servingDescription: null,
        servingUnitCount: 1,
        packageQuantity: null,
        packageQuantityUnit: null,
        ...overrides,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    (getOrCreateAmbiguousServing as jest.Mock).mockResolvedValue({ status: 'success', grams: 5 });
});

describe('buildOffResult — qty<2 counted lines resolve without countedPieceNoun', () => {
    it('explicit qty=1 ("1 tortilla chip") still derives per-piece grams from the label count', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Tortilla Chips',
            servingGrams: 28,
            servingDescription: '18 chips (28g)',
            servingUnitCount: 18,
        }));

        const parsed: ParsedIngredient = { qty: 1, multiplier: 1, unit: null, name: 'tortilla chip' };
        const result = await buildOffResult(
            makeCandidate('Tortilla Chips'), parsed, 0.9, '1 tortilla chip'
        );

        expect(result).not.toBeNull();
        expect(result?.servingTier).toBe('label_count_derived');
        expect(result?.grams).toBeCloseTo(28 / 18, 2); // one chip off the label, ~1.56g
        // No AI/sibling serving estimation was consulted to bill one piece.
        expect(getOrCreateAmbiguousServing).not.toHaveBeenCalled();
    });

    it('parser-default bare line ("goldfish crackers", qty=1) still bills the in-band label serving', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Goldfish Crackers',
            servingGrams: 28,
        }));

        const parsed: ParsedIngredient = { qty: 1, multiplier: 1, unit: null, name: 'goldfish crackers' };
        const result = await buildOffResult(
            makeCandidate('Goldfish Crackers'), parsed, 0.9, 'goldfish crackers'
        );

        expect(result).not.toBeNull();
        expect(result?.servingTier).toBe('bare_plural_serving');
        expect(result?.grams).toBe(28);
        expect(getOrCreateAmbiguousServing).not.toHaveBeenCalled();
    });
});
