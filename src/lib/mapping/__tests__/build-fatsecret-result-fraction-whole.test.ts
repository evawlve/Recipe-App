/**
 * s462 WHOLE-ONE-FS — the FatSecret twin of s461 WHOLE-ONE (serving/fraction-whole-item.ts).
 *
 * `half a rotisserie chicken` resolves cold to fs_2314048 (Wal-Mart `Rotisserie Chicken`, default
 * serving `3 oz` 84 g) and billed 0.5 x 84 = 42 g / 125 kcal (MEASURED, deploy 49, s462
 * pd-wholefs A1-A3). buildFatSecretResult() now asks the same rule buildOffResult() asks, with a
 * FatSecret reading of "is the one a portion" (fsFractionOneIsPortion()): a branded `1 serving`
 * is the brand's declared serving, i.e. the menu item, and keeps today's bill.
 * The `whole` estimate is never persisted for an `fs_` id (no serving table).
 */

const mockFatSecretFoodFindUnique = jest.fn();
const mockGetOrCreateAmbiguousServing = jest.fn();

jest.mock('../../db', () => ({
    prisma: {
        fatSecretFood: {
            findUnique: (...args: unknown[]) => mockFatSecretFoodFindUnique(...args),
        },
    },
}));

jest.mock('../ambiguous-unit-backfill', () => ({
    isAmbiguousUnit: jest.requireActual('../ambiguous-unit-backfill').isAmbiguousUnit,
    getOrCreateAmbiguousServing: (...args: unknown[]) => mockGetOrCreateAmbiguousServing(...args),
}));

import { buildFatSecretResult } from '../build-fatsecret-result';
import { parseIngredientLine } from '../../parse/ingredient-line';
import {
    fsFractionCutUnit, fsFractionOneIsPortion, fractionWholeFsEnabled, fsFractionWholeDecline,
} from '../serving/fraction-whole-item';

function candidate(id: string, name: string, brandName: string | null = null) {
    return { id, source: 'fatsecret' as const, name, brandName, score: 1, foodType: 'Brand', rawData: {} } as any;
}

type Serving = { servingId: string; description: string; grams: number | null; kcal?: number };

/** A FatSecretFood row: `servings[0]` is the declared default. */
function row(fsId: string, name: string, brandName: string | null, per100Kcal: number, servings: Serving[],
    macros: { protein: number; carbs: number; fat: number } = { protein: 20, carbs: 5, fat: 8 }) {
    return {
        fsId, name, brandName, foodType: brandName ? 'Brand' : 'Generic',
        nutrientsPer100g: { kcal: per100Kcal, ...macros },
        defaultServingId: servings[0]?.servingId ?? null,
        fetchedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
        servings: servings.map((s) => ({
            servingId: s.servingId, description: s.description, measurementDescription: null,
            grams: s.grams, volumeMl: null, numberOfUnits: 1,
            nutrients: s.grams != null ? { calories: (s.kcal ?? per100Kcal) * s.grams / 100, protein: 1, carbohydrate: 1, fat: 1 } : null,
        })),
    };
}

/** fs_2314048's real shape (box, 2026-11-17): `100 g` panel row + `3 oz` 84 g default. */
const WALMART_ROTISSERIE = row('2314048', 'Rotisserie Chicken', 'Wal-Mart', 149, [
    { servingId: '2263599', description: '3 oz', grams: 84 },
]);

async function bill(line: string, fsRow: ReturnType<typeof row>, brand: string | null = fsRow.brandName) {
    mockFatSecretFoodFindUnique.mockResolvedValue(fsRow);
    return buildFatSecretResult(candidate(`fs_${fsRow.fsId}`, fsRow.name, brand), parseIngredientLine(line), 0.9, line);
}

const ENV = { ...process.env };
beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ENV };
    delete process.env.SERVING_FRACTION_WHOLE;
    delete process.env.SERVING_FRACTION_WHOLE_FS;
    mockGetOrCreateAmbiguousServing.mockResolvedValue({ status: 'success', grams: 1300 });
});
afterAll(() => { process.env = ENV; });

