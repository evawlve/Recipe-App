/**
 * buildOffResult() reads the matched record's OWN label before it guesses
 * (punch #84 + punch #66, 2026-09-04).
 *
 * Two rungs of the OFF serving cascade skipped a serving row the record itself
 * carries and billed a generic number instead. Both witnesses are live OFF
 * records with a real `openfoodfacts` `OffServing` (isAiEstimated=false), and
 * both were reproduced on the box before this file was written.
 *
 *   (i) COUNT  — `off_0030000216910` (Quaker caramel rice cakes) carries
 *       OffServing 3973949 `1 cake (13 g)`. `4 quaker caramel rice cakes` billed
 *       9 g/cake off the generic seed table because `cake` is not a member of
 *       `LABEL_COUNT_PIECE_NOUNS`, even though `labelPieceMatchesItem('cake',
 *       'quaker caramel rice cakes')` was already true.
 *
 *   (ii) VOLUME — `off_0071406000086` (Hidden Valley "Light ranch") carries
 *       OffServing 4145676 `1 portion (30 ml)` = 30 g. `2 tbsp light ranch`
 *       billed 15 g because `extractLabelServingUnit()` returns `portion`, which
 *       is not `tbsp`, so `label_unit_match` was unreachable and the NAME-inferred
 *       density constant answered. Diego hit this organically at 2026-09-05
 *       03:40:42Z and the async validator flagged it SUSPECT on the serving axis
 *       the same minute.
 *
 * The CONTROL blocks are the point of the file: each rung's guard is asserted to
 * still refuse the case its own producer comment says it must refuse.
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

jest.mock('../../openfoodfacts/hydrate', () => ({ hydrateOffCandidate: jest.fn() }));

jest.mock('../ambiguous-unit-backfill', () => {
    const actual = jest.requireActual('../ambiguous-unit-backfill');
    return { ...actual, getOrCreateAmbiguousServing: jest.fn() };
});

function makeCandidate(name: string) {
    return {
        id: 'off_100', source: 'openfoodfacts' as const, name,
        score: 1, foodType: 'generic', rawData: {},
    } as any;
}

function makeHydrated(overrides: Record<string, unknown>) {
    return {
        foodId: 'off_100',
        foodName: 'Food',
        brandName: null,
        nutrientsPer100g: { calories: 200, protein: 1, carbs: 10, fat: 18 },
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

// ============================================================================
// (i) COUNT — the label's piece word decides, not the eleven-noun set
// ============================================================================

describe('buildOffResult (i): a label piece word matching the item name is read', () => {
    it('bills 4 rice cakes off the record own `1 cake (13 g)` label, not the seed table', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Caramel Rice Cakes',
            servingGrams: 13,
            servingDescription: '1 cake (13 g)',
            servingUnitCount: 1,
        }));

        const parsed: ParsedIngredient = {
            qty: 4, multiplier: 1, unit: null, name: 'quaker caramel rice cakes',
        };
        const result = await buildOffResult(
            makeCandidate('Caramel Rice Cakes'), parsed, 0.9, '4 quaker caramel rice cakes'
        );

        expect(result?.servingTier).toBe('label_count_derived');
        expect(result?.grams).toBeCloseTo(52, 5); // 4 x 13 g, the label's own number
    });

    it('CONTROL: a label unit word absent from the item name is still refused', async () => {
        // The producer comment's own example: "13 chips" must never divide by a
        // "1 container (170g)" label. `container` is not a token of the name.
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Tortilla Chips',
            servingGrams: 170,
            servingDescription: '1 container (170 g)',
            servingUnitCount: 1,
        }));

        const parsed: ParsedIngredient = {
            qty: 13, multiplier: 1, unit: null, name: 'tortilla chips',
        };
        const result = await buildOffResult(
            makeCandidate('Tortilla Chips'), parsed, 0.9, '13 tortilla chips'
        );

        expect(result?.servingTier).not.toBe('label_count_derived');
        expect(result?.grams).not.toBeCloseTo(13 * 170, 5);
    });

    it('CONTROL: the per-piece band still refuses an out-of-band label', async () => {
        // 1 "cake" declared at 900 g is outside [0.2, 500] and must not bill
        // 4 x 900 = 3.6 kg.
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Rice Cakes',
            servingGrams: 900,
            servingDescription: '1 cake (900 g)',
            servingUnitCount: 1,
        }));

        const parsed: ParsedIngredient = {
            qty: 4, multiplier: 1, unit: null, name: 'rice cakes',
        };
        const result = await buildOffResult(
            makeCandidate('Rice Cakes'), parsed, 0.9, '4 rice cakes'
        );

        expect(result?.servingTier).not.toBe('label_count_derived');
    });

    it('CONTROL: the pre-existing label-count case is byte-identical', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Tortilla Chips',
            servingGrams: 28,
            servingDescription: '18 chips (28g)',
            servingUnitCount: 18,
        }));

        const parsed: ParsedIngredient = {
            qty: 1, multiplier: 1, unit: null, name: 'tortilla chip',
        };
        const result = await buildOffResult(
            makeCandidate('Tortilla Chips'), parsed, 0.9, '1 tortilla chip'
        );

        expect(result?.servingTier).toBe('label_count_derived');
        expect(result?.grams).toBeCloseTo(28 / 18, 5);
    });
});

// ============================================================================
// (ii) VOLUME — the record's own declared millilitres beat the name lexicon
// ============================================================================

describe('buildOffResult (ii): a record own declared volume serving is read', () => {
    it('bills `2 tbsp light ranch` at the label own 30 ml / 30 g, not the density constant', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Light ranch',
            brandName: 'hidden valley',
            servingGrams: 30,
            servingDescription: '1 portion (30 ml)',
            servingUnitCount: 1,
        }));

        const parsed: ParsedIngredient = {
            qty: 2, multiplier: 1, unit: 'tbsp', name: 'light ranch',
        };
        const result = await buildOffResult(
            makeCandidate('Light ranch'), parsed, 0.9, '2 tbsp light ranch'
        );

        expect(result?.servingTier).toBe('off_label_volume');
        // 2 x VOLUME_UNIT_ML.tbsp (15) x (30 g / 30 ml) = 30 g. It billed 15 g.
        expect(result?.grams).toBeCloseTo(30, 5);
    });

    it('bills the Coffee-Mate witness at 30 g off its `1 portion (15 ml)` label', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Zero Sugar French Vanilla',
            servingGrams: 15,
            servingDescription: '1 portion (15 ml)',
            servingUnitCount: 1,
        }));

        const parsed: ParsedIngredient = {
            qty: 2, multiplier: 1, unit: 'tbsp', name: 'coffee mate zero sugar french vanilla',
        };
        const result = await buildOffResult(
            makeCandidate('Zero Sugar French Vanilla'), parsed, 0.9,
            '2 tbsp coffee mate zero sugar french vanilla'
        );

        expect(result?.servingTier).toBe('off_label_volume');
        expect(result?.grams).toBeCloseTo(30, 5);
    });

    it('CONTROL: no parenthesised millilitres leaves `volume_unit` untouched', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Light ranch',
            servingGrams: 30,
            servingDescription: '1 portion (30 g)', // grams, not ml
            servingUnitCount: 1,
        }));

        const parsed: ParsedIngredient = {
            qty: 2, multiplier: 1, unit: 'tbsp', name: 'light ranch',
        };
        const result = await buildOffResult(
            makeCandidate('Light ranch'), parsed, 0.9, '2 tbsp light ranch'
        );

        expect(result?.servingTier).toBe('volume_unit');
    });

    it('CONTROL: an out-of-band implied density falls back to `volume_unit`', async () => {
        // 300 g declared against 30 ml is 10 g/ml — outside [0.1, 1.6]. 83 rows in
        // the live corpus disagree like this (0.004 to 120); the band is why.
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Light ranch',
            servingGrams: 300,
            servingDescription: '1 portion (30 ml)',
            servingUnitCount: 1,
        }));

        const parsed: ParsedIngredient = {
            qty: 2, multiplier: 1, unit: 'tbsp', name: 'light ranch',
        };
        const result = await buildOffResult(
            makeCandidate('Light ranch'), parsed, 0.9, '2 tbsp light ranch'
        );

        expect(result?.servingTier).toBe('volume_unit');
    });

    it('CONTROL: a label naming the REQUESTED unit still wins as `label_unit_match`', async () => {
        // ownLabelBeatsVolumeConstant is the stronger read and is checked first;
        // this branch must not steal its traffic.
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Cereal',
            servingGrams: 30,
            servingDescription: '1 cup (240 ml)',
            servingUnitCount: 1,
        }));

        const parsed: ParsedIngredient = {
            qty: 1, multiplier: 1, unit: 'cup', name: 'cereal',
        };
        const result = await buildOffResult(
            makeCandidate('Cereal'), parsed, 0.9, '1 cup cereal'
        );

        expect(result?.servingTier).toBe('label_unit_match');
        expect(result?.grams).toBeCloseTo(30, 5);
    });

    it('CONTROL: a WEIGHT request is unaffected', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Light ranch',
            servingGrams: 30,
            servingDescription: '1 portion (30 ml)',
            servingUnitCount: 1,
        }));

        const parsed: ParsedIngredient = {
            qty: 50, multiplier: 1, unit: 'g', name: 'light ranch',
        };
        const result = await buildOffResult(
            makeCandidate('Light ranch'), parsed, 0.9, '50 g light ranch'
        );

        expect(result?.servingTier).toBe('weight_unit');
        expect(result?.grams).toBeCloseTo(50, 5);
    });
});
