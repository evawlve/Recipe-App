/**
 * s461 WHOLE-ONE — `half a <item>` with no unit bills the fraction of the item's
 * `whole` weight when the record's "one" is a portion (serving/fraction-whole-item.ts).
 * Measured cold on deploy 46: `half a rotisserie chicken` 50 g (no label), `half a
 * sandwich` 18.5 g (`37.0g`), `quarter of a digiorno pepperoni pizza` 30.75 g (`1 | (123 g)`).
 * OFF only: buildFatSecretResult() is untouched (a FatSecret id has no serving table to
 * persist the estimate in, so it would re-ask the model on every request).
 */

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

import { buildOffResult } from '../map-ingredient-with-fallback';
import { hydrateOffCandidate } from '../../openfoodfacts/hydrate';
import { getOrCreateAmbiguousServing } from '../ambiguous-unit-backfill';
import { parseOffServingSize } from '../../openfoodfacts/serving-resolver';
import { parseIngredientLine } from '../../parse/ingredient-line';
import {
    FRACTION_WHOLE_MAX_GRAMS, fractionOneShape, fractionSizeUnit, fractionWholeDecline, isFractionOfAnItem,
    recordIsTheItem, wholeAccepted, wholeBeatsPortion,
} from '../serving/fraction-whole-item';

const amb = getOrCreateAmbiguousServing as jest.Mock;

function offRun(rawLine: string, foodName: string, servingSize: string | null, servingGrams: number | null,
    id = 'off_0218359300577', parseText?: string, per100: Record<string, number> = { calories: 150, protein: 20, carbs: 0, fat: 8 }) {
    const label = servingSize ? parseOffServingSize(servingSize, servingGrams ?? 0) : { grams: null, description: null, unitCount: null };
    (hydrateOffCandidate as jest.Mock).mockResolvedValue({
        foodId: id, foodName, brandName: null,
        nutrientsPer100g: per100,
        servingGrams: label.grams, servingDescription: label.description, servingUnitCount: label.unitCount,
        packageQuantity: null, packageQuantityUnit: null,
    });
    const parsed = parseIngredientLine(parseText ?? rawLine);
    return buildOffResult({ id, source: 'openfoodfacts', name: foodName, score: 1, foodType: 'generic', rawData: {} } as any,
        parsed, 0.9, rawLine);
}

const ENV = process.env.SERVING_FRACTION_WHOLE;
beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.SERVING_FRACTION_WHOLE;
    amb.mockResolvedValue({ status: 'success', grams: 1200 });
});
afterAll(() => { if (ENV === undefined) delete process.env.SERVING_FRACTION_WHOLE; else process.env.SERVING_FRACTION_WHOLE = ENV; });

describe('isFractionOfAnItem — the line asks for a fraction of ONE item', () => {
    it.each([
        'half a rotisserie chicken', 'half an avocado', 'half of a sandwich', '1/2 a bagel', '1/4 an onion',
        'about half a pizza', 'quarter of a digiorno pepperoni pizza',
    ])('fires: %s', (line) => {
        expect(isFractionOfAnItem(parseIngredientLine(line), line)).toBe(true);
    });
    // s463 WORD-FRACTION-COUNT-NOUN (QTY-35): these parsed qty 1 (or 3 `quarters`); the parser now
    // reads them as the fraction, so the rule sees them on the raw line, as it sees the twin.
    it.each([
        ['a quarter of a pizza', '1/4 pizza'], ['three quarters of a burrito', '3/4 burrito'],
        ['a half of a banana', '1/2 banana'],
    ])('fires on the QTY-35 twin parse: %s', (raw, twin) => {
        expect(isFractionOfAnItem(parseIngredientLine(raw), raw)).toBe(true);
        expect(isFractionOfAnItem(parseIngredientLine(twin), raw)).toBe(true);
    });
    it.each([
        '1/2 muffin', '1/4 rotisserie chicken', 'half the cream cheese', 'half of it', 'the remaining half of the lasagna',
        'half sweet tea', '1/2 dressing on the side', 'half to three quarters of a bagel', 'half a cup of rice',
        'a banana', 'one and a half bananas',
    ])('declines: %s', (line) => {
        expect(isFractionOfAnItem(parseIngredientLine(line), line)).toBe(false);
    });
    it.each(['half a glass of milk', 'half an order of fries', 'half a 2 liter of mountain dew', 'half a rack of ribs'])(
        'declines an X-of-Y container item: %s', (line) => {
            // MUTATION M3: drop the `\bof\b` item check -> these fire.
            expect(isFractionOfAnItem(parseIngredientLine(line), line)).toBe(false);
        });
    it('reads the article from the RAW line, so a rewritten parse still qualifies', () => {
        const raw = 'a quarter of a costco rotisserie chicken';
        expect(isFractionOfAnItem(parseIngredientLine('1/4 costco rotisserie chicken'), raw)).toBe(true);
        expect(isFractionOfAnItem(parseIngredientLine('1/4 costco rotisserie chicken'), '1/4 costco rotisserie chicken')).toBe(false);
    });
});