describe('fsFractionOneIsPortion — FatSecret\'s label convention', () => {
    it.each([
        [null, true], ['', true], ['3 oz', true], ['100 g', true], ['4.5 oz', true], ['1 oz', true],
        ['1 serving (85 g)', true], ['1 serving (240 g)', true],
    ])('%p is a portion', (d, want) => expect(fsFractionOneIsPortion(d)).toBe(want));
    it.each([
        ['1 serving'], ['1 sandwich'], ['1 piece'], ['1 medium (7" to 7-7/8" long)'], ['1/8 pie'], ['8 pieces'],
        ['1 cup'], ['1 muffin'], ['1 regular'], ['2 tbsp'],
    ])('%p is not (a branded serving, the item, a piece, a size, a volume)', (d) => expect(fsFractionOneIsPortion(d)).toBe(false));
});

describe('buildFatSecretResult — fraction_whole_item', () => {
    it('`half a rotisserie chicken` on a `3 oz` default bills half the whole bird', async () => {
        // MUTATION: `if (false && (servingTier === ...` -> 42 g, fs_default_serving.
        const r = await bill('half a rotisserie chicken', WALMART_ROTISSERIE);
        expect(r!.servingTier).toBe('fraction_whole_item');
        expect(r!.grams).toBe(650);
        expect(r!.source).toBe('fatsecret');
        expect(mockGetOrCreateAmbiguousServing).toHaveBeenCalledWith('fs_2314048', 'Rotisserie Chicken', 'whole', 'Wal-Mart');
    });

    it('kcal follow the grams on the record\'s own density', async () => {
        const r = await bill('half a rotisserie chicken', WALMART_ROTISSERIE);
        expect(r!.kcal).toBeCloseTo(650 * 1.49, 0);
    });

    it('a branded `1 serving` is the menu item: never asked, today\'s bill', async () => {
        // MUTATION: fsFractionOneIsPortion() returns true for any label -> asks, bills the model's whole.
        const cfa = row('68721802', 'Chick-fil-A Chicken Sandwich', 'Chick-fil-A', 230, [
            { servingId: 's1', description: '1 serving', grams: 183 },
        ]);
        const r = await bill('half a chick-fil-a chicken sandwich', cfa);
        expect(r!.servingTier).toBe('fs_default_serving');
        expect(r!.grams).toBeCloseTo(91.5, 5);
        expect(mockGetOrCreateAmbiguousServing).not.toHaveBeenCalled();
    });

    it('a generic `1 serving (85 g)` is a portion', async () => {
        const chicken = row('1623', 'Chicken', null, 239, [{ servingId: 's1', description: '1 serving (85 g)', grams: 85 }]);
        mockGetOrCreateAmbiguousServing.mockResolvedValue({ status: 'success', grams: 1200 });
        const r = await bill('half a chicken', chicken);
        expect(r!.servingTier).toBe('fraction_whole_item');
        expect(r!.grams).toBe(600);
    });

    it('no serving at all (the per-100 g floor) is a portion', async () => {
        const melon = row('2476065', 'Melon', null, 34, [], { protein: 0.8, carbs: 8, fat: 0.2 });
        mockGetOrCreateAmbiguousServing.mockResolvedValue({ status: 'success', grams: 1000 });
        const r = await bill('half a melon', melon);
        expect(r!.servingTier).toBe('fraction_whole_item');
        expect(r!.grams).toBe(500);
    });

    it('a label naming the item (`1 muffin`) is answered by the noun match and never asked', async () => {
        const muffin = row('3379882', 'Blueberry Muffin', 'Costco', 360, [{ servingId: 's1', description: '1 muffin', grams: 162.4 }]);
        const r = await bill('half a costco muffin', muffin);
        expect(r!.servingTier).not.toBe('fraction_whole_item');
        expect(mockGetOrCreateAmbiguousServing).not.toHaveBeenCalled();
    });

    it('the record must be the item: `half an avocado` on `Avocado Oil` is never asked', async () => {
        // MUTATION: drop recordIsTheItem() from the block -> asks `whole` of the oil.
        const oil = row('9', 'Avocado Oil', null, 250, [{ servingId: 's1', description: '1 oz', grams: 28 }]);
        const r = await bill('half an avocado', oil);
        expect(r!.servingTier).toBe('fs_default_serving');
        expect(mockGetOrCreateAmbiguousServing).not.toHaveBeenCalled();
    });

    it('a dense panel (> 300 kcal/100 g) is declined before the estimate', async () => {
        // MUTATION: `if (declined)` -> `if (false)` -> asks and bills.
        const cookie = row('4012', 'Oat Bran Cookie', null, 440, [{ servingId: 's1', description: '1 oz', grams: 28 }]);
        const r = await bill('half an oat bran cookie', cookie);
        expect(r!.servingTier).toBe('fs_default_serving');
        expect(mockGetOrCreateAmbiguousServing).not.toHaveBeenCalled();
    });

    it('a named size asks that size', async () => {
        // MUTATION: `fractionSizeUnit(parsed) ?? 'whole'` -> `'whole'`.
        const pizza = row('77', 'Pepperoni Pizza', null, 270, [{ servingId: 's1', description: '100 g', grams: 100 }]);
        mockGetOrCreateAmbiguousServing.mockResolvedValue({ status: 'success', grams: 900 });
        const r = await bill('half a large pepperoni pizza', pizza);
        expect(mockGetOrCreateAmbiguousServing).toHaveBeenCalledWith('fs_77', 'Pepperoni Pizza', 'large', null);
        expect(r!.grams).toBe(450);
    });

    it.each([
        ['raise-only', 60],
        ['the 1.5x margin on a bare-mass label (84 g x 1.5 = 126)', 120],
        ['the 2,000 g cap', 2400],
    ])('%s refuses the estimate: today\'s 42 g stands', async (_why, whole) => {
        // MUTATION: `wholeAccepted(wholeGrams, oneGrams, label)` -> `wholeGrams != null`.
        mockGetOrCreateAmbiguousServing.mockResolvedValue({ status: 'success', grams: whole });
        const r = await bill('half a rotisserie chicken', WALMART_ROTISSERIE);
        expect(r!.servingTier).toBe('fs_default_serving');
        expect(r!.grams).toBe(42);
    });

    it('an estimate that fails keeps today\'s bill', async () => {
        mockGetOrCreateAmbiguousServing.mockResolvedValue({ status: 'error', error: 'AI estimation failed' });
        const r = await bill('half a rotisserie chicken', WALMART_ROTISSERIE);
        expect(r!.grams).toBe(42);
    });

    it.each([
        ['1/2 rotisserie chicken'],          // no article: a fraction of a portion
        ['half a glass of milk'],            // X of Y: the item is the container
        ['half the rotisserie chicken'],
    ])('`%s` is not a fraction of ONE item: never asked', async (line) => {
        await bill(line, WALMART_ROTISSERIE);
        expect(mockGetOrCreateAmbiguousServing).not.toHaveBeenCalled();
    });

    it('a whole-number line never reaches the rule', async () => {
        const r = await bill('rotisserie chicken', WALMART_ROTISSERIE);
        expect(mockGetOrCreateAmbiguousServing).not.toHaveBeenCalled();
        expect(r!.servingTier).not.toBe('fraction_whole_item');
    });
});

