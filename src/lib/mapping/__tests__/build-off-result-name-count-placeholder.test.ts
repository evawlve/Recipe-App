/**
 * C70 row 8 - a counted line on a synthetic-barcode CHAIN OFF record whose NAME
 * carries its own piece count N and whose label serving is the 100 g per-100g
 * placeholder bills qty x (100 / N) (tier name_count_derived), instead of
 * qty x 100 g (label_serving_default), the generic seed (seed_count_default) or
 * an AI per-piece guess (count_unit_ai / count_unit_cached).
 *
 * Fixtures are built with parseOffServingSize() (never a hand-written label
 * description); ids are 18-digit synthetic barcodes unless a row says otherwise.
 */

import { buildOffResult } from '../map-ingredient-with-fallback';
import { hydrateAndSelectServing } from '../serving/hydration-lane';
import { hydrateOffCandidate } from '../../openfoodfacts/hydrate';
import { parseOffServingSize } from '../../openfoodfacts/serving-resolver';
import { getOrCreateAmbiguousServing } from '../ambiguous-unit-backfill';
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

const SYNTH_ID = 'off_761638495685184034';
const REAL_ID = 'off_0761638495685';

function makeCandidate(name: string, id: string = SYNTH_ID) {
    return {
        id,
        source: 'openfoodfacts' as const,
        name,
        score: 1,
        foodType: 'generic',
        rawData: {},
    } as any;
}

function makeHydrated(
    foodName: string,
    id: string = SYNTH_ID,
    servingSize: string | null = '100g',
    servingQuantity: number | null = null,
) {
    const r = parseOffServingSize(servingSize, servingQuantity);
    return {
        foodId: id,
        foodName,
        brandName: null,
        nutrientsPer100g: { calories: 170, protein: 20, carbs: 5, fat: 8 },
        servingGrams: r.grams,
        servingDescription: r.description,
        servingUnitCount: r.unitCount,
        packageQuantity: null,
        packageQuantityUnit: null,
    };
}

async function run(
    foodName: string,
    line: string,
    opts: { id?: string; servingSize?: string | null; servingQuantity?: number | null } = {},
) {
    const id = opts.id ?? SYNTH_ID;
    (hydrateOffCandidate as jest.Mock).mockResolvedValue(
        makeHydrated(foodName, id, opts.servingSize === undefined ? '100g' : opts.servingSize, opts.servingQuantity ?? null),
    );
    const parsed = parseIngredientLine(line);
    return buildOffResult(makeCandidate(foodName, id), parsed, 0.9, line);
}

beforeEach(() => {
    jest.clearAllMocks();
    (getOrCreateAmbiguousServing as jest.Mock).mockResolvedValue({ status: 'success', grams: 5 });
});

describe('fixture placeholder shape', () => {
    it('a bare "100g" label normalises to the 1-serving placeholder', () => {
        const r = parseOffServingSize('100g', null);
        expect(r.grams).toBe(100);
        expect(r.description).toBe('1 serving');
        expect(r.unitCount).toBe(1);
    });
});

describe('name_count_derived - unitless arm FIRES', () => {
    const rows: Array<[string, string, string, number]> = [
        ['12 count chick-fil-a nuggets', 'Chick-Fil-A, 4 Grilled Nuggets', 'nuggets', 300],
        ['four chick-fil-a nuggets', 'Chick-Fil-A, 8 Grilled Nuggets', 'nuggets', 50],
        ['10 chicken mcnuggets', "McDonald's, 6 Chicken McNuggets", 'mcnuggets', 166.7],
        ['10 wingstop wings', 'Wingstop, 2 Jumbo Wings, Louisiana Rub', 'wings', 500],
        ['10 pc wingstop wings', 'Wingstop, 2 Jumbo Wings, Louisiana Rub', 'wings', 500],
        ['3 popeyes tenders', 'Popeyes, 3 Handcrafted Tenders', 'tenders', 100],
    ];
    it.each(rows)('%s on "%s"', async (line, name, noun, expected) => {
        const result = await run(name, line);
        expect(result).not.toBeNull();
        expect(result?.servingTier).toBe('name_count_derived');
        expect(result?.grams).toBeCloseTo(expected, 1);
        expect(result?.servingDescription).toContain(`${noun} (`);
        expect(result?.servingDescription).toContain("from the record's own count of");
        expect(getOrCreateAmbiguousServing).not.toHaveBeenCalled();
    });
});

describe('name_count_derived - piece arm FIRES (no AI call)', () => {
    const rows: Array<[string, string, number]> = [
        ['10 piece chicken mcnuggets', "McDonald's, 6 Chicken McNuggets", 166.7],
        ['20 piece chicken mcnuggets', "McDonald's, 6 Chicken McNuggets", 333.3],
        ['3 piece popeyes tenders', 'Popeyes, 3 Handcrafted Tenders', 100],
        ['10 pieces wingstop wings', 'Wingstop, 2 Jumbo Wings, Louisiana Rub', 500],
    ];
    it.each(rows)('%s on "%s"', async (line, name, expected) => {
        const result = await run(name, line);
        expect(result).not.toBeNull();
        expect(result?.servingTier).toBe('name_count_derived');
        expect(result?.grams).toBeCloseTo(expected, 1);
        expect(getOrCreateAmbiguousServing).toHaveBeenCalledTimes(0);
    });
});

