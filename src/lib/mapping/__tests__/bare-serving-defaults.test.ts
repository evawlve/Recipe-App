/**
 * Bare-serving defaults (Track 3, Jul 2026) — buildOffResult resolution order
 * for digitless unitless qty-1 requests ("the unitless qty-1 class", 82
 * confirmed triage rows 2026-07-21):
 *   (1) the record's OWN in-band label serving  → 'bare_label_serving'
 *   (2) count-noun piece when the NAME implies one (seed / discrete backfill)
 *   (3) same-brand sibling median label serving → 'bare_sibling_serving'
 *   (4) bounded floor — never flat-100g for a discrete-piece name
 *
 * Representative triage rows exercised here: combos cheddar pretzel (label
 * over per-piece divide), yoplait original strawberry (label over seed piece),
 * pepper jack (head-gated CAP), snickers/barebells (placeholder-100 → sibling
 * median), kirkland protein bar (discrete backfill), sun chips (label over
 * count-label divide).
 */

import { buildOffResult } from '../map-ingredient-with-fallback';
import { hydrateOffCandidate } from '../../openfoodfacts/hydrate';
import { getOrCreateAmbiguousServing } from '../ambiguous-unit-backfill';
import { prisma } from '../../db';
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
        nutrientsPer100g: { calories: 400, protein: 10, carbs: 50, fat: 15 },
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

const mockedQueryRaw = prisma.$queryRaw as jest.Mock;

beforeEach(() => {
    jest.clearAllMocks();
    mockedQueryRaw.mockResolvedValue([]);
    (getOrCreateAmbiguousServing as jest.Mock).mockResolvedValue({ status: 'error', error: 'not mocked' });
});

describe('step (1) — own in-band label serving wins for bare requests', () => {
    it("bills the full label serving, not the per-piece divide ('combos cheddar pretzel' 28g label ÷ 9 pieces)", async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Combos Cheddar Pretzel',
            brandName: 'Combos',
            servingGrams: 28,
            servingDescription: '9 piece (28 g)',
            servingUnitCount: 9,
        }));

        const result = await buildOffResult(
            makeCandidate('Combos Cheddar Pretzel'),
            bareParsed('combos cheddar pretzel'), 0.9, 'combos cheddar pretzel'
        );

        expect(result?.servingTier).toBe('bare_label_serving');
        expect(result?.grams).toBe(28);   // NOT 28/9 = 3.11
    });

    it("bills the label cup, not the strawberry seed piece ('yoplait original strawberry' 170g vs 12g)", async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Yoplait Original Strawberry',
            brandName: 'Yoplait',
            servingGrams: 170,
            servingDescription: '170 g',
        }));

        const result = await buildOffResult(
            makeCandidate('Yoplait Original Strawberry'),
            bareParsed('yoplait original strawberry'), 0.9, 'yoplait original strawberry'
        );

        expect(result?.servingTier).toBe('bare_label_serving');
        expect(result?.grams).toBe(170);
    });

    it("survives the contained-token spice cap ('pepper jack' 28g label, was capped to 2.5g)", async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Pepper Jack Cheese',
            servingGrams: 28,
            servingDescription: '3 SLICES (28 g)',
            servingUnitCount: 3,
        }));

        const result = await buildOffResult(
            makeCandidate('Pepper Jack Cheese'), bareParsed('pepper jack'), 0.9, 'pepper jack'
        );

        expect(result?.servingTier).toBe('bare_label_serving');
        expect(result?.grams).toBe(28);
    });

    it("bills the count-labeled serving whole, not one chip ('sun chips harvest cheddar' 28g vs 2g)", async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Sun Chips Harvest Cheddar',
            brandName: 'Sun Chips',
            servingGrams: 28,
            servingDescription: '14 chips (28 g)',
            servingUnitCount: 14,
        }));

        const result = await buildOffResult(
            makeCandidate('Sun Chips Harvest Cheddar'),
            bareParsed('sun chips harvest cheddar'), 0.9, 'sun chips harvest cheddar'
        );

        expect(result?.servingTier).toBe('bare_label_serving');
        expect(result?.grams).toBe(28);
    });

    it('explicit counts still use the per-piece divide ("3 sun chips" keeps label_count_derived)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Sun Chips Harvest Cheddar',
            servingGrams: 28,
            servingDescription: '14 chips (28 g)',
            servingUnitCount: 14,
        }));

        const result = await buildOffResult(
            makeCandidate('Sun Chips Harvest Cheddar'),
            bareParsed('sun chips', 3), 0.9, '3 sun chips'
        );

        expect(result?.servingTier).toBe('label_count_derived');
        expect(result?.grams).toBe(6);   // 3 × 2g per chip
    });
});

