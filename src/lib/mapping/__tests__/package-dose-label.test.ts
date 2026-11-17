/**
 * PKT-DOSE (s459 wave 9): a DOSE word ("3 packets of sugar", "1 packet
 * starbucks hot cocoa mix") on an OFF record with no label serving bills a
 * same-form LABEL dose (borrowDoseLabelGrams(): the record's name group, else
 * the brand key's dose-labelled rows sharing its head noun) when the package answer is more than
 * DOSE_PACKAGE_MAX_RATIO x it. A container word, a count, a 0-kcal record and a
 * package within 2x of the dose keep today's answer. Fixtures are measured
 * groups (read-only SQL on the box, 2026-11-16, s459 pd-pkt `sql/m2_alts.sql`,
 * `sql/m4_labels.sql`, `sql/m5_doselabel.sql`).
 */
import { buildOffResult } from '../map-ingredient-with-fallback';
import { doseOverPackage, doseHeadNoun, DOSE_PACKAGE_MAX_RATIO } from '../serving/hydration-lane';
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
/** Which dose arms ran, in order, with the band values each bound. */
const doseScans: Array<{ arm: 'name' | 'brand'; values: unknown[] }> = [];

/** Answer the package vote (unbanded / banded), the dose name arm and the dose brand arm; everything else []. */
function dispatch(opts: { vote?: Rows; voteBanded?: Rows; name?: Rows; brand?: Rows }) {
    mockedQueryRaw.mockImplementation((strings: TemplateStringsArray, ...values: unknown[]) => {
        const sql = Array.isArray(strings) ? strings.join('?') : String(strings);
        if (sql.includes('"packageQuantity"')) {
            const banded = sql.includes('IS NULL OR') && !values.slice(-3).includes(null);
            return Promise.resolve(banded ? (opts.voteBanded ?? []) : (opts.vote ?? []));
        }
        if (sql.includes('"servingSize" ~*')) {
            doseScans.push({ arm: 'brand', values });
            return Promise.resolve(opts.brand ?? []);
        }
        if (sql.includes('lower(name) = lower(') && !sql.includes('percentile_cont(0.25)')) {
            doseScans.push({ arm: 'name', values });
            return Promise.resolve(opts.name ?? []);
        }
        return Promise.resolve([]);
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    doseScans.length = 0;
    dispatch({});
    (getOrCreateAmbiguousServing as jest.Mock).mockResolvedValue({ status: 'error', error: 'not mocked' });
});

const SUGAR = makeHydrated({
    foodName: 'Granulated sugar', brandName: 'Everyday',
    nutrientsPer100g: { calories: 399, protein: 0, carbs: 100, fat: 0 },
    packageQuantity: 1000, packageQuantityUnit: 'g', // out of PACKAGE_BAND: no own package
});
// Everyday: g n=5 med 155 kmed 168 · ml n=1 (ratio 2.4, no #700 band). Name group `granulated sugar`, same-form: n=29 med 4.
const SUGAR_VOTE = [{ unit: 'g', med: 155, n: 5, kmed: 168 }, { unit: 'ml', med: 500, n: 1, kmed: 744 }];

const COCOA = makeHydrated({
    foodName: 'Starbucks Hot Cocoa Mix', brandName: 'Starbucks',
    nutrientsPer100g: { calories: 428.6, protein: 7, carbs: 75, fat: 11 },
    packageQuantity: 283.5, packageQuantityUnit: 'g', // out of band
});
const COCOA_VOTE = [{ unit: 'ml', med: 473.176, n: 369, kmed: 4.5 }, { unit: 'g', med: 120, n: 203, kmed: 302 }];
const COCOA_BANDED = [{ unit: 'g', med: 102, n: 115, kmed: 385 }, { unit: 'ml', med: 828, n: 9, kmed: 266.7 }];

describe('a dose word bills a label dose, not a retail package', () => {
    it('`3 packets of sugar` bills 3 x the name group\'s 4 g label, not 3 x the store brand\'s 155 g vote', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(SUGAR);
        dispatch({ vote: SUGAR_VOTE, name: [{ med: 4, n: 29 }], brand: [{ med: 30, n: 9 }] });
        const parsed: ParsedIngredient = { qty: 3, multiplier: 1, unit: 'packets', name: 'sugar' };
        const r = await buildOffResult(makeCandidate('Granulated sugar'), parsed, 0.9, '3 packets of sugar');
        expect(r?.servingTier).toBe('package_dose_label');
        expect(r?.grams).toBe(12);
        // The name arm answers first; the brand arm is never asked.
        expect(doseScans.map((s) => s.arm)).toEqual(['name']);
    });

    it('the dose is SAME-FORM: both arms bind self\'s [0.5x, 2x] kcal band', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(SUGAR);
        dispatch({ vote: SUGAR_VOTE });
        const parsed: ParsedIngredient = { qty: 1, multiplier: 1, unit: 'packet', name: 'sugar' };
        await buildOffResult(makeCandidate('Granulated sugar'), parsed, 0.9, '1 packet of sugar');
        expect(doseScans.map((s) => s.arm)).toEqual(['name', 'brand']);
        for (const s of doseScans) expect(s.values.slice(-2)).toEqual([199.5, 798]);
    });

    it('`1 packet starbucks hot cocoa mix`: no name group, so the brand\'s 42 same-form envelopes/sachets (28 g)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(COCOA);
        dispatch({ vote: COCOA_VOTE, voteBanded: COCOA_BANDED, brand: [{ med: 28, n: 42 }] });
        const parsed: ParsedIngredient = { qty: 1, multiplier: 1, unit: 'packet', name: 'starbucks hot cocoa mix' };
        const r = await buildOffResult(makeCandidate('Starbucks Hot Cocoa Mix'), parsed, 0.9, '1 packet starbucks hot cocoa mix');
        expect(r?.servingTier).toBe('package_dose_label');
        expect(r?.grams).toBe(28);
        expect(doseScans.map((s) => s.arm)).toEqual(['name', 'brand']);
        // The brand arm is restricted to the brand's `mix` rows (its head noun), not VIA lattes or refreshers.
        expect(doseScans[1].values).toContain('%mix%');
    });

    it('a name with no head word of >= 3 letters never asks the brand arm', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue({ ...COCOA, foodName: 'XO 12' });
        dispatch({ vote: COCOA_VOTE, voteBanded: COCOA_BANDED, brand: [{ med: 28, n: 42 }] });
        const parsed: ParsedIngredient = { qty: 1, multiplier: 1, unit: 'packet', name: 'xo 12' };
        const r = await buildOffResult(makeCandidate('XO 12'), parsed, 0.9, '1 packet xo 12');
        expect(r?.servingTier).toBe('package_quantity_sibling');
        expect(doseScans.map((s) => s.arm)).toEqual(['name']);
    });

    it('an arm under 3 rows is no answer: name n=2 falls to the brand arm', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(COCOA);
        dispatch({ vote: COCOA_VOTE, voteBanded: COCOA_BANDED, name: [{ med: 10, n: 2 }], brand: [{ med: 28, n: 42 }] });
        const parsed: ParsedIngredient = { qty: 1, multiplier: 1, unit: 'packet', name: 'starbucks hot cocoa mix' };
        const r = await buildOffResult(makeCandidate('Starbucks Hot Cocoa Mix'), parsed, 0.9, '1 packet starbucks hot cocoa mix');
        expect(r?.grams).toBe(28);
    });

    it('caps an OWN in-band MILLILITRE package (a bottle): `1 packet of light mayo` own 500 ml, name group 15 g', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Light mayo', brandName: 'Morrisons',
            nutrientsPer100g: { calories: 267, protein: 1, carbs: 8, fat: 26 },
            packageQuantity: 500, packageQuantityUnit: 'ml',
        }));
        dispatch({ name: [{ med: 15, n: 15 }] });
        const parsed: ParsedIngredient = { qty: 1, multiplier: 1, unit: 'packet', name: 'light mayo' };
        const r = await buildOffResult(makeCandidate('Light mayo'), parsed, 0.9, '1 packet of light mayo');
        expect(r?.servingTier).toBe('package_dose_label');
        expect(r?.grams).toBe(15);
    });

    it('an OWN in-band GRAM package is this product\'s real pack and stands (`a packet of fruit snacks` keeps its 198.4 g box)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Fruit snacks', brandName: null,
            nutrientsPer100g: { calories: 353.5, protein: 0, carbs: 85, fat: 0 },
            packageQuantity: 198.446661875, packageQuantityUnit: 'g',
        }));
        dispatch({ name: [{ med: 23, n: 64 }] });
        const parsed: ParsedIngredient = { qty: 1, multiplier: 1, unit: 'packet', name: 'fruit snacks' };
        const r = await buildOffResult(makeCandidate('Fruit snacks'), parsed, 0.9, 'a packet of fruit snacks');
        expect(r?.servingTier).toBe('package_quantity_own');
        expect(r?.grams).toBeCloseTo(198.4, 1);
        expect(doseScans).toEqual([]);
    });
});