describe('name_count_derived - bare-pair twin', () => {
    it('"pancakes" on "IHOP, 2 Buttermilk Pancakes" is KEPT by the twin at 100 g', async () => {
        const name = 'IHOP, 2 Buttermilk Pancakes';
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated(name));
        const parsed = parseIngredientLine('pancakes');
        const result = await hydrateAndSelectServing(makeCandidate(name), parsed, 0.9, 'pancakes');
        expect(result).not.toBeNull();
        expect(result?.servingTier).toBe('name_count_derived');
        expect(result?.grams).toBeCloseTo(100, 1);
    });
});

describe('name_count_derived - SILENT (today\'s path)', () => {
    it('ID GATE: a 13-digit (real GTIN) id keeps label_serving_default', async () => {
        const result = await run('Chick-Fil-A, 4 Grilled Nuggets', '12 count chick-fil-a nuggets', { id: REAL_ID });
        expect(result?.servingTier).toBe('label_serving_default');
        expect(result?.grams).toBeCloseTo(1200, 1);
    });

    it('EXCLUSION ONLY: "7 Layer Burritos" `2 burritos` is refused by the size-word gate', async () => {
        const result = await run('Taco Bell, 7 Layer Burritos', '2 burritos');
        expect(result?.servingTier).not.toBe('name_count_derived');
    });

    it('EXCLUSION ONLY: "6 Inch Turkey Subs" `2 subs` is refused by the size-word gate', async () => {
        const result = await run('Subway, 6 Inch Turkey Subs', '2 subs');
        expect(result?.servingTier).not.toBe('name_count_derived');
    });

    it('"Wendy\'s, 4 for 4" is refused', async () => {
        const result = await run("Wendy's, 4 for 4", '2 wendys 4 for 4');
        expect(result?.servingTier).not.toBe('name_count_derived');
    });

    it('"4 Piece Chicken Nuggets Kids Meal" `4 nuggets` is refused (piece word / item match)', async () => {
        const result = await run("Wendy's, 4 Piece Chicken Nuggets Kids Meal", '4 nuggets');
        expect(result?.servingTier).not.toBe('name_count_derived');
    });

    it('N = 1 is refused', async () => {
        const result = await run("Papa John's, 1 Pepperoni Roll", '3 rolls');
        expect(result?.servingTier).not.toBe('name_count_derived');
    });

    it('N = 60 is refused', async () => {
        const result = await run('Chick-Fil-A, 60 Grilled Nuggets', '12 count chick-fil-a nuggets');
        expect(result?.servingTier).not.toBe('name_count_derived');
    });

    it('"Wingstop, 10 Boneless" (noun not plural) is refused', async () => {
        const result = await run('Wingstop, 10 Boneless', '10 wingstop boneless');
        expect(result?.servingTier).not.toBe('name_count_derived');
    });

    it('a name with NO ", " brand prefix is refused', async () => {
        const result = await run('4 Grilled Nuggets', '12 count chick-fil-a nuggets');
        expect(result?.servingTier).not.toBe('name_count_derived');
    });

    it('qty 1 is refused', async () => {
        const result = await run('Popeyes, 3 Handcrafted Tenders', '1 popeyes tender');
        expect(result?.servingTier).not.toBe('name_count_derived');
    });

    it('a noun mismatch (`10 wingstop fries` on a wings record) is refused', async () => {
        const result = await run('Wingstop, 2 Jumbo Wings, Louisiana Rub', '10 wingstop fries');
        expect(result?.servingTier).not.toBe('name_count_derived');
    });

    it('a REAL label "4 nuggets (100 g)" keeps the label_count_derived path (25 g/pc)', async () => {
        const result = await run('Chick-Fil-A, 4 Grilled Nuggets', '12 count chick-fil-a nuggets', {
            servingSize: '4 nuggets (100 g)',
            servingQuantity: 100,
        });
        expect(result?.servingTier).toBe('label_count_derived');
        expect(result?.grams).toBeCloseTo(300, 1);
    });

    it('a non-placeholder servingGrams (113) is refused', async () => {
        const result = await run('Chick-Fil-A, 4 Grilled Nuggets', '12 count chick-fil-a nuggets', {
            servingSize: '113g',
        });
        expect(result?.servingTier).not.toBe('name_count_derived');
    });

    it('`2 slices popeyes tenders` (unit slice is not a generic piece word) takes the AI arm', async () => {
        const result = await run('Popeyes, 3 Handcrafted Tenders', '2 slices popeyes tenders');
        expect(result?.servingTier).not.toBe('name_count_derived');
        expect(getOrCreateAmbiguousServing).toHaveBeenCalled();
    });

    it('a unit row other than piece keeps the AI arm (mock called)', async () => {
        const result = await run('Popeyes, 3 Handcrafted Tenders', '2 slices popeyes tenders');
        expect(result?.servingTier).toBe('count_unit_ai');
    });
});