describe('step (3) — same-brand sibling median for placeholder/garbage labels', () => {
    it("resolves the placeholder-100 snickers SKU from 148 sibling bars (~39.8g)", async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Snickers',
            brandName: 'Snickers',
            servingGrams: 100,
            servingDescription: '1 portion (100 g)',
        }));
        mockedQueryRaw.mockResolvedValue([{ med: 39.8, n: 148 }]);

        const result = await buildOffResult(
            makeCandidate('Snickers'), bareParsed('snickers'), 0.9, 'snickers'
        );

        expect(result?.servingTier).toBe('bare_sibling_serving');
        expect(result?.grams).toBe(39.8);
    });

    it("resolves 'barebells caramel cashew' to the 55g brand median, not the 1.5g cashew seed", async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Caramel Cashew',
            brandName: 'Barebells',
            servingGrams: 100,
            servingDescription: '100 g',
        }));
        mockedQueryRaw.mockResolvedValue([{ med: 55, n: 200 }]);

        const result = await buildOffResult(
            makeCandidate('Caramel Cashew'),
            bareParsed('barebells caramel cashew'), 0.9, 'barebells caramel cashew'
        );

        expect(result?.servingTier).toBe('bare_sibling_serving');
        expect(result?.grams).toBe(55);
    });

    it('rejects garbage sub-3g label metadata and borrows the sibling median (hot-pocket "1.0g" class)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Ham & Cheese Hot Pocket',
            brandName: 'Hot Pockets',
            servingGrams: 1,
            servingDescription: '1.0g',
        }));
        mockedQueryRaw.mockResolvedValue([{ med: 127, n: 12 }]);

        const result = await buildOffResult(
            makeCandidate('Ham & Cheese Hot Pocket'),
            bareParsed('hot pocket ham and cheese'), 0.9, 'hot pocket ham and cheese'
        );

        expect(result?.servingTier).toBe('bare_sibling_serving');
        expect(result?.grams).toBe(127);
    });

    it('fewer than 3 siblings → falls through to the label default + legacy CAP (butter chicken)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Butter Chicken',
            brandName: 'Golden Chicken',
            servingGrams: 100,
            servingDescription: '1 portion (100 g)',
        }));
        mockedQueryRaw.mockResolvedValue([{ med: 55, n: 2 }]);

        const result = await buildOffResult(
            makeCandidate('Butter Chicken'), bareParsed('butter chicken'), 0.9, 'butter chicken'
        );

        // Sibling borrow refused (n < 3) → label_serving_default 100g → the
        // legacy containment CAP ('butter' token) shrinks it to 14g. This
        // documents the PRE-EXISTING tail defect (triage row: butter chicken
        // 14g): fixing it requires >=3 brand siblings, which routes through
        // the untouched bare_sibling_serving tier instead.
        expect(result?.servingTier).toBe('bare_category_default');
        expect(result?.grams).toBe(14);
    });

    it('digit lines never take the bare path ("1 gatorade" keeps the package bill)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Gatorade Thirst Quencher',
            brandName: 'Gatorade',
            servingGrams: null,
            packageQuantity: 591,
            packageQuantityUnit: 'ml',
        }));
        mockedQueryRaw.mockResolvedValue([{ med: 355, n: 190 }]);

        const result = await buildOffResult(
            makeCandidate('Gatorade Thirst Quencher'), bareParsed('gatorade'), 0.9, '1 gatorade'
        );

        expect(result?.servingTier).toBe('package_count_own');
        expect(result?.grams).toBe(591);
    });

    it('bare beverage with an own ml package keeps drink-the-unit semantics (digitless "gatorade")', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Gatorade Thirst Quencher',
            brandName: 'Gatorade',
            servingGrams: null,
            packageQuantity: 591,
            packageQuantityUnit: 'ml',
        }));
        mockedQueryRaw.mockResolvedValue([{ med: 355, n: 190 }]);

        const result = await buildOffResult(
            makeCandidate('Gatorade Thirst Quencher'), bareParsed('gatorade'), 0.9, 'gatorade'
        );

        expect(result?.servingTier).toBe('package_count_own');
        expect(result?.grams).toBe(591);
    });
});