describe('fractionOneShape — is the record\'s "one" a portion?', () => {
    it.each([
        [null, 'a rotisserie chicken'], ['3 oz', 'a rotisserie chicken'], ['177 g', 'a cantaloupe'],
        ['100.0g', 'a pizza'], ['1 portion (85.048 g)', 'a rotisserie chicken'], ['1 | (123 g)', 'a pizza'],
        ['1 serving (85 g)', 'a chicken'],
    ])('portion: %s on %s', (d, item) => expect(fractionOneShape(d, item)).toBe('portion'));
    it.each([
        ['1 muffin', 'a costco muffin'], ['1 medium (7" to 7-7/8" long)', 'a banana'], ['1/8 pie', 'a pumpkin pie'],
        ['1 sandwich', 'a sandwich'], ['1 slice', 'a cheese slice'], ['1 bar (40 g)', 'a snickers bar'],
        // MUTATION M5: add 'slice' to PORTION_WORDS -> this row reads 'portion'.
        ['1 slice (74 g)', 'a cookies and creme pop-tart'], ['1 piece (1/8 9" dia)', 'an apple pie'],
        ['1 can (355 ml)', 'a celsius'],
    ])('whole: %s on %s', (d, item) => expect(fractionOneShape(d, item)).toBe('whole'));
    it.each([['1 cup', 'a glass of milk'], ['240 ml', 'a lemonade'], ['8 fl oz', 'a juice']])(
        'volume: %s', (d, item) => expect(fractionOneShape(d, item)).toBe('volume'));
});

describe('wholeBeatsPortion — raise-only', () => {
    it('takes a heavier whole, refuses a lighter or missing one', () => {
        expect(wholeBeatsPortion(1200, 85)).toBe(true);
        expect(wholeBeatsPortion(69, 177)).toBe(false);
        expect(wholeBeatsPortion(177, 177)).toBe(false);
        expect(wholeBeatsPortion(null, 85)).toBe(false);
    });
});

