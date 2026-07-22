/**
 * PR D pt3 (Lever A) — buildOffResult wire-ins:
 *   - A1: bare-query serving guard applied AFTER the tier cascade
 *         (CAP on package/label tiers, REPLACE on fabricated tiers)
 *   - A3: bare-plural inversion at the top of the unitless-integer branch,
 *         suppressing per-piece sub-branches (A) label count, (B) seed table,
 *         (C) discrete-unit backfill — the grapes-5g / m&ms-0.9g class
 *         (adversarial finding 4)
 *
 * Golden context: n-serv-36 (olive oil), n-serv-39 (mayonnaise), n-serv-40
 * (almonds), n-serv-48 (ketchup regression guard).
 */

import { buildOffResult, isBarePluralRequest } from '../map-ingredient-with-fallback';
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

function bareParsed(name: string, qty = 1): ParsedIngredient {
    return { qty, multiplier: 1, unit: null, name };
}

beforeEach(() => {
    jest.clearAllMocks();
    (getOrCreateAmbiguousServing as jest.Mock).mockResolvedValue({ status: 'success', grams: 5 });
});

describe('buildOffResult — bare-query guard wire-in (A1)', () => {
    it('CAPs a package-scale label serving on a bare query (olive oil 250g → 14g)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Extra Virgin Olive Oil',
            nutrientsPer100g: { calories: 884, protein: 0, carbs: 0, fat: 100 },
            servingGrams: 250, // whole-bottle "serving"
        }));

        const result = await buildOffResult(
            makeCandidate('Extra Virgin Olive Oil'), bareParsed('olive oil'), 0.9, 'olive oil'
        );

        expect(result).not.toBeNull();
        expect(result?.servingTier).toBe('bare_category_default');
        expect(result?.grams).toBe(14);
        expect(result?.kcal).toBeCloseTo(884 * 0.14, 1);
    });

    it('REPLACEs the fabricated count_unresolved floor (mayonnaise 100g → 14g)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Mayonnaise',
            nutrientsPer100g: { calories: 680, protein: 1, carbs: 1, fat: 75 },
            servingGrams: null,
        }));

        const result = await buildOffResult(
            makeCandidate('Mayonnaise'), bareParsed('mayonnaise'), 0.9, 'mayonnaise'
        );

        expect(result?.servingTier).toBe('bare_category_default');
        expect(result?.grams).toBe(14);
    });

    it('no-op when the label serving survives the CAP ratio (ketchup 15g ≤ 2×14g)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Tomato Ketchup',
            servingGrams: 15,
        }));

        const result = await buildOffResult(
            makeCandidate('Tomato Ketchup'), bareParsed('ketchup'), 0.9, 'ketchup'
        );

        // Since the bare-serving defaults (Track 3, Jul 2026), an in-band own
        // label serving on a bare singular bills as 'bare_label_serving' —
        // same grams, more precise telemetry.
        expect(result?.servingTier).toBe('bare_label_serving');
        expect(result?.grams).toBe(15);
    });

    it('never touches explicit-measure requests (2 tbsp mayonnaise stays volume_unit)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Mayonnaise',
            servingGrams: 340, // whole-jar label would trip the CAP if eligible
        }));

        const parsed: ParsedIngredient = { qty: 2, multiplier: 1, unit: 'tbsp', name: 'mayonnaise' };
        const result = await buildOffResult(
            makeCandidate('Mayonnaise'), parsed, 0.9, '2 tbsp mayonnaise'
        );

        expect(result?.servingTier).toBe('volume_unit');
        expect(result?.grams).toBeCloseTo(32, 1); // paste density: 16 g/tbsp
    });
});