describe('the package answer stands when it is already dose-sized, or the line is not a dose', () => {
    it('Swiss Miss: a 39.1 g envelope vote is within 2x of the 29 g label median, so it stays', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Swiss miss marshmallow hot cocoa', brandName: 'Swiss Miss',
            nutrientsPer100g: { calories: 411.8, protein: 5, carbs: 75, fat: 8 },
        }));
        dispatch({ vote: [{ unit: 'g', med: 39.1, n: 3, kmed: 424 }], brand: [{ med: 29, n: 19 }] });
        const parsed: ParsedIngredient = { qty: 2, multiplier: 1, unit: 'packets', name: 'swiss miss hot cocoa' };
        const r = await buildOffResult(makeCandidate('Swiss miss marshmallow hot cocoa'), parsed, 0.9, '2 packets of swiss miss hot cocoa');
        expect(r?.servingTier).toBe('package_quantity_sibling');
        expect(r?.grams).toBeCloseTo(78.2, 1);
    });

    it('a CONTAINER word never asks for a dose (`a can of sugar` keeps the vote)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(SUGAR);
        dispatch({ vote: SUGAR_VOTE, name: [{ med: 4, n: 29 }] });
        const parsed: ParsedIngredient = { qty: 1, multiplier: 1, unit: 'can', name: 'sugar' };
        const r = await buildOffResult(makeCandidate('Granulated sugar'), parsed, 0.9, 'a can of sugar');
        expect(r?.servingTier).toBe('package_quantity_sibling');
        expect(r?.grams).toBe(155);
        expect(doseScans).toEqual([]);
    });

    it('a unitless COUNT is not this rung (`2 starbucks hot cocoa mix` keeps rung (D))', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(COCOA);
        dispatch({ vote: COCOA_VOTE, voteBanded: COCOA_BANDED, brand: [{ med: 28, n: 42 }] });
        const parsed: ParsedIngredient = { qty: 2, multiplier: 1, unit: null, name: 'starbucks hot cocoa mix' };
        const r = await buildOffResult(makeCandidate('Starbucks Hot Cocoa Mix'), parsed, 0.9, '2 starbucks hot cocoa mix');
        expect(r?.servingTier).toBe('package_count_sibling');
        expect(r?.grams).toBe(204);
        expect(doseScans).toEqual([]);
    });

    it('a 0-kcal record has no density band, so no dose scan (a sweetener keeps its package answer)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Sweetener', brandName: 'Generic',
            nutrientsPer100g: { calories: 0, protein: 0, carbs: 0, fat: 0 },
        }));
        dispatch({ vote: [{ unit: 'g', med: 80, n: 4, kmed: 0 }], name: [{ med: 1, n: 50 }] });
        const parsed: ParsedIngredient = { qty: 1, multiplier: 1, unit: 'packet', name: 'sweetener' };
        const r = await buildOffResult(makeCandidate('Sweetener'), parsed, 0.9, '1 packet sweetener');
        expect(r?.servingTier).toBe('package_quantity_sibling');
        expect(doseScans).toEqual([]);
    });
});