describe('buildOffResult — fraction_whole_item', () => {
    it('1/3 of a portion-labelled rotisserie chicken bills 1/3 x the whole (QTY-35 twin parse, raw line kept)', async () => {
        const r = await offRun('a third of a sams club rotisserie chicken', 'Rotisserie Chicken', '1 portion (85.048 g)', 85.048,
            'off_0218359300577', '1/3 sams club rotisserie chicken');
        expect(r?.servingTier).toBe('fraction_whole_item');
        expect(r?.grams).toBeCloseTo(400, 0);
        expect(amb).toHaveBeenCalledWith('off_0218359300577', 'Rotisserie Chicken', 'whole', expect.anything());
    });
    it('half a rotisserie chicken with no label bills half the whole, not 50 g', async () => {
        // MUTATION M1: delete the OFF block -> flat_100g_default 50 g.
        const r = await offRun('half a rotisserie chicken', 'Rotisserie chicken', null, null, 'off_0299838006500');
        expect(r?.servingTier).toBe('fraction_whole_item');
        expect(r?.grams).toBeCloseTo(600, 0);
    });
    it('raise-only: a whole lighter than the label keeps qty x label (cantaloupe 69 g vs 177 g)', async () => {
        // MUTATION M2: make wholeBeatsPortion() return true -> 23 g.
        amb.mockResolvedValue({ status: 'success', grams: 69 });
        const r = await offRun('a third of a cantaloupe', 'Cantaloupe', '177 g', 177, 'off_7422832043261', '1/3 cantaloupe');
        expect(r?.servingTier).toBe('label_serving_default');
        expect(r?.grams).toBeCloseTo(59, 0);
    });
    it('an estimator error keeps today', async () => {
        amb.mockResolvedValue({ status: 'error' });
        const r = await offRun('half a rotisserie chicken', 'Rotisserie chicken', null, null, 'off_0299838006500');
        expect(r?.servingTier).toBe('flat_100g_default');
        expect(r?.grams).toBeCloseTo(50, 0);
    });
    it('a label naming the item is a whole item: half a muffin on "1 muffin (113 g)" is not asked', async () => {
        const r = await offRun('half a blueberry muffin', 'Blueberry muffin', '1 muffin (113 g)', 113, 'off_0864710000862');
        expect(r?.servingTier).toBe('label_serving_default');
        expect(r?.grams).toBeCloseTo(56.5, 1);
        expect(amb).not.toHaveBeenCalled();
    });
    it('a volume label keeps today: half a lemonade on "240 ml"', async () => {
        const r = await offRun('half a lemonade', 'Lemonade', '240 ml', 240, 'off_0011110506351');
        expect(r?.servingTier).not.toBe('fraction_whole_item');
        expect(amb).not.toHaveBeenCalled();
    });
    it('no article keeps today: 1/2 spaghetti on "100 g"', async () => {
        const r = await offRun('1/2 spaghetti', 'Spaghetti', '100 g', 100, 'off_4902121239306');
        expect(r?.servingTier).toBe('label_serving_default');
        expect(r?.grams).toBeCloseTo(50, 0);
        expect(amb).not.toHaveBeenCalled();
    });
    it('a unit keeps today: half a cup of rice is not touched', async () => {
        const r = await offRun('half a cup of rice', 'Rice', '100 g', 100, 'off_0000000000017');
        expect(r?.servingTier).not.toBe('fraction_whole_item');
    });
    it('a whole count keeps today: a rotisserie chicken (qty 1)', async () => {
        const r = await offRun('a rotisserie chicken', 'Rotisserie Chicken', '1 portion (85.048 g)', 85.048);
        expect(r?.servingTier).not.toBe('fraction_whole_item');
    });
    it('kill switch SERVING_FRACTION_WHOLE=0 restores today', async () => {
        process.env.SERVING_FRACTION_WHOLE = '0';
        const r = await offRun('half a rotisserie chicken', 'Rotisserie chicken', null, null, 'off_0299838006500');
        expect(r?.servingTier).toBe('flat_100g_default');
        expect(amb).not.toHaveBeenCalled();
    });
    it('a synthetic-barcode chain record keeps its label: half a taco bell mexican pizza on "100g"', async () => {
        // MUTATION M6: drop `!syntheticChainLabel` -> fraction_whole_item, 0.5 x 1200 g.
        const r = await offRun('half a taco bell mexican pizza', 'Taco Bell, Mexican Pizza', '100g', 100, 'off_6167851048066382');
        expect(r?.servingTier).toBe('label_serving_default');
        expect(r?.grams).toBeCloseTo(50, 0);
        expect(amb).not.toHaveBeenCalled();
    });
    it('a real-GTIN record with a mass label is asked: half a sandwich on "37.0g"', async () => {
        amb.mockResolvedValue({ status: 'success', grams: 180 });
        const r = await offRun('half a sandwich', 'Sandwich', '37.0g', 37, 'off_6040590701066');
        expect(r?.servingTier).toBe('fraction_whole_item');
        expect(r?.grams).toBeCloseTo(90, 0);
    });
    it('a record MADE FROM the item is not asked: half an avocado on "Avocado Oil" keeps 7.5 g (rf-whole replay: 250 g)', async () => {
        // MUTATION M9: drop the recordIsTheItem() check -> fraction_whole_item, 0.5 x 1200 g.
        const r = await offRun('half an avocado', 'Avocado Oil', '1 serving (15 g)', 15, 'off_0041618502142');
        expect(r?.servingTier).toBe('label_serving_default');
        expect(r?.grams).toBeCloseTo(7.5, 1);
        expect(amb).not.toHaveBeenCalled();
    });
});

