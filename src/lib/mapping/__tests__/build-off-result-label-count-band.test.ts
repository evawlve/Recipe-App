/**
 * C70 row 10 (2026-10-20) — label_count_band_derived: a counted or
 * article-singular line on a real-GTIN OFF record whose label counts N >= 2
 * pieces bills qty x (label grams / N) when that per-piece weight is inside the
 * noun's corpus band (serving/label-count-band.ts), instead of qty x the whole
 * multi-piece serving.
 *
 * Fixtures: every `parsed` comes from parseIngredientLine(rawLine) (the parser
 * KEEPS the article in the name for a/an and strips it for `one`); every label
 * comes from parseOffServingSize(servingSize, servingGrams).
 */

import { buildOffResult, hydrateAndSelectServing } from '../map-ingredient-with-fallback';
import { hydrateOffCandidate } from '../../openfoodfacts/hydrate';
import { getOrCreateAmbiguousServing } from '../ambiguous-unit-backfill';
import { parseOffServingSize } from '../../openfoodfacts/serving-resolver';
import { parseIngredientLine } from '../../parse/ingredient-line';
import { labelCountPerPiece } from '../serving/label-count-band';
import { extractLabelServingUnit } from '../count-label';

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

/** The labelCountPerPiece() arguments a record's label implies, built through the real parsers. */
function unitArgs(itemName: string, servingSize: string, servingGrams: number | null) {
    const label = parseOffServingSize(servingSize, servingGrams);
    return {
        servingGrams: servingGrams == null ? null : label.grams,
        labelUnitCount: label.unitCount && label.unitCount > 0 ? label.unitCount : 1,
        labelUnitWord: extractLabelServingUnit(label.description),
        itemName,
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    (getOrCreateAmbiguousServing as jest.Mock).mockResolvedValue({ status: 'error', error: 'not mocked' });
});

describe('labelCountPerPiece — UNIT', () => {
    it('arm 1: three tacos ~ "2 TACOS (128 g)" -> 64', () => {
        const r = labelCountPerPiece(unitArgs('tacos', '2 TACOS (128 g)', 128));
        expect(r?.perPiece).toBeCloseTo(64, 1);
        expect(r?.noun).toBe('taco');
    });
    it('arm 3: 2 pop tarts ~ "2 pastries (96 g)" -> 48 (pair pastry~tart)', () => {
        expect(labelCountPerPiece(unitArgs('pop tarts', '2 pastries (96 g)', 96))?.perPiece).toBeCloseTo(48, 1);
    });
    it("a dozen totino's pizza rolls ~ \"6 rolls (85 g)\" -> 14.2", () => {
        expect(labelCountPerPiece(unitArgs("totino's pizza rolls", '6 rolls (85 g)', 85))?.perPiece).toBeCloseTo(14.2, 1);
    });
    it('arm 3: 5 lindor truffles ~ "3 balls (36 g)" -> 12 (pair ball~truffle)', () => {
        expect(labelCountPerPiece(unitArgs('lindor truffles', '3 balls (36 g)', 36))?.perPiece).toBeCloseTo(12, 1);
    });
    it('two cream cheese rangoons ~ "3 pieces (85 g)" -> null (generic label refused)', () => {
        expect(labelCountPerPiece(unitArgs('cream cheese rangoons', '3 pieces (85 g)', 85))).toBeNull();
    });
    it('2 california rolls ~ "6 pieces (156 g)" -> null (generic label refused: 52 g would be a 6x under-bill)', () => {
        expect(labelCountPerPiece(unitArgs('california rolls', '6 pieces (156 g)', 156))).toBeNull();
    });
    it('2 Pop Tarts (capitalised) ~ "2 pastries (96 g)" -> 48', () => {
        expect(labelCountPerPiece(unitArgs('Pop Tarts', '2 pastries (96 g)', 96))?.perPiece).toBeCloseTo(48, 1);
    });
    it('3 meatballs ~ "6 meatballs (85 g)" -> 14.2 (the corpus p10 label, admitted by the floored band)', () => {
        expect(labelCountPerPiece(unitArgs('meatballs', '6 meatballs (85 g)', 85))?.perPiece).toBeCloseTo(14.2, 1);
    });
    it('two breadsticks ~ "5 BREADSTICKS (15 g)" -> 3.0 (p10 inclusive)', () => {
        expect(labelCountPerPiece(unitArgs('breadsticks', '5 BREADSTICKS (15 g)', 15))?.perPiece).toBeCloseTo(3.0, 1);
    });
    it('4 oreo cookies ~ "9 cookies (29 g)" -> null (the label noun is `cooky`: no band)', () => {
        expect(labelCountPerPiece(unitArgs('oreo cookies', '9 cookies (29 g)', 29))).toBeNull();
    });
    it('6 meatballs ~ "12 meatballs (85 g)" -> null (7.1 < p10 14.1: the genuine band refusal)', () => {
        expect(labelCountPerPiece(unitArgs('meatballs', '12 meatballs (85 g)', 85))).toBeNull();
    });
    it('2 rice cakes ~ "8 cake (24 g)" -> null (cake not in the table)', () => {
        expect(labelCountPerPiece(unitArgs('rice cakes', '8 cake (24 g)', 24))).toBeNull();
    });
    it("a pizza ~ \"Totino's Pizza Rolls\" \"6 rolls (85 g)\" -> null (no substring arm)", () => {
        expect(labelCountPerPiece(unitArgs('a pizza', '6 rolls (85 g)', 85))).toBeNull();
    });
    it("2 totino's -> null (empty head)", () => {
        expect(labelCountPerPiece(unitArgs("totino's", '6 rolls (85 g)', 85))).toBeNull();
    });
    it('3 meatballs ~ "6 pieces (85 g)" -> null (generic label refused)', () => {
        expect(labelCountPerPiece(unitArgs('meatballs', '6 pieces (85 g)', 85))).toBeNull();
    });
    it('an eggo waffle ~ "2 gaufres (70 g)" -> 35 (alias gaufre->waffle, then arm 1)', () => {
        expect(labelCountPerPiece(unitArgs('an eggo waffle', '2 gaufres (70 g)', 70))?.perPiece).toBeCloseTo(35, 1);
    });
    it('a protein pancake ~ "3 pancakes (109 g)" -> 36.3', () => {
        expect(labelCountPerPiece(unitArgs('a protein pancake', '3 pancakes (109 g)', 109))?.perPiece).toBeCloseTo(36.3, 1);
    });
    it('an egglife wrap ~ "2 wraps (57 g)" -> 28.5', () => {
        expect(labelCountPerPiece(unitArgs('an egglife wrap', '2 wraps (57 g)', 57))?.perPiece).toBeCloseTo(28.5, 1);
    });
    it('a stick of gum ~ "6 PIECES (3 g)" -> null (0.5 g; gum not in the table)', () => {
        expect(labelCountPerPiece(unitArgs('a stick of gum', '6 PIECES (3 g)', 3))).toBeNull();
    });
    it('single-piece label "1 cake (13 g)" -> null (count 1)', () => {
        expect(labelCountPerPiece(unitArgs('rice cakes', '1 cake (13 g)', 13))).toBeNull();
    });
    it('"8 OUNCES (227 g)" -> null (ounce is not a band noun)', () => {
        expect(labelCountPerPiece(unitArgs('parfait', '8 OUNCES (227 g)', 227))).toBeNull();
    });
    it('servingGrams null -> null', () => {
        expect(labelCountPerPiece({ servingGrams: null, labelUnitCount: 2, labelUnitWord: 'tacos', itemName: 'tacos' })).toBeNull();
    });
    it('a prototype-property head (`constructor`) reads no table entry', () => {
        expect(labelCountPerPiece({ servingGrams: 100, labelUnitCount: 2, labelUnitWord: 'constructor', itemName: 'constructor' })).toBeNull();
    });
});