describe('r1 pins (s459 rf-pkt): lower-only, the bag word, the serving word, the kill switch', () => {
    const FRUIT = makeHydrated({
        foodName: 'Fruit snacks', brandName: null,
        nutrientsPer100g: { calories: 353.5, protein: 0, carbs: 85, fat: 0 },
        packageQuantity: 198.446661875, packageQuantityUnit: 'g',
    });

    it('a dose LARGER than the package is never taken: the rung only lowers', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated({
            foodName: 'Olives', brandName: 'Generic',
            nutrientsPer100g: { calories: 149, protein: 1, carbs: 4, fat: 15 },
        }));
        // The brand vote answers 30 g; the name group's label is 45 g. The dose is asked for and refused.
        dispatch({ vote: [{ unit: 'g', med: 30, n: 5, kmed: 150 }], name: [{ med: 45, n: 10 }] });
        const parsed: ParsedIngredient = { qty: 1, multiplier: 1, unit: 'packet', name: 'olives' };
        const r = await buildOffResult(makeCandidate('Olives'), parsed, 0.9, '1 packet of olives');
        expect(doseScans.map((s) => s.arm)).toEqual(['name']);
        expect(r?.servingTier).toBe('package_quantity_sibling');
        expect(r?.grams).toBe(30);
    });

    it('a SERVING word on an own GRAM package still bills the label serving (`1 serving of fruit snacks`: 23 g, not the 198.4 g box)', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(FRUIT);
        dispatch({ name: [{ med: 23, n: 64 }] });
        const parsed: ParsedIngredient = { qty: 1, multiplier: 1, unit: 'serving', name: 'fruit snacks' };
        const r = await buildOffResult(makeCandidate('Fruit snacks'), parsed, 0.9, '1 serving of fruit snacks');
        expect(r?.servingTier).toBe('package_dose_label');
        expect(r?.grams).toBe(23);
    });

    it('`1 bag of fruit snacks` is a container word: it keeps the own package and never asks for a dose', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(FRUIT);
        dispatch({ name: [{ med: 23, n: 64 }] });
        const parsed: ParsedIngredient = { qty: 1, multiplier: 1, unit: 'bag', name: 'fruit snacks' };
        const r = await buildOffResult(makeCandidate('Fruit snacks'), parsed, 0.9, '1 bag of fruit snacks');
        expect(r?.servingTier).toBe('package_quantity_own');
        expect(r?.grams).toBeCloseTo(198.4, 1);
        expect(doseScans).toEqual([]);
    });

    it('a SERVING word on a brandless record (no #270 brand borrow) bills the label dose', async () => {
        (hydrateOffCandidate as jest.Mock).mockResolvedValue({ ...FRUIT, foodName: 'Kettle fruit snacks', packageQuantity: null, packageQuantityUnit: null });
        dispatch({ vote: [{ unit: 'g', med: 142, n: 12, kmed: 360 }], name: [{ med: 23, n: 64 }] });
        const parsed: ParsedIngredient = { qty: 2, multiplier: 1, unit: 'serving', name: 'fruit snacks' };
        const r = await buildOffResult(makeCandidate('Kettle fruit snacks'), parsed, 0.9, '2 servings of fruit snacks');
        expect(r?.servingTier).toBe('package_dose_label');
        expect(r?.grams).toBe(46);
    });

    it('SERVING_PACKAGE_DOSE="0" restores the package answer and runs no dose scan', async () => {
        const prev = process.env.SERVING_PACKAGE_DOSE;
        process.env.SERVING_PACKAGE_DOSE = '0';
        try {
            (hydrateOffCandidate as jest.Mock).mockResolvedValue(SUGAR);
            dispatch({ vote: SUGAR_VOTE, name: [{ med: 4, n: 29 }] });
            const parsed: ParsedIngredient = { qty: 3, multiplier: 1, unit: 'packets', name: 'sugar' };
            const r = await buildOffResult(makeCandidate('Granulated sugar'), parsed, 0.9, '3 packets of sugar');
            expect(r?.servingTier).toBe('package_quantity_sibling');
            expect(r?.grams).toBe(465);
            expect(doseScans).toEqual([]);
        } finally {
            if (prev === undefined) delete process.env.SERVING_PACKAGE_DOSE;
            else process.env.SERVING_PACKAGE_DOSE = prev;
        }
    });
});

