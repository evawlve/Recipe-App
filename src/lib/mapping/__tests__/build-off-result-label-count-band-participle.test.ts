/**
 * s457 PS — a preparation participle in the label (`3 COOKED LINKS (53 g)`).
 * Harness copied from build-off-result-label-count-band.test.ts.
 *
 * (was) C70 row 10 (2026-10-20) — label_count_band_derived: a counted or
 * article-singular line on a real-GTIN OFF record whose label counts N >= 2
 * pieces bills qty x (label grams / N) when that per-piece weight is inside the
 * noun's corpus band (serving/label-count-band.ts), instead of qty x the whole
 * multi-piece serving.
 *
 * Fixtures: every `parsed` comes from parseIngredientLine(rawLine) (the parser
 * KEEPS the article in the name for a/an and strips it for `one`); every label
 * comes from parseOffServingSize(servingSize, servingGrams).
 */

import { buildOffResult } from '../map-ingredient-with-fallback';
import { hydrateOffCandidate } from '../../openfoodfacts/hydrate';
import { getOrCreateAmbiguousServing } from '../ambiguous-unit-backfill';
import { parseOffServingSize } from '../../openfoodfacts/serving-resolver';
import { parseIngredientLine } from '../../parse/ingredient-line';
import { labelCountPerPiece } from '../serving/label-count-band';

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


beforeEach(() => {
    (getOrCreateAmbiguousServing as jest.Mock).mockReset();
    (getOrCreateAmbiguousServing as jest.Mock).mockResolvedValue({ status: 'error' });
});

describe('labelCountPerPiece reads one -ed word before the noun (s457 PS)', () => {
    it('3 COOKED LINKS (53 g) for pork sausage links -> 17.67 g link', () => {
        const r = labelCountPerPiece({ servingGrams: 53, labelUnitCount: 3, labelUnitWord: 'cooked',
            itemName: 'pork sausage links', labelDescription: '3 COOKED LINKS (53 g)' });
        expect(r?.noun).toBe('link');
        expect(r?.n).toBe(3);
        expect(r?.perPiece).toBeCloseTo(17.67, 1);
    });
    it('without labelDescription the old contract holds -> null', () => {
        expect(labelCountPerPiece({ servingGrams: 53, labelUnitCount: 3, labelUnitWord: 'cooked',
            itemName: 'pork sausage links' })).toBeNull();
    });
});

const MOVES: Array<[string, string, string, number, number]> = [
    ['2 pork sausage links', 'Pork sausage links', '3 COOKED LINKS (53 g)', 53, 35.33],
    ['two pork sausage links', 'Pork sausage links', '3 COOKED LINKS (53 g)', 53, 35.33],
    ['3 breakfast sausage links', 'Breakfast sausage links', '3 COOKED LINKS (55 g)', 55, 55],
    ['2 sausage links', 'Sausage links', '3 broiled links (60 g)', 60, 40],
    ['2 links', 'Pork sausage links', '3 COOKED LINKS (53 g)', 53, 35.33],
    ['2 biscuits', 'Biscuits', '4 assorted biscuits (34 g)', 34, 17],
    ['a sausage link', 'Sausage links', '3 cooked links (66 g)', 66, 22],
];
describe('label_count_band_derived through a participle (s457 PS)', () => {
    it.each(MOVES)('%s on "%s" %s (%s g) -> band %s g', async (line, name, size, g, want) => {
        const r = await run(line, name, size, g);
        expect(r?.servingTier).toBe('label_count_band_derived');
        expect(r?.grams).toBeCloseTo(want, 1);
    });
});

const HOLDS: Array<[string, string, string | null, number | null, string, number]> = [
    ['2 sausage links', 'Sausage links', '2 uncooked links (90 g)', 90, 'seed_count_default', 90],
    ['2 pancakes', 'Pancakes', '3 mini pancakes (30 g)', 30, 'seed_count_default', 76],
    ['2 sausage links', 'Sausage links', '3 cooked patties (60 g)', 60, 'seed_count_default', 90],
    ['2 sausage links', 'Sausage links', '3 red links (60 g)', 60, 'seed_count_default', 90],
    ['2.5 pork sausage links', 'Pork sausage links', '3 COOKED LINKS (53 g)', 53, 'seed_count_default', 112.5],
    ['a pork sausage link', 'Pork sausage links', '3 COOKED LINKS (53 g)', 53, 'bare_label_serving', 53],
    ['two sausage links', 'Sausage links', '3 LINKS (64 g)', 64, 'label_count_band_derived', 42.67],
    ['2 italian sausage links', 'Italian sausage links', null, null, 'seed_count_default', 90],
    ['2 lindt pieces', 'Lindt Teddy', '4 assorted pieces (39 g)', 39, 'label_serving_default', 78],
];
describe('holds (s457 PS)', () => {
    it.each(HOLDS)('%s on "%s" %s (%s g) -> %s %s g', async (line, name, size, g, tier, want) => {
        let r: any;
        if (size == null) {
            (hydrateOffCandidate as jest.Mock).mockResolvedValue({ foodId: 'off_0038000438615', foodName: name, brandName: null,
                nutrientsPer100g: { calories: 400, protein: 10, carbs: 50, fat: 15 }, servingGrams: null, servingDescription: null,
                servingUnitCount: 1, packageQuantity: null, packageQuantityUnit: null });
            r = await buildOffResult(makeCandidate('off_0038000438615', name), parseIngredientLine(line), 0.9, line);
        } else {
            r = await run(line, name, size, g as number);
        }
        expect(r?.servingTier).toBe(tier);
        expect(r?.grams).toBeCloseTo(want, 1);
    });
});