describe('recordIsTheItem — the record and the line share a head word (s461 rf-whole)', () => {
    it.each([
        ['Rotisserie Chicken', 'costco rotisserie chicken'], ['Pepperoni Pizza', 'of a digiorno pepperoni pizza'],
        ['Big mac', 'mcdonalds big mac'], ['Pop-tarts', 'pop-tart'], ['Bell Peppers', 'bell pepper'], ['Hot Pockets', 'hot pocket'],
        ["Wendy's Baconator", 'wendys baconator'], ['Chipotle steak bowl', 'chipotle steak burrito bowl'],
        ['Original Bagels With Cream Cheese', 'bagel with cream cheese'],
    ])('same item: %s / %s', (rec, item) => expect(recordIsTheItem(rec, item)).toBe(true));
    it.each([
        ['Avocado Oil', 'avocado'], ['Muffin mix', 'muffin'], ['Lemon Juice', 'lemon'], ['Cookie Dough', 'cookie'],
        ['85% Lean Ground Beef', 'hamburger'], ['Brisket', 'brisket plate'], ['Beef Chili and Beans', 'beef and bean chili dog'],
        ['Sugar Free Jello', 'sugar free jello cup'], ['Guacamole', 'avocado'], ['Pizza', ''], ['', 'pizza'],
    ])('another product: %s / %s', (rec, item) => expect(recordIsTheItem(rec, item)).toBe(false));
});

