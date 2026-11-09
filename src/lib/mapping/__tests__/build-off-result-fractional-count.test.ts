/**
 * s453 (2026-11-08) — a unitless FRACTIONAL count (`2 and a half cookies`,
 * `2.5 cookies`, `2 1/2 cookies`, `2½ cookies`, `1 and a half bananas`) bills
 * qty x the per-piece weight its integer twin bills, instead of falling past
 * the whole unitless-count branch of buildOffResult() to flat_100g_default
 * (qty x 100 g: `2 and a half cookies` billed 250 g / 1,085 kcal live while
 * `2 cookies` on the SAME record billed 60 g, seed_count_default).
 *
 * The parser was never the stage: parseIngredientLine() returns qty 2.5, unit
 * null, name `cookies` for all four spellings — identical to `2 cookies` but
 * for qty. The branch gate read Number.isInteger(parsed.qty).
 *
 * Fixtures: every `parsed` comes from parseIngredientLine(rawLine); every label
 * from parseOffServingSize(). The cookies record mirrors off_7613287819895 (no
 * label serving, no brand), the winner of the live member draw.
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

const ID = 'off_7613287819895';

function makeHydrated(foodName: string, servingSize: string | null, servingGrams: number | null) {
    const label = servingSize
        ? parseOffServingSize(servingSize, servingGrams)
        : { grams: null, description: null, unitCount: null };
    return {
        foodId: ID,
        foodName,
        brandName: null,
        nutrientsPer100g: { calories: 434, protein: 5.7, carbs: 75.4, fat: 11.3 },
        servingGrams: label.grams,
        servingDescription: label.description,
        servingUnitCount: label.unitCount,
        packageQuantity: null,
        packageQuantityUnit: null,
    };
}

async function run(rawLine: string, foodName: string, servingSize: string | null = null, servingGrams: number | null = null) {
    (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated(foodName, servingSize, servingGrams));
    const parsed = parseIngredientLine(rawLine);
    const candidate = { id: ID, source: 'openfoodfacts' as const, name: foodName, score: 1, foodType: 'generic', rawData: {} } as any;
    return buildOffResult(candidate, parsed, 0.9, rawLine);
}

beforeEach(() => {
    jest.clearAllMocks();
    // A count unit (`slice`, `egg`) resolves its per-unit weight here; the
    // unitless lines below never call it unless the discrete-unit backfill runs.
    (getOrCreateAmbiguousServing as jest.Mock).mockImplementation(async (_id: string, _name: string, unit: string) => {
        const perUnit: Record<string, number> = { slice: 107, egg: 50 };
        return perUnit[unit] != null
            ? { status: 'cached', grams: perUnit[unit] }
            : { status: 'error', error: 'not mocked' };
    });
});

describe('parser is not the stage (parseIngredientLine)', () => {
    it.each(['2 and a half cookies', '2.5 cookies', '2 1/2 cookies', '2½ cookies'])(
        '%s -> qty 2.5, no unit, name `cookies`',
        (line) => {
            const p = parseIngredientLine(line);
            expect(p?.qty).toBe(2.5);
            expect(p?.unit ?? null).toBeNull();
            expect(p?.name).toBe('cookies');
        },
    );
});

describe('MEMBER + SIBLINGS — a fractional unitless count takes the count path', () => {
    it.each([
        ['2 and a half cookies'],
        ['2.5 cookies'],
        ['2 1/2 cookies'],
        ['2½ cookies'],
    ])('%s on a label-less Cookies record -> 75 g seed_count_default (2.5 x 30 g)', async (line) => {
        const r = await run(line, 'Cookies');
        expect(r?.servingTier).toBe('seed_count_default');
        expect(r?.grams).toBeCloseTo(75, 1);
    });

    it.each([['1 and a half bananas'], ['one and a half bananas']])(
        '%s on a label-less Bananas record -> 177 g seed_count_default (1.5 x 118 g)',
        async (line) => {
            const r = await run(line, 'Bananas');
            expect(r?.servingTier).toBe('seed_count_default');
            expect(r?.grams).toBeCloseTo(177, 1);
        },
    );

    it('1 1/2 croissants on "1 croissant (48 g)" -> 72 g on the same tier as `2 croissants`', async () => {
        const r = await run('1 1/2 croissants', 'Croissants', '1 croissant (48 g)', 48);
        expect(r?.servingTier).toBe('label_count_derived');
        expect(r?.grams).toBeCloseTo(72, 1);
    });

    it('2.5 pierogies (no seed, no label) -> the one bounded serving `2 pierogies` bills, not 250 g', async () => {
        const r = await run('2.5 pierogies', 'Pierogies');
        expect(r?.servingTier).toBe('count_unresolved_floor');
        expect(r?.grams).toBe(100);
    });
});

describe('PARITY — grams per piece and tier match the integer twin', () => {
    it.each([
        ['2 and a half cookies', '2 cookies', 'Cookies', null, null],
        ['1 and a half bananas', '2 bananas', 'Bananas', null, null],
        ['1 1/2 croissants', '2 croissants', 'Croissants', '1 croissant (48 g)', 48],
    ] as const)('%s ~ %s', async (frac, twin, name, ss, sg) => {
        const a = await run(frac, name, ss, sg);
        const b = await run(twin, name, ss, sg);
        const qa = parseIngredientLine(frac)!.qty;
        const qb = parseIngredientLine(twin)!.qty;
        expect(a?.servingTier).toBe(b?.servingTier);
        expect(a!.grams / qa).toBeCloseTo(b!.grams / qb, 3);
    });
});

describe('CONTROLS — must not change', () => {
    it('2 cookies -> 60 g seed_count_default', async () => {
        const r = await run('2 cookies', 'Cookies');
        expect(r?.servingTier).toBe('seed_count_default');
        expect(r?.grams).toBeCloseTo(60, 1);
    });
    it('3 cookies -> 90 g seed_count_default', async () => {
        const r = await run('3 cookies', 'Cookies');
        expect(r?.grams).toBeCloseTo(90, 1);
    });
    it('2 bananas -> 236 g seed_count_default', async () => {
        const r = await run('2 bananas', 'Bananas');
        expect(r?.grams).toBeCloseTo(236, 1);
    });
    it('2 croissants on "1 croissant (48 g)" -> 96 g label_count_derived', async () => {
        const r = await run('2 croissants', 'Croissants', '1 croissant (48 g)', 48);
        expect(r?.servingTier).toBe('label_count_derived');
        expect(r?.grams).toBeCloseTo(96, 1);
    });
    it('2 pierogies -> 100 g count_unresolved_floor', async () => {
        const r = await run('2 pierogies', 'Pierogies');
        expect(r?.servingTier).toBe('count_unresolved_floor');
        expect(r?.grams).toBe(100);
    });
    it('one and a half cups of rice (a VOLUME) -> 270 g label_unit_match, the volume path', async () => {
        const r = await run('one and a half cups of rice', 'Rice', '1 cup (180 g)', 180);
        expect(r?.servingTier).toBe('label_unit_match');
        expect(r?.grams).toBeCloseTo(270, 1);
    });
    it('two and a half slices of pizza (a count UNIT) -> 2.5 x the per-slice weight, the unit path', async () => {
        const r = await run('two and a half slices of pizza', 'Pizza');
        expect(r?.servingTier).toBe('count_unit_cached');
        expect(r?.grams).toBeCloseTo(267.5, 1);
    });
    it('2 and a half eggs (the parser reads `eggs` as unit `egg`) -> the unit path', async () => {
        const r = await run('2 and a half eggs', 'Eggs');
        expect(r?.servingTier).toBe('count_unit_cached');
        expect(r?.grams).toBeCloseTo(125, 1);
    });
    // OUT OF THIS ROW'S REACH (separate rows, pinned so the boundary is visible):
    // qty < 1 never entered the count branch and still does not; and
    // `a cookie and a half` is a PARSER shape (qty 1, name `a cookie and a half`).
    it('half a cookie (qty 0.5) is not reached: still flat_100g_default', async () => {
        const r = await run('half a cookie', 'Cookies');
        expect(r?.servingTier).toBe('flat_100g_default');
    });
    it('a cookie and a half parses as qty 1 and is not reached', async () => {
        expect(parseIngredientLine('a cookie and a half')?.qty).toBe(1);
        const r = await run('a cookie and a half', 'Cookies');
        expect(r?.servingTier).toBe('bare_discrete_floor');
    });
});
