/**
 * #270 (Lane A S56, 2026-09-23) — "one serving of <snack>" on an OFF SKU with no
 * label serving bills the same-brand median LABEL serving, not the package.
 *
 * The three lines Diego logged on 2026-09-23 (MappingEventLog 11:40–11:44 PDT):
 *   `One serving of flaming hot Cheetos` → off_0028400712439, servingGrams NULL,
 *        packageQuantity 113.4 g            → package_quantity_own    113.4 g / 607 kcal
 *   `one serving of Doritos nachos`      → off_7500478015290, no serving, no package
 *                                          → package_quantity_sibling 142.5 g / 680 kcal
 *   `One serving of Takis`               → off_5018297013158, servingGrams 30
 *                                          → label_serving_package_unit 30 g (the control)
 * The Cheetos brand's in-band label servings have median 28 g over 256 siblings
 * (measured 2026-09-23). The mocks below mirror those shapes; the numbers are the
 * fixture's, not a population claim.
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
        id: 'off_0028400712439',
        source: 'openfoodfacts' as const,
        name,
        score: 1,
        foodType: 'branded',
        rawData: {},
    } as any;
}

function makeHydrated(overrides: Record<string, unknown>) {
    return {
        foodId: 'off_0028400712439',
        foodName: 'Cheetos Flaming Hot',
        brandName: 'Cheetos',
        nutrientsPer100g: { calories: 535, protein: 5, carbs: 55, fat: 33 },
        servingGrams: null,
        servingDescription: null,
        servingUnitCount: 1,
        packageQuantity: 113.4,
        packageQuantityUnit: 'g',
        ...overrides,
    };
}

function parsed(qty: number, unit: string | null, name = 'flaming hot cheetos'): ParsedIngredient {
    return { qty, multiplier: 1, unit, name };
}

const mockedQueryRaw = prisma.$queryRaw as jest.Mock;

/**
 * `$queryRaw` is a tagged template; dispatch on the SQL text so the label-serving
 * borrow and the package borrow are independently controllable (and so a test can
 * prove the package borrow was never issued).
 */
let labelSiblingRows: unknown[] = [];   // borrowSiblingLabelServing  ("servingGrams" BETWEEN)
let packageSiblingRows: unknown[] = []; // borrowSiblingPackageGrams  ("packageQuantity")
let sqlSeen: string[] = [];

beforeEach(() => {
    jest.clearAllMocks();
    labelSiblingRows = [];
    packageSiblingRows = [];
    sqlSeen = [];
    mockedQueryRaw.mockImplementation((strings: TemplateStringsArray) => {
        const sql = Array.isArray(strings) ? strings.join('?') : String(strings);
        sqlSeen.push(sql);
        if (sql.includes('"servingGrams" BETWEEN')) return Promise.resolve(labelSiblingRows);
        if (sql.includes('"packageQuantity"')) return Promise.resolve(packageSiblingRows);
        return Promise.resolve([]);
    });
    (getOrCreateAmbiguousServing as jest.Mock).mockResolvedValue({ status: 'success', grams: 5 });
});