describe('doseHeadNoun()', () => {
    it('is the last word of >= 3 letters, lower-cased', () => {
        expect(doseHeadNoun('Starbucks Hot Cocoa Mix')).toBe('mix');
        expect(doseHeadNoun('Quaker oatmeal')).toBe('oatmeal');
        expect(doseHeadNoun("organic Annie's Mac and cheese")).toBe('cheese');
        expect(doseHeadNoun('Cafe au lait 2')).toBe('lait');
        expect(doseHeadNoun('XO 12')).toBeNull();
        expect(doseHeadNoun(null)).toBeNull();
    });
});

describe('doseOverPackage()', () => {
    it('fires only when the package is MORE than DOSE_PACKAGE_MAX_RATIO x the dose', () => {
        expect(DOSE_PACKAGE_MAX_RATIO).toBe(2);
        expect(doseOverPackage(155, 4)).toBe(true);
        expect(doseOverPackage(56, 28)).toBe(false);
        expect(doseOverPackage(56.1, 28)).toBe(true);
        expect(doseOverPackage(39.1, 29)).toBe(false);
        expect(doseOverPackage(31.75, 21)).toBe(false);
    });
    it('no dose, a non-positive dose or a non-finite package is never a fire', () => {
        expect(doseOverPackage(155, null)).toBe(false);
        expect(doseOverPackage(155, 0)).toBe(false);
        expect(doseOverPackage(null, 4)).toBe(false);
        expect(doseOverPackage(Number.POSITIVE_INFINITY, 4)).toBe(false);
    });
});
