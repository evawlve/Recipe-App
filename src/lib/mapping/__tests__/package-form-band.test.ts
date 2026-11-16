/**
 * PKG-FORM (s459): the package-size vote in borrowSiblingPackageGrams() must
 * not bill a dense record (a drink-mix powder, a cocoa mix) at a lighter
 * FORM's package size. It reuses siblingFormBand() (SIB-FORM, #697): when the
 * winning unit class is under a third of the record's density, the vote re-runs
 * over same-density siblings and that winner is taken at n >= 2 and only when
 * LOWER. Fixtures are the measured brand groups (read-only SQL on the box,
 * 2026-11-15, s459 pd-pkg `sql/p10_fixtures.sql`).
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
jest.mock('../../openfoodfacts/hydrate', () => ({ hydrateOffCandidate: jest.fn() }));
jest.mock('../ambiguous-unit-backfill', () => {
    const actual = jest.requireActual('../ambiguous-unit-backfill');
    return { ...actual, getOrCreateAmbiguousServing: jest.fn() };
});

const mockedQueryRaw = prisma.$queryRaw as jest.Mock;

function makeCandidate(name: string) {
    return { id: 'off_100', source: 'openfoodfacts' as const, name, score: 1, foodType: 'generic', rawData: {} } as any;
}
function makeHydrated(overrides: Record<string, unknown>) {
    return {
        foodId: 'off_100', foodName: 'Food', brandName: null,
        nutrientsPer100g: { calories: 400, protein: 10, carbs: 50, fat: 15 },
        servingGrams: null, servingDescription: null, servingUnitCount: 1,
        packageQuantity: null, packageQuantityUnit: null,
        ...overrides,
    };
}

type Rows = unknown[];
const issued: boolean[] = [];

/** Answer only the package vote; the band binds three numbers when it applies, NULLs when it does not. */
function dispatch(pkg: Rows, pkgBanded: Rows = []) {
    mockedQueryRaw.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = Array.isArray(strings) ? strings.join('?') : String(strings);
        if (!sql.includes('"packageQuantity"')) return Promise.resolve([]);
        const banded = sql.includes('IS NULL OR') && !values.slice(-3).includes(null);
        issued.push(banded);
        return Promise.resolve(banded ? pkgBanded : pkg);
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    issued.length = 0;
    dispatch([]);
    (getOrCreateAmbiguousServing as jest.Mock).mockResolvedValue({ status: 'error', error: 'not mocked' });
});

const KOOL_AID = makeHydrated({
    foodName: 'Kool aid tropical punch drink mix', brandName: 'Kool-Aid',
    nutrientsPer100g: { calories: 384.6, protein: 0, carbs: 96, fat: 0 },
});
// Kool-Aid: ml n=17 med 236.588 kmed 13 · g n=3 med 22 kmed 395; banded [192.3, 769.2]: g n=2 med 31.75, ml n=1.
const KOOL_AID_VOTE = [{ unit: 'ml', med: 236.588, n: 17, kmed: 13 }, { unit: 'g', med: 22, n: 3, kmed: 395 }];
const KOOL_AID_BANDED = [{ unit: 'g', med: 31.75, n: 2, kmed: 388 }, { unit: 'ml', med: 236.588, n: 1, kmed: 353 }];