describe('buildOffResult — serving_unit_sibling_label (#270)', () => {
    it('bills the brand median label serving, not the own package, for "1 serving" with no label serving', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({}));
        labelSiblingRows = [{ med: 28, n: 256, p25: 28, p75: 30 }];

        const result = await buildOffResult(
            makeCandidate('Cheetos Flaming Hot'), parsed(1, 'serving'), 0.9, 'One serving of flaming hot Cheetos'
        );

        expect(result?.servingTier).toBe('serving_unit_sibling_label');
        expect(result?.grams).toBe(28);
        // the package borrow is not issued once the label borrow answered
        expect(sqlSeen.some((s) => s.includes('"packageQuantity"'))).toBe(false);
    });

    it('multiplies by the quantity ("2 servings")', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({}));
        labelSiblingRows = [{ med: 28, n: 256, p25: 28, p75: 30 }];

        const result = await buildOffResult(
            makeCandidate('Cheetos Flaming Hot'), parsed(2, 'servings'), 0.9, '2 servings of flaming hot cheetos'
        );

        expect(result?.servingTier).toBe('serving_unit_sibling_label');
        expect(result?.grams).toBe(56);
    });

    it('covers "portion" too', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({}));
        labelSiblingRows = [{ med: 28, n: 256, p25: 28, p75: 30 }];

        const result = await buildOffResult(
            makeCandidate('Cheetos Flaming Hot'), parsed(1, 'portion'), 0.9, 'a portion of flaming hot cheetos'
        );

        expect(result?.servingTier).toBe('serving_unit_sibling_label');
        expect(result?.grams).toBe(28);
    });

    it('keeps today\'s package tier when the brand has fewer than 3 in-band siblings', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({}));
        labelSiblingRows = [{ med: 28, n: 2, p25: 28, p75: 30 }];

        const result = await buildOffResult(
            makeCandidate('Cheetos Flaming Hot'), parsed(1, 'serving'), 0.9, 'One serving of flaming hot Cheetos'
        );

        expect(result?.servingTier).toBe('package_quantity_own');
        expect(result?.grams).toBeCloseTo(113.4, 1);
    });

    it('refuses a brandless record — never the first-token pseudo-brand (design lens, `sweet kale salad`)', async () => {
        // `off_0888048000677` "Sweet kale salad": brandName NULL, no servingGrams, no package.
        // brandForBorrow would be 'Sweet', and "brandName" ILIKE 'Sweet' is a candy line (median 30 g).
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodId: 'off_0888048000677', foodName: 'Sweet kale salad', brandName: null,
            packageQuantity: null, packageQuantityUnit: null,
        }));
        labelSiblingRows = [{ med: 30, n: 3, p25: 27, p75: 31 }];

        const result = await buildOffResult(
            makeCandidate('Sweet kale salad'), parsed(1, 'serving', 'sweet kale salad'), 0.9, '1 serving sweet kale salad'
        );

        expect(result?.servingTier).not.toBe('serving_unit_sibling_label');
        expect(sqlSeen.some((s) => s.includes('"servingGrams" BETWEEN'))).toBe(false);
    });

    it('refuses a brand whose label servings are not near-constant (Knorr p25 10 / p75 240)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodId: 'off_8714100273920', foodName: 'Noodles with chicken', brandName: 'Knorr',
            packageQuantity: 36, packageQuantityUnit: 'g',
        }));
        labelSiblingRows = [{ med: 60, n: 277, p25: 10, p75: 240 }];

        const result = await buildOffResult(
            makeCandidate('Noodles with chicken'), parsed(1.5, 'servings', 'noodles with chicken'), 0.9, '1.5 servings of Noodles with chicken'
        );

        expect(result?.servingTier).toBe('package_quantity_own');
        expect(result?.grams).toBe(54);
    });

    it('never reaches the borrow when the SKU has its own label serving (the Takis control)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodId: 'off_5018297013158', foodName: 'takis', brandName: 'Takis',
            servingGrams: 30, servingDescription: '1 portion (30 g)', packageQuantity: null, packageQuantityUnit: null,
        }));
        labelSiblingRows = [{ med: 28, n: 88, p25: 28, p75: 30 }];

        const result = await buildOffResult(
            makeCandidate('takis'), parsed(1, 'serving', 'takis'), 0.9, 'One serving of Takis'
        );

        expect(result?.servingTier).not.toBe('serving_unit_sibling_label');
        expect(result?.grams).toBe(30);
        expect(sqlSeen.some((s) => s.includes('"servingGrams" BETWEEN'))).toBe(false);
    });

    it('leaves a non-serving package unit ("1 bag") on the package tier', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({}));
        labelSiblingRows = [{ med: 28, n: 256, p25: 28, p75: 30 }];

        const result = await buildOffResult(
            makeCandidate('Cheetos Flaming Hot'), parsed(1, 'bag'), 0.9, '1 bag of flaming hot cheetos'
        );

        expect(result?.servingTier).toBe('package_quantity_own');
        expect(result?.grams).toBeCloseTo(113.4, 1);
    });

    it('leaves a weight unit alone ("100 g")', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({}));
        labelSiblingRows = [{ med: 28, n: 256, p25: 28, p75: 30 }];

        const result = await buildOffResult(
            makeCandidate('Cheetos Flaming Hot'), parsed(100, 'g'), 0.9, '100 g of cheetos'
        );

        expect(result?.servingTier).toBe('weight_unit');
        expect(result?.grams).toBe(100);
    });
});