describe('kill switches', () => {
    it('SERVING_FRACTION_WHOLE_FS="0" turns the FatSecret half off', async () => {
        // MUTATION: fractionWholeFsEnabled() ignores SERVING_FRACTION_WHOLE_FS -> 650 g.
        process.env.SERVING_FRACTION_WHOLE_FS = '0';
        const r = await bill('half a rotisserie chicken', WALMART_ROTISSERIE);
        expect(r!.grams).toBe(42);
        expect(mockGetOrCreateAmbiguousServing).not.toHaveBeenCalled();
    });

    it('SERVING_FRACTION_WHOLE="0" turns both halves off', async () => {
        process.env.SERVING_FRACTION_WHOLE = '0';
        expect(fractionWholeFsEnabled()).toBe(false);
        const r = await bill('half a rotisserie chicken', WALMART_ROTISSERIE);
        expect(r!.grams).toBe(42);
    });

    it('unset means on', () => {
        expect(fractionWholeFsEnabled()).toBe(true);
    });
});

/**
 * r2 (s462 pd-wholefs2): the FatSecret half's own guards. The KEEP rows are the r1 WORSE members
 * (rf-wholefs MAJORs), each pinned to TODAY's bill; the BETTER rows r2 must not cost are pinned too.
 */
describe('r2 — a branded bare mass is a portion of one item only above 2 oz and up to 4 oz', () => {
    it('`half an applegate ... black forest ham` (`2 oz` 56 g, a slice of a package) is never asked: 28 g stands', async () => {
        // MUTATION: drop the branded_slice_label clause -> asks, bills 0.5 x 1300.
        const ham = row('62206', 'Natural Uncured Black Forest Ham', 'Applegate Farms', 89, [
            { servingId: '108244', description: '2 oz', grams: 56 },
        ]);
        const r = await bill('half an applegate farms natural uncured black forest ham', ham);
        expect(r!.servingTier).toBe('fs_default_serving');
        expect(r!.grams).toBe(28);
        expect(mockGetOrCreateAmbiguousServing).not.toHaveBeenCalled();
    });

    it('`half a dole acai bowl` (`6 oz` 170 g, the bowl itself) is never asked: 85 g stands', async () => {
        // MUTATION: drop the branded_package_label clause -> asks, bills 0.5 x 1300.
        const dole = row('19185700', 'Açaí Bowl', 'Dole', 135, [{ servingId: '18075561', description: '6 oz', grams: 170 }],
            { protein: 1, carbs: 25, fat: 3 });
        const r = await bill('half a dole acai bowl', dole);
        expect(r!.servingTier).toBe('fs_default_serving');
        expect(r!.grams).toBe(85);
        expect(mockGetOrCreateAmbiguousServing).not.toHaveBeenCalled();
    });

    it.each([
        ['`half a rotisserie chicken` (Wal-Mart `3 oz` 84 g)', 'half a rotisserie chicken', 'Rotisserie Chicken', 'Wal-Mart', '3 oz', 84, 1300, 650],
        ['`half a costco rotisserie chicken` (`3 oz` 85 g)', 'half a costco rotisserie chicken', 'Rotisserie Chicken', 'Costco', '3 oz', 85, 1200, 600],
        ['`half a great value chicken breast` (`6 oz` 112 g, the seed 174 g)', 'half a great value chicken breast',
            'Boneless Skinless Chicken Breast', 'Great Value', '6 oz', 112, 174, 87],
        ['`half a genuine steak house ribeye steak` (`6 oz` 112 g)', 'half a genuine steak house ribeye steak',
            'Beef Ribeye Steak', 'Genuine Steak House Brand', '6 oz', 112, 300, 150],
        ['the 4 oz edge: `half an aldi chuck roast` (`4 oz` 113 g)', 'half an aldi chuck roast',
            'USDA Choice Angus Beef Chuck Roast', 'Aldi', '4 oz', 113, 900, 450],
    ])('KEEP %s is asked and bills half the whole', async (_why, line, name, brand, desc, grams, whole, want) => {
        // MUTATION: FS_BRANDED_PORTION_LABEL_MAX_GRAMS 114 -> 112 declines the 113 g edge row.
        const rec = row('1', name, brand, 150, [{ servingId: 's1', description: desc, grams }]);
        mockGetOrCreateAmbiguousServing.mockResolvedValue({ status: 'success', grams: whole });
        const r = await bill(line, rec);
        expect(r!.servingTier).toBe('fraction_whole_item');
        expect(r!.grams).toBe(want);
    });

    it.each([
        ['`1 oz` cooked mango', 'half a cooked mango', 'Cooked Mango', '1 oz', 28.35, 336, 168],
        ['`6 oz` acai bowl', 'half an acai bowl', 'Acai Bowl', '6 oz', 170, 300, 150],
    ])('a GENERIC bare mass outside the band (%s) is still asked', async (_why, line, name, desc, grams, whole, want) => {
        // MUTATION: the band ignores the brand -> today's bill.
        const rec = row('2', name, null, 65, [{ servingId: 's1', description: desc, grams }], { protein: 0.5, carbs: 15, fat: 0.3 });
        mockGetOrCreateAmbiguousServing.mockResolvedValue({ status: 'success', grams: whole });
        const r = await bill(line, rec);
        expect(r!.servingTier).toBe('fraction_whole_item');
        expect(r!.grams).toBe(want);
    });
});