describe('r2 (s461 pd-whole2) — the four held-out WORSE classes, each a class guard that keeps today', () => {
    const decline = (line: string, record: string, per100: Record<string, number> | null) =>
        fractionWholeDecline({ itemName: parseIngredientLine(line)?.name, recordName: record, rawLine: line, per100 });

    it('PANEL: a dry-mix / powder / spread panel is never a prepared whole item (Harvest Grain Bowl 403 kcal/100 g)', async () => {
        // MUTATION M10: drop the FRACTION_WHOLE_MAX_KCAL_PER_100G check -> fraction_whole_item, 0.5 x 1200 g.
        const r = await offRun('half a grain bowl', 'Harvest Grain Bowl', null, null, 'off_0000000000101', undefined,
            { calories: 403, protein: 12, carbs: 70, fat: 8 });
        expect(r?.servingTier).toBe('flat_100g_default');
        expect(r?.grams).toBeCloseTo(50, 0);
        expect(amb).not.toHaveBeenCalled();
    });
    it('PANEL: a panel the rank-time drink rules call implausible is declined (Vietnamese iced coffee at 220)', () => {
        // MUTATION M11: drop the assessRankTimePlausibility() check -> null.
        expect(decline('half a vietnamese iced coffee', 'Vietnamese iced coffee', { calories: 220, protein: 3, carbs: 40, fat: 5 }))
            .toBe('implausible_panel');
        expect(decline('half a vietnamese iced coffee', 'Vietnamese iced coffee', { calories: 90, protein: 2, carbs: 16, fat: 2 }))
            .toBeNull();
    });
    it('PANEL: a water-rich prepared panel passes (rotisserie chicken 161, pizza 215, Big Mac 242)', () => {
        expect(decline('half a rotisserie chicken', 'Rotisserie Chicken', { calories: 161, protein: 22, carbs: 0, fat: 8 })).toBeNull();
        expect(decline('half a pizza', 'Pizza', { calories: 215, protein: 9, carbs: 27, fat: 8 })).toBeNull();
        expect(decline('half a big mac', 'Big Mac', { calories: 242, protein: 12, carbs: 20, fat: 13 })).toBeNull();
    });
    it.each([
        ['half a kid size mac and cheese', 'Mac and Cheese'], ['half a mini muffin', 'Muffin'],
        ['half a little rice on the side', 'White Rice'], ['half a fun size snickers', 'Snickers'],
    ])('SIZE: a below-standard size has no unit to ask and keeps today: %s', (line, record) => {
        // MUTATION M12: empty BELOW_STANDARD_SIZE -> null.
        expect(decline(line, record, { calories: 140 })).toBe('below_standard_size');
    });
    it('SIZE: a standard size asks its own unit, read from the parser qualifiers (`a fries` + small)', async () => {
        // MUTATION M15: ask 'whole' instead of fractionSizeUnit() -> called with 'whole'.
        amb.mockResolvedValue({ status: 'success', grams: 800 });
        const r = await offRun('half a large pizza', 'Pizza', '326 g (0.5 PIZZA)', 326, 'off_0856497004010', undefined,
            { calories: 215, protein: 9, carbs: 27, fat: 8 });
        expect(amb).toHaveBeenCalledWith('off_0856497004010', 'Pizza', 'large', expect.anything());
        expect(r?.servingTier).toBe('fraction_whole_item');
        expect(r?.grams).toBeCloseTo(400, 0);
        expect(fractionSizeUnit(parseIngredientLine('half a small fries'))).toBe('small');
        expect(fractionSizeUnit(parseIngredientLine('half a med apple'))).toBe('medium');
        expect(fractionSizeUnit(parseIngredientLine('half a vanilla milkshake, medium'))).toBe('medium');
        expect(fractionSizeUnit(parseIngredientLine('half a rotisserie chicken'))).toBeNull();
    });
    it('PACKAGE: a line naming a package keeps today (half a small container smuckers blackberry)', () => {
        // MUTATION M13: empty PACKAGE_WORDS -> null.
        expect(decline('half a small container smuckers blackberry', 'Strawberry jelly', { calories: 250 })).toBe('package');
    });
    it('PACKAGE: a bottle-sold pour keeps today (half a vodka on `1 portion (42.524 g)` is not half the bottle)', async () => {
        // MUTATION M14: drop the BOTTLE_POUR_RE check -> fraction_whole_item, 0.5 x 750 g.
        amb.mockResolvedValue({ status: 'success', grams: 750 });
        const r = await offRun('half a vodka', 'Vodka', '1 portion (42.524 g)', 42.524, 'off_0000000000102', undefined,
            { calories: 231, protein: 0, carbs: 0, fat: 0 });
        expect(r?.servingTier).toBe('label_serving_default');
        expect(r?.grams).toBeCloseTo(21.3, 1);
        expect(amb).not.toHaveBeenCalled();
    });
    it('MARGIN: a bare-mass label within 1.5x of the whole may BE the item (half a baked potato on `173.0g`)', async () => {
        // MUTATION M16: drop the BARE_MASS_WHOLE_MARGIN check -> fraction_whole_item, 0.5 x 213 g.
        amb.mockResolvedValue({ status: 'success', grams: 213 });
        const r = await offRun('half a baked potato', 'Baked potato', '173.0g', 173, 'off_0000000000103', undefined,
            { calories: 161, protein: 4, carbs: 37, fat: 0.2 });
        expect(r?.servingTier).toBe('label_serving_default');
        expect(r?.grams).toBeCloseTo(86.5, 1);
    });
    it('MARGIN: reads the normalizer\'s `1 serving` as a bare mass, and never applies to a real `portion` label', () => {
        expect(wholeAccepted(213, 173, '1 serving')).toBe(false);
        expect(wholeAccepted(180, 37, '1 serving')).toBe(true);
        expect(wholeAccepted(130, 123, '123 g')).toBe(false);
        expect(wholeAccepted(150, 113, '1 portion (113 g)')).toBe(true);
        expect(wholeAccepted(150, 100, null)).toBe(true);
    });
    it('CAP: a whole above FRACTION_WHOLE_MAX_GRAMS is a roast or a multipack and keeps today (Roast Turkey 3,000 g)', async () => {
        // MUTATION M17: drop the FRACTION_WHOLE_MAX_GRAMS check -> fraction_whole_item, 1,500 g.
        amb.mockResolvedValue({ status: 'success', grams: 3000 });
        const r = await offRun('half a roast turkey', 'Roast Turkey', null, null, 'off_0000000000104', undefined,
            { calories: 135, protein: 25, carbs: 0, fat: 3 });
        expect(r?.servingTier).toBe('flat_100g_default');
        expect(r?.grams).toBeCloseTo(50, 0);
        expect(wholeAccepted(FRACTION_WHOLE_MAX_GRAMS, 100, null)).toBe(true);
    });
});
