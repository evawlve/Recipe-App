/**
 * s456 CXL-1 — label_piece_estimate: a counted line (qty >= 2) on an OFF record whose
 * label serving holds >= 3 estimated 'piece' units bills qty x label / n instead of
 * qty x the whole serving. n = round(label / P), P < 200, lower-only.
 */

import { buildOffResult } from '../map-ingredient-with-fallback';
import { hydrateOffCandidate } from '../../openfoodfacts/hydrate';
import { getOrCreateAmbiguousServing } from '../ambiguous-unit-backfill';
import { parseOffServingSize } from '../../openfoodfacts/serving-resolver';
import { parseIngredientLine } from '../../parse/ingredient-line';

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

function makeCandidate(id: string, name: string) {
    return {
        id,
        source: 'openfoodfacts' as const,
        name,
        score: 1,
        foodType: 'generic',
        rawData: {},
    } as any;
}

function makeHydrated(id: string, foodName: string, servingSize: string, servingGrams: number) {
    const label = parseOffServingSize(servingSize, servingGrams);
    return {
        foodId: id,
        foodName,
        brandName: null,
        nutrientsPer100g: { calories: 400, protein: 10, carbs: 50, fat: 15 },
        servingGrams: label.grams,
        servingDescription: label.description,
        servingUnitCount: label.unitCount,
        packageQuantity: null,
        packageQuantityUnit: null,
    };
}

async function run(rawLine: string, foodName: string, servingSize: string, servingGrams: number, id = 'off_0038000438615') {
    (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated(id, foodName, servingSize, servingGrams));
    const parsed = parseIngredientLine(rawLine);
    return buildOffResult(makeCandidate(id, foodName), parsed, 0.9, rawLine);
}


const PID = 'off_9300682065191';
type Row = [string, string, string, number, number];

async function runP(line: string, name: string, size: string, grams: number, p: number | { status: string }) {
    (getOrCreateAmbiguousServing as jest.Mock).mockResolvedValue(
        typeof p === 'number' ? { status: 'success', grams: p } : p,
    );
    return run(line, name, size, grams, PID);
}

beforeEach(() => {
    jest.clearAllMocks();
    (getOrCreateAmbiguousServing as jest.Mock).mockResolvedValue({ status: 'success', grams: 50 });
});

describe('label_piece_estimate — FIRES', () => {
    it('20 skittles on "1 portion (30 g)", P 2 -> 40 g', async () => {
        const r = await runP('20 skittles', 'skittles', '1 portion (30 g)', 30, 2);
        expect(r?.servingTier).toBe('label_piece_estimate');
        expect(r?.grams).toBeCloseTo(40, 1);
        expect(getOrCreateAmbiguousServing).toHaveBeenCalledWith(PID, 'skittles', 'piece', expect.anything());
    });
    const fires: Array<[string, string, string, number, number, number]> = [
        ['5 tic tacs', 'TIC TAC', '98.0g', 98, 1.5, 7.54],
        ['4 triscuits', 'Triscuit', '28.0g', 28, 4.67, 18.67],
        ['2 widgets', 'Widgets', '26 g', 26, 10, 17.33],
        ['2.5 widgets', 'Widgets', '30 g', 30, 5, 12.5],
    ];
    it.each(fires)('%s on "%s" %s', async (line, name, size, g, p, want) => {
        const r = await runP(line, name, size, g, p);
        expect(r?.servingTier).toBe('label_piece_estimate');
        expect(r?.grams).toBeCloseTo(want, 1);
    });
});

describe('label_piece_estimate — HOLDS (label_serving_default)', () => {
    const holds: Array<[string, string, string, number, number, number]> = [
        ['2 widgets', 'Widgets', '24 g', 24, 10, 48],
        ['2 widgets', 'Widgets', '32 g', 32, 20, 64],
        ['3 trader joes joe joes', "Joe-joe's", '25 g', 25, 12.5, 75],
        ['2 ball park franks', 'Franks', '53 g', 53, 45, 106],
        ['2 rxbar chocolate sea salt', 'Chocolate Sea Salt RXBAR', '52g', 52, 60, 104],
        ['2 turkey burgers no bun', 'Turkey Burgers', '151 g', 151, 75, 302],
        ['3 tamales', 'Tamales', '1 TAMAL, ABOUT (113 g)', 113, 113, 339],
    ];
    it.each(holds)('%s on "%s" %s, P %s', async (line, name, size, g, p, want) => {
        const r = await runP(line, name, size, g, p);
        expect(r?.servingTier).toBe('label_serving_default');
        expect(r?.grams).toBeCloseTo(want, 0);
    });
    it('2 celsius on "1 can (355 ml)", P 200 -> not lpe (P < 200 guard)', async () => {
        const r = await runP('2 celsius', 'Celsius', '1 can (355 ml)', 355, 200);
        expect(r?.servingTier).not.toBe('label_piece_estimate');
    });
    it('2 monster energy on "24 fl oz (710 ml)", P 200 -> not lpe', async () => {
        const r = await runP('2 monster energy', 'Monster Energy', '24 fl oz (710 ml)', 710, 200);
        expect(r?.servingTier).not.toBe('label_piece_estimate');
    });
    it('estimator error -> 600 g label_serving_default', async () => {
        const r = await runP('20 skittles', 'skittles', '1 portion (30 g)', 30, { status: 'error' });
        expect(r?.servingTier).toBe('label_serving_default');
        expect(r?.grams).toBeCloseTo(600, 0);
    });
});

describe('label_piece_estimate — CONTROLS (estimator not called)', () => {
    it('12 buffalo wings on "3 ONZ (84 g)" -> 408 seed_count_default', async () => {
        const r = await runP('12 buffalo wings', 'Buffalo wings', '3 ONZ (84 g)', 84, 20);
        expect(r?.servingTier).toBe('seed_count_default');
        expect(r?.grams).toBeCloseTo(408, 0);
        expect(getOrCreateAmbiguousServing).not.toHaveBeenCalled();
    });
    it('bare "skittles" -> not lpe', async () => {
        const r = await runP('skittles', 'skittles', '1 portion (30 g)', 30, 2);
        expect(r?.servingTier).not.toBe('label_piece_estimate');
    });
    it('"1 tic tac" -> not lpe', async () => {
        const r = await runP('1 tic tac', 'TIC TAC', '98.0g', 98, 1.5);
        expect(r?.servingTier).not.toBe('label_piece_estimate');
    });
});