describe('r2 — a dried form is not the fresh item', () => {
    it('`half a dried apple` on `Dried Apple` (`1 serving (22 g)`) is never asked: 11 g stands', async () => {
        // MUTATION: drop the dried_form clause -> asks; the `apple` seed answers 182 -> 91 g.
        const dried = row('5327', 'Dried Apple', null, 243, [{ servingId: '19110', description: '1 serving (22 g)', grams: 22 }],
            { protein: 0.9, carbs: 66, fat: 0.3 });
        mockGetOrCreateAmbiguousServing.mockResolvedValue({ status: 'success', grams: 182 });
        const r = await bill('half a dried apple', dried);
        expect(r!.servingTier).toBe('fs_default_serving');
        expect(r!.grams).toBe(11);
        expect(mockGetOrCreateAmbiguousServing).not.toHaveBeenCalled();
    });

    it.each([
        [{ itemName: 'a dried apple', recordName: 'Apple' }, 'dried_form'],
        [{ itemName: 'a sun-dried tomato', recordName: 'Tomatoes' }, 'dried_form'],
        [{ itemName: 'a beef jerky', recordName: 'Beef Jerky' }, 'dried_form'],
        [{ itemName: 'a cake', recordName: 'Cake made with Glutinous Rice with Dried Beans' }, null],
        [{ itemName: 'a red cabbage', recordName: 'Red Cabbage' }, null],
    ])('fsFractionWholeDecline(%p) -> %p', (names, want) => {
        expect(fsFractionWholeDecline({ ...names, brandName: null, label: '1 serving (85 g)', oneGrams: 85 })).toBe(want);
    });
});