describe('buildOffResult — END-TO-END FIRES', () => {
    it('three tacos on "2 TACOS (128 g)" -> 192 g label_count_band_derived', async () => {
        const r = await run('three tacos', 'Tacos', '2 TACOS (128 g)', 128);
        expect(r?.servingTier).toBe('label_count_band_derived');
        expect(r?.grams).toBeCloseTo(192, 1);
    });
    it('2 pop tarts on "2 pastries (96 g)" -> 96 g', async () => {
        const r = await run('2 pop tarts', 'Pop Tarts', '2 pastries (96 g)', 96);
        expect(r?.servingTier).toBe('label_count_band_derived');
        expect(r?.grams).toBeCloseTo(96, 1);
    });
    it('5 Lindor truffles on "3 balls (36 g)" -> 60 g', async () => {
        const r = await run('5 Lindor truffles', 'Lindor Truffles', '3 balls (36 g)', 36);
        expect(r?.servingTier).toBe('label_count_band_derived');
        expect(r?.grams).toBeCloseTo(60, 1);
    });
    it("a dozen totino's pizza rolls on \"6 rolls (85 g)\" -> 170 g", async () => {
        const r = await run("a dozen totino's pizza rolls", "Totino's Pizza Rolls", '6 rolls (85 g)', 85);
        expect(r?.servingTier).toBe('label_count_band_derived');
        expect(r?.grams).toBeCloseTo(170, 0);
    });
    it('two sausage links on "3 LINKS (64 g)" -> 42.7 g', async () => {
        const r = await run('two sausage links', 'Sausage links', '3 LINKS (64 g)', 64);
        expect(r?.servingTier).toBe('label_count_band_derived');
        expect(r?.grams).toBeCloseTo(42.7, 1);
    });
    it('a pop tart (article singular) on "2 pastries (96 g)" -> 48 g', async () => {
        const r = await run('a pop tart', 'Pop Tarts', '2 pastries (96 g)', 96);
        expect(r?.servingTier).toBe('label_count_band_derived');
        expect(r?.grams).toBeCloseTo(48, 1);
    });
    it('an eggo waffle on "2 gaufres (70 g)" -> 35 g', async () => {
        const r = await run('an eggo waffle', 'Eggo Waffles', '2 gaufres (70 g)', 70);
        expect(r?.servingTier).toBe('label_count_band_derived');
        expect(r?.grams).toBeCloseTo(35, 1);
    });
    it('a protein pancake on "3 pancakes (109 g)" -> 36.3 g', async () => {
        const r = await run('a protein pancake', 'Protein Pancakes', '3 pancakes (109 g)', 109);
        expect(r?.servingTier).toBe('label_count_band_derived');
        expect(r?.grams).toBeCloseTo(36.3, 1);
    });
});