describe('step (2) — count-noun piece resolution for bare requests', () => {
    it("routes 'kirkland protein bar chocolate chip' through the discrete 'bar' backfill with brandForBorrow", async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Protein Bar Chocolate Chip Cookie Dough',
            brandName: 'Kirkland Signature',
            servingGrams: null,
        }));
        (getOrCreateAmbiguousServing as jest.Mock).mockResolvedValue({ status: 'success', grams: 60 });

        const result = await buildOffResult(
            makeCandidate('Protein Bar Chocolate Chip Cookie Dough'),
            bareParsed('kirkland protein bar chocolate chip'), 0.9, 'kirkland protein bar chocolate chip'
        );

        expect(result?.servingTier).toBe('discrete_unit_backfill');
        expect(result?.grams).toBe(60);
        expect(getOrCreateAmbiguousServing).toHaveBeenCalledWith(
            'off_100', 'Protein Bar Chocolate Chip Cookie Dough', 'bar', 'Kirkland Signature'
        );
    });

    it('runs the discrete backfill even when the label is a placeholder (bare request, 100g flat)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Barebells Protein Bar Caramel Cashew',
            brandName: 'Barebells',
            servingGrams: 100,
            servingDescription: '100 g',
        }));
        (getOrCreateAmbiguousServing as jest.Mock).mockResolvedValue({ status: 'success', grams: 55 });

        const result = await buildOffResult(
            makeCandidate('Barebells Protein Bar Caramel Cashew'),
            bareParsed('barebells protein bar'), 0.9, 'barebells protein bar'
        );

        expect(result?.servingTier).toBe('discrete_unit_backfill');
        expect(result?.grams).toBe(55);
    });

    it("skips a tiny per-piece seed on a bare singular (bare 'almond' → lexicon 28g, not the 1.2g nut)", async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Almond',
            servingGrams: null,
        }));

        const result = await buildOffResult(
            makeCandidate('Almond'), bareParsed('almond'), 0.9, 'almond'
        );

        expect(result?.servingTier).toBe('bare_category_default');
        expect(result?.grams).toBe(28);
    });

    it("keeps a piece-sized seed on a bare singular ('banana' 118g — the piece IS the serving)", async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Banana',
            servingGrams: null,
        }));

        const result = await buildOffResult(
            makeCandidate('Banana'), bareParsed('banana'), 0.9, 'banana'
        );

        expect(result?.servingTier).toBe('seed_count_default');
        expect(result?.grams).toBe(118);
    });

    it('explicit counts keep tiny per-piece seeds ("3 almonds" → 3.6g)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Almonds',
            servingGrams: null,
        }));

        const result = await buildOffResult(
            makeCandidate('Almonds'), bareParsed('almonds', 3), 0.9, '3 almonds'
        );

        expect(result?.servingTier).toBe('seed_count_default');
        expect(result?.grams).toBeCloseTo(3.6, 1);
    });
});

describe('dose-anchored categories — own-label/sibling steps must NOT outrank the tsp/scoop default', () => {
    it('n-serv-37: bare "sugar" ignores a cup-measure label and lands on the 4g tsp default', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Granulated White Sugar',
            brandName: 'Domino',
            servingGrams: 104,
            servingDescription: '0.5 cup (104 g)',
        }));
        // Even a plausible sibling median must not answer either.
        mockedQueryRaw.mockResolvedValue([{ med: 104, n: 12 }]);

        const result = await buildOffResult(
            makeCandidate('Granulated White Sugar'), bareParsed('sugar'), 0.9, 'sugar'
        );

        expect(result?.servingTier).toBe('bare_category_default');
        expect(result?.grams).toBe(4);
    });

    it('n-serv-37 variant: label-less sugar record skips the sibling median too', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Granulated White Sugar',
            brandName: 'Domino',
            servingGrams: null,
        }));
        mockedQueryRaw.mockResolvedValue([{ med: 104, n: 12 }]);

        const result = await buildOffResult(
            makeCandidate('Granulated White Sugar'), bareParsed('sugar'), 0.9, 'sugar'
        );

        // count_unresolved_floor → REPLACE via the sugars lexicon entry.
        expect(result?.servingTier).toBe('bare_category_default');
        expect(result?.grams).toBe(4);
    });

    it('n-serv-43: bare "ghost pre workout" skips the 32.5g two-scoop sibling median → 12g scoop default', async () => {
        // Live shape: off_0810028296060 has NULL servingGrams/servingSize;
        // 147 Ghost siblings (protein tubs) median exactly 32.5g — which the
        // eval caught billing as bare_sibling_serving.
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Ghost Legend Pre Workout Cherry Limeade',
            brandName: 'Ghost',
            servingGrams: null,
        }));
        mockedQueryRaw.mockResolvedValue([{ med: 32.5, n: 147 }]);

        const result = await buildOffResult(
            makeCandidate('Ghost Legend Pre Workout Cherry Limeade'),
            bareParsed('ghost pre workout'), 0.9, 'ghost pre workout'
        );

        expect(result?.servingTier).toBe('bare_category_default');
        expect(result?.grams).toBe(12);
    });

    it('dose category with an in-band package tier still resolves through the CAP (ghost 473g tub → 12g)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Ghost Legend Pre Workout',
            brandName: 'Ghost',
            servingGrams: null,
            packageQuantity: 473,
            packageQuantityUnit: 'ml',
        }));

        const result = await buildOffResult(
            makeCandidate('Ghost Legend Pre Workout'),
            bareParsed('ghost pre workout'), 0.9, 'ghost pre workout'
        );

        expect(result?.servingTier).toBe('bare_category_default');
        expect(result?.grams).toBe(12);
    });
});

describe('step (4) — bounded discrete floor, never flat-100g for piece names', () => {
    it('bills one ~50g bar when nothing else resolves (no brand, no label, backfill error)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            // Two-char first token keeps brandForBorrow null → no sibling borrow.
            foodName: 'IQ Protein Bar Birthday Cake',
            brandName: null,
            servingGrams: null,
        }));
        (getOrCreateAmbiguousServing as jest.Mock).mockResolvedValue({ status: 'error', error: 'ai down' });

        const result = await buildOffResult(
            makeCandidate('IQ Protein Bar Birthday Cake'),
            bareParsed('protein bar birthday cake'), 0.9, 'protein bar birthday cake'
        );

        expect(result?.servingTier).toBe('bare_discrete_floor');
        expect(result?.grams).toBe(50);
    });
});