describe('r2 fsFractionWholeDecline — the branded band', () => {
    it.each([
        ['Applegate Farms', '2 oz', 56, 'branded_slice_label'],
        ['Pastene', '1 oz', 29, 'branded_slice_label'],
        ['Oscar Mayer', '2 oz', 57, 'branded_slice_label'],
        ['Costco', '3 oz', 85, null],
        ['Aldi', '4 oz', 113, null],
        ['Wal-Mart', '4 oz', 114, null],
        ['Market Day', '4.5 oz', 128, 'branded_package_label'],
        ['Dole', '6 oz', 170, 'branded_package_label'],
        ['  ', '2 oz', 56, null],
        [null, '6 oz', 170, null],
        ['Brand', '1 serving (170 g)', 170, null],
        ['Brand', null, 100, null],
    ])('brand %p label %p (%p g) -> %p', (brandName, label, oneGrams, want) => {
        expect(fsFractionWholeDecline({ itemName: 'a ham', recordName: 'Ham', brandName, label, oneGrams })).toBe(want);
    });
});

describe('s463 — a large fish asks the fillet, not the fish', () => {
    /** fs_38049's real shape (box, 2026-11-17): the `100 g` panel default is demoted, so `1 oz boneless` 28.35 g bills. */
    const SOCKEYE = row('38049', 'Sockeye Salmon', null, 168, [
        { servingId: '37218', description: '1 oz boneless', grams: 28.35 },
        { servingId: '37219', description: '1/2 fillet', grams: 198 },
    ]);
    /** fs_38000 (box): `3 oz` 85 g default; deploy 51 asked `whole` and billed `half a halibut` 750-1,000 g. */
    const HALIBUT = row('38000', 'Atlantic and Pacific Halibut', null, 110, [
        { servingId: 's1', description: '3 oz', grams: 85 },
    ]);

    it('`half a sockeye salmon` asks `fillet` and bills half of it', async () => {
        // MUTATION: `fractionSizeUnit(parsed) ?? fsFractionCutUnit(foodName) ?? 'whole'` -> `fractionSizeUnit(parsed) ?? 'whole'`.
        mockGetOrCreateAmbiguousServing.mockResolvedValue({ status: 'success', grams: 170 });
        const r = await bill('half a sockeye salmon', SOCKEYE);
        expect(mockGetOrCreateAmbiguousServing).toHaveBeenCalledWith('fs_38049', 'Sockeye Salmon', 'fillet', null);
        expect(r!.servingTier).toBe('fraction_whole_item');
        expect(r!.grams).toBe(85);
    });

    it('`half a halibut` on a `3 oz` label asks `fillet`; the 1.5x bare-mass margin still applies', async () => {
        mockGetOrCreateAmbiguousServing.mockResolvedValue({ status: 'success', grams: 200 });
        const r = await bill('half a halibut', HALIBUT);
        expect(mockGetOrCreateAmbiguousServing).toHaveBeenCalledWith('fs_38000', 'Atlantic and Pacific Halibut', 'fillet', null);
        expect(r!.grams).toBe(100);
        mockGetOrCreateAmbiguousServing.mockResolvedValue({ status: 'success', grams: 120 });
        const held = await bill('half a halibut', HALIBUT);
        expect(held!.servingTier).toBe('fs_default_serving');
        expect(held!.grams).toBe(42.5);
    });

    it('a named size still wins: `half a large salmon` asks `large`', async () => {
        mockGetOrCreateAmbiguousServing.mockResolvedValue({ status: 'success', grams: 300 });
        await bill('half a large sockeye salmon', SOCKEYE);
        expect(mockGetOrCreateAmbiguousServing).toHaveBeenCalledWith('fs_38049', 'Sockeye Salmon', 'large', null);
    });

    it('a canned fish asks `whole` (the can), a steelhead trout asks `fillet` (rf-fillet)', async () => {
        // MUTATION: CANNED_FISH_RE.test(name) -> false.
        const canned = row('2064', 'Canned Salmon', null, 144, [{ servingId: 's1', description: '1 oz', grams: 28.35 }]);
        mockGetOrCreateAmbiguousServing.mockResolvedValue({ status: 'success', grams: 213 });
        const r = await bill('half a canned salmon', canned);
        expect(mockGetOrCreateAmbiguousServing).toHaveBeenLastCalledWith('fs_2064', 'Canned Salmon', 'whole', null);
        expect(r!.grams).toBe(106.5);
        const steelhead = row('21578252', 'Steelhead Trout', null, 133, [{ servingId: 's1', description: '1 serving (85 g)', grams: 85 }]);
        await bill('half a steelhead trout', steelhead);
        expect(mockGetOrCreateAmbiguousServing).toHaveBeenLastCalledWith('fs_21578252', 'Steelhead Trout', 'fillet', null);
    });

    it('a small fish and a roast keep the `whole` ask', async () => {
        const trout = row('2093', 'Cooked Trout', null, 197, [{ servingId: 's1', description: '1 serving (85 g)', grams: 85 }]);
        const roast = row('1502', 'Pork Roast', null, 247, [{ servingId: 's1', description: '1 serving (85 g)', grams: 85 }]);
        await bill('half a cooked trout', trout);
        expect(mockGetOrCreateAmbiguousServing).toHaveBeenLastCalledWith('fs_2093', 'Cooked Trout', 'whole', null);
        await bill('half a pork roast', roast);
        expect(mockGetOrCreateAmbiguousServing).toHaveBeenLastCalledWith('fs_1502', 'Pork Roast', 'whole', null);
    });

    it.each([
        ['Sockeye Salmon', 'fillet'], ['Salmon', 'fillet'], ['Wild Atlantic Salmon', 'fillet'],
        ['Atlantic and Pacific Halibut', 'fillet'], ['Tuna', 'fillet'], ['Cod', 'fillet'], ['Haddock', 'fillet'],
        ['Baked or Broiled Swordfish', 'fillet'], ['Mahi-Mahi', 'fillet'], ['Wild Caught Pollock', 'fillet'],
        ['Salmon Burger', null], ['Tuna Salad', null], ['Salmon with Rice', null], ['Cooked Trout', null],
        ['Canned Salmon', null], ['Canned Tuna', null], ['Chunk Light Tuna (Pouch)', null], ['Tuna Steak', null],
        ['Steelhead Trout', 'fillet'], ['Steelhead', 'fillet'], ['Rainbow Trout', null], ['Cod Liver Oil', null],
        ['Sardines', null], ['Sea Bass', null], ['Pork Roast', null], ['Chicken', null], [null, null], ['', null],
    ])('fsFractionCutUnit(%p) -> %p', (name, want) => {
        // MUTATION: FILLET_FISH_HEADS.has(head) -> false.
        expect(fsFractionCutUnit(name)).toBe(want);
    });
});