describe('whole-package count (D) — package_count_sibling', () => {
    it('`2 kool aid tropical punch drink mix` bills two mix packets, not two 236.6 ml bottles of powder', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(KOOL_AID);
        dispatch(KOOL_AID_VOTE, KOOL_AID_BANDED);
        const parsed: ParsedIngredient = { qty: 2, multiplier: 1, unit: null, name: 'kool aid tropical punch drink mix' };
        const r = await buildOffResult(makeCandidate('Kool aid tropical punch drink mix'), parsed, 0.9, '2 kool aid tropical punch drink mix');
        expect(r?.servingTier).toBe('package_count_sibling');
        expect(r?.grams).toBeCloseTo(63.5, 1);
        expect(issued).toEqual([false, true]);
    });

    it('`2 starbucks hot cocoa mix` takes the same-density g vote (102 g), not the 473 ml cup median', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Starbucks Hot Cocoa Mix', brandName: 'Starbucks',
            nutrientsPer100g: { calories: 428.6, protein: 7, carbs: 75, fat: 11 },
        }));
        // Starbucks: ml n=369 med 473.176 kmed 4.5 · g n=203 med 120; banded [214.3, 857.2]: g n=115 med 102, ml n=9.
        dispatch(
            [{ unit: 'ml', med: 473.176, n: 369, kmed: 4.5 }, { unit: 'g', med: 120, n: 203, kmed: 302 }],
            [{ unit: 'g', med: 102, n: 115, kmed: 385 }, { unit: 'ml', med: 828, n: 9, kmed: 266.7 }],
        );
        const parsed: ParsedIngredient = { qty: 2, multiplier: 1, unit: null, name: 'starbucks hot cocoa mix' };
        const r = await buildOffResult(makeCandidate('Starbucks Hot Cocoa Mix'), parsed, 0.9, '2 starbucks hot cocoa mix');
        expect(r?.servingTier).toBe('package_count_sibling');
        expect(r?.grams).toBe(204);
    });

    it('never raises: a same-density vote above today\'s is ignored (Bertolli single-serve oil 101 g, not 750 g)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Olive oil extra virgin single serve', brandName: 'Bertolli',
            nutrientsPer100g: { calories: 800, protein: 0, carbs: 0, fat: 90 },
        }));
        // Bertolli: g n=16 med 101 kmed 82.3 · ml n=13 med 500; banded [400, 1600]: ml n=9 med 750.
        dispatch(
            [{ unit: 'g', med: 101, n: 16, kmed: 82.3 }, { unit: 'ml', med: 500, n: 13, kmed: 800 }],
            [{ unit: 'ml', med: 750, n: 9, kmed: 800 }],
        );
        const parsed: ParsedIngredient = { qty: 2, multiplier: 1, unit: null, name: 'bertolli single serve olive oil' };
        const r = await buildOffResult(makeCandidate('Olive oil extra virgin single serve'), parsed, 0.9, '2 bertolli single serve olive oil');
        expect(r?.servingTier).toBe('package_count_sibling');
        expect(r?.grams).toBe(202);
        expect(issued).toEqual([false, true]);
    });

    it('keeps today\'s vote when under 2 same-density siblings exist, never refuses (Leon waffle fries: g n=3 med 250; banded n=1 med 240)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Leon waffle fries', brandName: null,
            nutrientsPer100g: { calories: 268, protein: 3, carbs: 30, fat: 15 },
        }));
        // Brandless: the vote keys on the first name token `Leon`. g n=3 med 250 kmed 82; banded [134, 536]: g n=1 med 240.
        dispatch([{ unit: 'g', med: 250, n: 3, kmed: 82 }], [{ unit: 'g', med: 240, n: 1, kmed: 268 }]);
        const parsed: ParsedIngredient = { qty: 2, multiplier: 1, unit: null, name: 'leon waffle fries' };
        const r = await buildOffResult(makeCandidate('Leon waffle fries'), parsed, 0.9, '2 leon waffle fries');
        expect(r?.servingTier).toBe('package_count_sibling');
        expect(r?.grams).toBe(500);
        expect(issued).toEqual([false, true]);
    });

    it('a record as light as its brand votes exactly as before, one scan (Premier Protein shake, 51 kcal)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Premier Protein Shake', brandName: 'Premier Protein',
            nutrientsPer100g: { calories: 51, protein: 9, carbs: 1, fat: 1 },
        }));
        dispatch([{ unit: 'ml', med: 325.3085, n: 23, kmed: 49.2 }, { unit: 'g', med: 39, n: 5, kmed: 353.8 }]);
        const parsed: ParsedIngredient = { qty: 2, multiplier: 1, unit: null, name: 'premier protein shake' };
        const r = await buildOffResult(makeCandidate('Premier Protein Shake'), parsed, 0.9, '2 premier protein shake');
        expect(r?.servingTier).toBe('package_count_sibling');
        expect(r?.grams).toBeCloseTo(650.6, 1);
        expect(issued).toEqual([false]);
    });

    it('below the dense-self threshold there is no band (a 237 kcal record vs a 3 kcal can line)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Celsius', brandName: 'Celsius',
            nutrientsPer100g: { calories: 237, protein: 0, carbs: 60, fat: 0 },
        }));
        dispatch([{ unit: 'ml', med: 354.9, n: 5, kmed: 3 }], [{ unit: 'g', med: 20, n: 4, kmed: 237 }]);
        const parsed: ParsedIngredient = { qty: 2, multiplier: 1, unit: null, name: 'celsius' };
        const r = await buildOffResult(makeCandidate('Celsius'), parsed, 0.9, '2 celsius');
        expect(r?.grams).toBeCloseTo(709.8, 1);
        expect(issued).toEqual([false]);
    });
});

describe('package-like unit — package_quantity_sibling', () => {
    it('`1 packet kool aid cherry drink mix` bills one mix packet, not a 236.6 ml bottle of powder', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue({ ...KOOL_AID, foodName: 'Kool aid cherry drink mix' });
        dispatch(KOOL_AID_VOTE, KOOL_AID_BANDED);
        const parsed: ParsedIngredient = { qty: 1, multiplier: 1, unit: 'packet', name: 'kool aid cherry drink mix' };
        const r = await buildOffResult(makeCandidate('Kool aid cherry drink mix'), parsed, 0.9, '1 packet kool aid cherry drink mix');
        expect(r?.servingTier).toBe('package_quantity_sibling');
        expect(r?.grams).toBeCloseTo(31.75, 2);
        expect(issued).toEqual([false, true]);
    });

    it('`1 sachet kool aid cherry drink mix` is a dose word too: one mix packet', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue({ ...KOOL_AID, foodName: 'Kool aid cherry drink mix' });
        dispatch(KOOL_AID_VOTE, KOOL_AID_BANDED);
        const parsed: ParsedIngredient = { qty: 1, multiplier: 1, unit: 'sachet', name: 'kool aid cherry drink mix' };
        const r = await buildOffResult(makeCandidate('Kool aid cherry drink mix'), parsed, 0.9, '1 sachet kool aid cherry drink mix');
        expect(r?.servingTier).toBe('package_quantity_sibling');
        expect(r?.grams).toBeCloseTo(31.75, 2);
        expect(issued).toEqual([false, true]);
    });

    it('a CONTAINER word keeps today\'s vote, unbanded (`1 package of` names the retail pack, not a dose)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue({ ...KOOL_AID, foodName: 'Kool aid cherry drink mix' });
        dispatch(KOOL_AID_VOTE, KOOL_AID_BANDED);
        const parsed: ParsedIngredient = { qty: 1, multiplier: 1, unit: 'package', name: 'kool aid cherry drink mix' };
        const r = await buildOffResult(makeCandidate('Kool aid cherry drink mix'), parsed, 0.9, '1 package of kool aid cherry drink mix');
        expect(r?.servingTier).toBe('package_quantity_sibling');
        expect(r?.grams).toBeCloseTo(236.588, 2);
        expect(issued).toEqual([false]);
    });
});