describe('buildOffResult — bare-plural inversion (A3)', () => {
    it('bills the label serving for a bare plural in the sanity band (almonds → 28g, not 1.2g/piece)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Almonds',
            servingGrams: 28,
        }));

        const result = await buildOffResult(
            makeCandidate('Almonds'), bareParsed('almonds'), 0.9, 'almonds'
        );

        expect(result?.servingTier).toBe('bare_plural_serving');
        expect(result?.grams).toBe(28);
        // Per-piece machinery must not have been consulted
        expect(getOrCreateAmbiguousServing).not.toHaveBeenCalled();
    });

    it('documents bare "eggs": label serving in band → one label serving (~1 egg)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Eggs',
            servingGrams: 50,
        }));

        const result = await buildOffResult(
            makeCandidate('Eggs'), bareParsed('eggs'), 0.9, 'eggs'
        );

        expect(result?.servingTier).toBe('bare_plural_serving');
        expect(result?.grams).toBe(50);
    });

    it('suppresses seed + discrete-unit per-piece resolution (grapes class, finding 4)', async () => {
        // Seed table has grape=5g/piece and the discrete-unit mock would return
        // 5g — both must be skipped for a bare plural, landing on the bounded
        // 100g floor (produce is deliberately absent from the bare lexicon).
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Grapes',
            servingGrams: null,
        }));

        const result = await buildOffResult(
            makeCandidate('Grapes'), bareParsed('grapes'), 0.9, 'grapes'
        );

        expect(result?.grams).toBe(100);
        expect(result?.servingTier).toBe('count_unresolved_floor');
        expect(getOrCreateAmbiguousServing).not.toHaveBeenCalled();
    });

    it('out-of-band label serving falls through to label_serving_default, then the CAP (goldfish 170g → 28g)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Goldfish Baked Snack Crackers',
            servingGrams: 170, // family bag billed as the "serving"
        }));

        const result = await buildOffResult(
            makeCandidate('Goldfish Baked Snack Crackers'), bareParsed('goldfish'), 0.9, 'goldfish'
        );

        expect(result?.servingTier).toBe('bare_category_default');
        expect(result?.grams).toBe(28);
    });

    it('explicit counts keep per-piece resolution ("3 almonds" → seed table)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Almonds',
            servingGrams: null,
        }));

        const result = await buildOffResult(
            makeCandidate('Almonds'), bareParsed('almonds', 3), 0.9, '3 almonds'
        );

        expect(result?.servingTier).toBe('seed_count_default');
        expect(result?.grams).toBeCloseTo(3.6, 1); // 3 × 1.2g seed
    });
});

describe('isBarePluralRequest', () => {
    const item = (name: string) => name;

    it.each(['almonds', 'grapes', 'eggs', 'pretzels', 'crackers'])(
        'morphological plural: "%s" qualifies', (name) => {
            expect(isBarePluralRequest(bareParsed(name), name, item(name))).toBe(true);
        });

    it.each(['goldfish', 'chex mix', 'trail mix', 'popcorn', 'granola'])(
        'style-name plural: "%s" qualifies', (name) => {
            expect(isBarePluralRequest(bareParsed(name), name, item(name))).toBe(true);
        });

    it.each(['hummus', 'couscous', 'molasses', 'swiss', 'almond', 'asparagus'])(
        'pseudo-plural / singular: "%s" does NOT qualify', (name) => {
            expect(isBarePluralRequest(bareParsed(name), name, item(name))).toBe(false);
        });

    it('digit gate: "3 almonds" and "1 almonds" never qualify', () => {
        expect(isBarePluralRequest(bareParsed('almonds', 3), '3 almonds', 'almonds')).toBe(false);
        expect(isBarePluralRequest(bareParsed('almonds', 1), '1 almonds', 'almonds')).toBe(false);
    });

    it('unit present never qualifies ("handful of almonds")', () => {
        const parsed: ParsedIngredient = { qty: 1, multiplier: 1, unit: 'handful', name: 'almonds' };
        expect(isBarePluralRequest(parsed, 'handful of almonds', 'almonds')).toBe(false);
    });

    it('qty > 1 without digits never qualifies ("two almonds")', () => {
        expect(isBarePluralRequest(bareParsed('almonds', 2), 'two almonds', 'almonds')).toBe(false);
    });

    it('null parse never qualifies', () => {
        expect(isBarePluralRequest(null, 'almonds', 'almonds')).toBe(false);
    });
});