describe('buildOffResult — TIER-ONLY (236 organic events: 70 g stays 70 g, seed_count_default -> label_count_band_derived)', () => {
    it('2 eggo waffles on the real Eggo record ("2 waffles (70 g)", off_0064100236141)', async () => {
        const r = await run('2 eggo waffles', 'Eggo Homestyle Waffles', '2 waffles (70 g)', 70, 'off_0064100236141');
        expect(r?.grams).toBeCloseTo(70, 1);
        expect(r?.servingTier).toBe('label_count_band_derived');
    });
    it('2 eggo waffles on the cinnamon-toast sibling ("2 gaufres (70 g)")', async () => {
        const r = await run('2 eggo waffles', 'Eggo Cinnamon Toast Waffles', '2 gaufres (70 g)', 70, 'off_0064100236158');
        expect(r?.grams).toBeCloseTo(70, 1);
        expect(r?.servingTier).toBe('label_count_band_derived');
    });
});

describe('hydrateAndSelectServing — the bare-pair twin', () => {
    it('pancakes (bare plural) on "3 pancakes (109 g)" -> 72.7 g label_count_band_derived', async () => {
        const id = 'off_0038000438615';
        (hydrateOffCandidate as jest.Mock).mockResolvedValue(makeHydrated(id, 'Pancakes', '3 pancakes (109 g)', 109));
        const parsed = parseIngredientLine('pancakes');
        const r = await hydrateAndSelectServing(makeCandidate(id, 'Pancakes'), parsed, 0.9, 'pancakes');
        expect(r?.servingTier).toBe('label_count_band_derived');
        expect(r?.grams).toBeCloseTo(72.7, 1);
    });
});

describe('buildOffResult — SILENT', () => {
    it('pop tarts (bare plural) -> bare_plural_serving 96 g unchanged', async () => {
        const r = await run('pop tarts', 'Pop Tarts', '2 pastries (96 g)', 96);
        expect(r?.servingTier).toBe('bare_plural_serving');
        expect(r?.grams).toBeCloseTo(96, 1);
    });
    it('4 oreo cookies on "9 cookies (29 g)" -> seed_count_default 45.2 g', async () => {
        const r = await run('4 oreo cookies', 'Oreo Cookies', '9 cookies (29 g)', 29, 'off_0044000085300');
        expect(r?.servingTier).toBe('seed_count_default');
        expect(r?.grams).toBeCloseTo(45.2, 1);
    });
    it('two cream cheese rangoons on "3 pieces (85 g)" -> label_serving_default 170 g', async () => {
        const r = await run('two cream cheese rangoons', 'Cream Cheese Rangoons', '3 pieces (85 g)', 85);
        expect(r?.servingTier).toBe('label_serving_default');
        expect(r?.grams).toBeCloseTo(170, 0);
    });
    it('a chip on "15 chips (28 g)" -> untouched (1.9 g is below the 20 g floor)', async () => {
        const r = await run('a chip', 'Chips', '15 chips (28 g)', 28);
        expect(r?.servingTier).not.toBe('label_count_band_derived');
    });
    it('a ritz cracker on "5 crackers (16 g)" -> untouched', async () => {
        const r = await run('a ritz cracker', 'Ritz Crackers', '5 crackers (16 g)', 16);
        expect(r?.servingTier).not.toBe('label_count_band_derived');
    });
    it('a parfait on "8 OUNCES (227 g)" -> bare_label_serving 227 unchanged', async () => {
        const r = await run('a parfait', 'Parfait', '8 OUNCES (227 g)', 227);
        expect(r?.servingTier).toBe('bare_label_serving');
        expect(r?.grams).toBeCloseTo(227, 0);
    });
    it('an uncrustable on "1 sandwich (80 g)" -> untouched', async () => {
        const r = await run('an uncrustable', 'Uncrustables', '1 sandwich (80 g)', 80);
        expect(r?.servingTier).not.toBe('label_count_band_derived');
    });
    it('two waffles on "70 g (2 WAFFLES)" -> untouched (the count comes AFTER the grams)', async () => {
        const r = await run('two waffles', 'Waffles', '70 g (2 WAFFLES)', 70);
        expect(r?.servingTier).not.toBe('label_count_band_derived');
    });
});
