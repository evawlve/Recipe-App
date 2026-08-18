/**
 * The label reader can read a FRACTION — both halves, end to end.
 *
 * `extractLabelServingUnit()` read only the leading token and could not parse a
 * fraction: for `1/2 cup (110 g)` the `\d*` consumed `1`, `/` is not `[a-z]`,
 * and it returned null. The record's own label therefore said nothing, so
 * `buildOffResult()`'s `labelUnitWord` was null and every branch keyed on it
 * stayed off. Measured on the box 2026-08-18 over all 1,085,526 `OffFood`
 * rows: 16,531 records change from null to a unit word, of which 15,534 (94%)
 * are a volume word (cup 15,152, tsp 204, tbsp 170). ZERO records change from
 * one word to a DIFFERENT word — the new arms only ever fire where the old
 * regex matched nothing, which is why this is an extension and not a rewrite.
 *
 * THE COUNT MATTERS AS MUCH AS THE UNIT. `perLabelUnitGrams` is
 * `hydrated.servingGrams / labelUnitCount` (hydration-lane.ts:2601-2606) and
 * `labelUnitCount` comes from `parseOffServingSize()`'s `unitCount`, whose
 * `leadingCount()` was the same leading-integer read. A fix that returned the
 * unit and left the count at 1 would bill `1/2 cup (110 g)` as 110 g per cup —
 * half the truth, and wrong in the OPPOSITE direction from today's 120 g class
 * constant, i.e. worse than the defect. Both halves are pinned here.
 *
 * THE FATSECRET SIDE'S CONTROL IS ALREADY IN THE TREE, unmodified:
 * `build-fatsecret-result-demoted-default.test.ts`'s n-mq-47 block runs
 * `fs_4881229`, whose `1/2 breast, bone and skin removed` row is precisely a
 * fraction-led serving this PR makes readable. It stays at 90 / 236 / 472 g
 * because `buildFatSecretResult`'s head-token scan (`servingMatchesNoun`,
 * build-fatsecret-result.ts:618) tokenizes the WHOLE description and already
 * matched that row — the `extractLabelServingUnit` loop at :644 only runs when
 * that scan finds nothing. If that file moves under this change, the claim that
 * :618 pre-empts :644 is wrong.
 *
 * Fixtures are REAL rows, read from the box 2026-08-18 (`OffFood.barcode`,
 * `.servingSize`, `.servingGrams` verbatim); the headline `off_0081312620001`
 * carries 62 live `MappingEventLog` events, all `volume_unit`.
 */

const mockOffFoodFindUnique = jest.fn();

jest.mock('../../db', () => ({
    prisma: {
        $queryRaw: jest.fn().mockResolvedValue([]),
        $queryRawUnsafe: jest.fn().mockResolvedValue([]),
        offFood: {
            findUnique: (...args: unknown[]) => mockOffFoodFindUnique(...args),
            findMany: jest.fn().mockResolvedValue([]),
        },
        offServing: { upsert: jest.fn().mockResolvedValue({}), findMany: jest.fn().mockResolvedValue([]) },
        fdcFood: { findMany: jest.fn().mockResolvedValue([]), findUnique: jest.fn().mockResolvedValue(null) },
        aiGeneratedFood: {
            findMany: jest.fn().mockResolvedValue([]),
            findFirst: jest.fn().mockResolvedValue(null),
            findUnique: jest.fn().mockResolvedValue(null),
        },
        foodMapping: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    },
}));

jest.mock('../ambiguous-unit-backfill', () => {
    const actual = jest.requireActual('../ambiguous-unit-backfill');
    return { ...actual, getOrCreateAmbiguousServing: jest.fn() };
});

import { buildOffResult } from '../map-ingredient-with-fallback';
import { hydrateOffCandidate } from '../../openfoodfacts/hydrate';
import { parseOffServingSize } from '../../openfoodfacts/serving-resolver';
import { extractLabelServingUnit } from '../count-label';
import { usableBareLabelServing } from '../../servings/bare-query-guard';
import { getOrCreateAmbiguousServing } from '../ambiguous-unit-backfill';
import type { ParsedIngredient } from '../../parse/ingredient-line';

/** A real OffFood row, as `hydrateOffCandidate`'s cache-first branch reads it. */
function offRow(over: Record<string, unknown>) {
    return {
        barcode: '0000000000000',
        name: 'Food',
        brandName: null,
        nutrientsPer100g: { calories: 100, protein: 5, carbs: 10, fat: 3 },
        servingSize: null,
        servingGrams: null,
        packageQuantity: null,
        packageQuantityUnit: null,
        ...over,
    };
}

function candidate(barcode: string, name: string) {
    return {
        id: `off_${barcode}`,
        source: 'openfoodfacts' as const,
        name,
        score: 1,
        foodType: 'generic',
        rawData: { barcode, name },
    } as any;
}

function parsedLine(over: Partial<ParsedIngredient>): ParsedIngredient {
    return { qty: 1, multiplier: 1, unit: null, name: '', ...over } as ParsedIngredient;
}

beforeEach(() => {
    jest.clearAllMocks();
    (getOrCreateAmbiguousServing as jest.Mock).mockResolvedValue({ status: 'error', grams: null });
});

// ============================================================
// 1. The headline record — both halves compose to 220 g per cup
// ============================================================

describe('off_0081312620001 "Cottage cheese" — label "1/2 cup (110 g)"', () => {
    it('reads the unit AND the count, so a cup is 220 g and not 110 g', async () => {
        mockOffFoodFindUnique.mockResolvedValue(offRow({
            barcode: '0081312620001',
            name: 'Cottage cheese',
            servingSize: '1/2 cup (110 g)',
            servingGrams: 110,
            nutrientsPer100g: { calories: 98, protein: 11, carbs: 3.4, fat: 4.3 },
        }));

        const hydrated = await hydrateOffCandidate(candidate('0081312620001', 'Cottage cheese'));

        // THE UNIT HALF. Null on origin/master — `\d*` eats the `1`, `/` is not
        // `[a-z]`, no match.
        expect(extractLabelServingUnit(hydrated.servingDescription)).toBe('cup');

        // THE COUNT HALF. 1 on origin/master — `leadingCount()`'s
        // `^\s*(\d+(?:\.\d+)?)` reads the numerator and stops.
        expect(hydrated.servingUnitCount).toBe(0.5);

        // The composition is `perLabelUnitGrams` verbatim
        // (hydration-lane.ts:2604-2606). 220 g/cup is USDA's cottage-cheese cup
        // (226 g); the class constant that bills it today is 120 g.
        expect(hydrated.servingGrams! / hydrated.servingUnitCount).toBe(220);
    });

    it('CONTROL: a cup request still bills the class constant on this branch', async () => {
        // `volumeToGrams` is consulted BEFORE `label_unit_match`
        // (hydration-lane.ts:2668 vs :2672), so reading the label does not by
        // itself change what `1 cup cottage cheese` bills. Flipping that
        // precedence is Lane A's change, not this one; this pin exists so the
        // two lanes cannot silently claim each other's delta.
        mockOffFoodFindUnique.mockResolvedValue(offRow({
            barcode: '0081312620001',
            name: 'Cottage cheese',
            servingSize: '1/2 cup (110 g)',
            servingGrams: 110,
            nutrientsPer100g: { calories: 98, protein: 11, carbs: 3.4, fat: 4.3 },
        }));

        const r = await buildOffResult(
            candidate('0081312620001', 'Cottage cheese'),
            parsedLine({ qty: 1, unit: 'cup', name: 'cottage cheese' }),
            0.9,
            '1 cup cottage cheese',
        );
        expect(r?.servingTier).toBe('volume_unit');
    });
});

// ============================================================
// 2. End to end through buildOffResult — the count reaches the BILL
// ============================================================

describe('the fractional count reaches the billed grams', () => {
    it('off_0013562102945 "1/12 package (50 g mix)" bills a whole package at 600 g', async () => {
        // RED on origin/master: `labelUnitWord` null, so `label_unit_match` is
        // skipped and `label_serving_package_unit` bills 1 x servingGrams =
        // 50 g — one TWELFTH of a package, sold as a whole one. The label
        // states the divisor; reading it is the fix.
        mockOffFoodFindUnique.mockResolvedValue(offRow({
            barcode: '0013562102945',
            name: 'Organic confetti cake baking mix',
            servingSize: '1/12 package (50 g mix) (50 g)',
            servingGrams: 50,
            nutrientsPer100g: { calories: 380, protein: 4, carbs: 78, fat: 5 },
        }));

        const r = await buildOffResult(
            candidate('0013562102945', 'Organic confetti cake baking mix'),
            parsedLine({ qty: 1, unit: 'package', name: 'organic confetti cake baking mix' }),
            0.9,
            '1 package organic confetti cake baking mix',
        );

        expect(r?.servingTier).toBe('label_unit_match');
        expect(r?.grams).toBeCloseTo(600, 6);
    });

    it('off_0002430083723 "1 1/3 cookie (28 g)" derives 21 g per cookie', async () => {
        // The MIXED-NUMBER arm, and the `label_count_derived` branch. OFF uses
        // mixed numbers: 1,196 rows lead with one (measured 2026-08-18). RED on
        // origin/master: `labelUnitWord` null, `labelCountsUserPiece` false,
        // resolution falls through to the generic cookie seed.
        mockOffFoodFindUnique.mockResolvedValue(offRow({
            barcode: '0002430083723',
            name: 'Chocolate Chip Soft Baked Cookie',
            servingSize: '1 1/3 cookie (28 g)',
            servingGrams: 28,
            nutrientsPer100g: { calories: 440, protein: 5, carbs: 60, fat: 20 },
        }));

        const r = await buildOffResult(
            candidate('0002430083723', 'Chocolate Chip Soft Baked Cookie'),
            parsedLine({ qty: 2, unit: null, name: 'chocolate chip cookie' }),
            0.9,
            '2 chocolate chip cookies',
        );

        expect(r?.servingTier).toBe('label_count_derived');
        expect(r?.grams).toBeCloseTo(2 * (28 / (4 / 3)), 6);   // 2 x 21 g
    });
});

// ============================================================
// 3. The mixed-number and fraction shapes at the resolver
// ============================================================

describe('parseOffServingSize — the leading quantity', () => {
    it('a plain fraction divides the label serving', () => {
        expect(parseOffServingSize('1/2 cup (110 g)', 110).unitCount).toBe(0.5);
        expect(parseOffServingSize('1/4 cup (37 g)', 37).unitCount).toBe(0.25);
        expect(parseOffServingSize('2/3 cup (100 g)', 100).unitCount).toBeCloseTo(2 / 3, 12);
    });

    it('a mixed number reads as whole + fraction ("1 1/4 cup" = 1.25)', () => {
        expect(parseOffServingSize('1 1/4 cup (40 g)', 40).unitCount).toBe(1.25);
        expect(parseOffServingSize('1 1/2 Tbsp (23 g)', 23).unitCount).toBe(1.5);
    });

    it('CONTROL: a mixed number with a whole part above 1 keeps the OLD read', () => {
        // The whole-part-1 guard. `320 1/2 package (320 g)` is the gram figure
        // glued to the front and `4 1/4 fillet (113 g)` is 4.25 OUNCES; both
        // divide the serving by its own weight if read as counts. Refusing
        // restores the shipped behaviour exactly, in BOTH halves at once.
        expect(parseOffServingSize('320 1/2 package (320 g)', 320).unitCount).toBe(320);
        expect(parseOffServingSize('4 1/4 fillet (113 g)', 113).unitCount).toBe(4);
        expect(parseOffServingSize('2 1/2 cup (85 g)', 85).unitCount).toBe(2);
    });

    it('CONTROL: whitespace inside the fraction keeps the OLD read, in both halves', () => {
        // 21 rows. If only the unit half saw it, "1 /3 cup (151 g)" would bill
        // 151 g/cup against a 453 g truth — this PR's own defect, in miniature.
        expect(parseOffServingSize('1 /3 cup (151 g)', 151).unitCount).toBe(1);
        expect(extractLabelServingUnit(parseOffServingSize('1 /3 cup (151 g)', 151).description)).toBeNull();
    });

    it('integers and decimals are unchanged', () => {
        expect(parseOffServingSize('2 tbsp (30 g)', 30).unitCount).toBe(2);
        expect(parseOffServingSize('18 chips (28 g)', 28).unitCount).toBe(18);
        expect(parseOffServingSize('2.5 oz (71 g)', 71).unitCount).toBe(2.5);
        expect(parseOffServingSize('1 container (170g)', 170).unitCount).toBe(1);
        expect(parseOffServingSize('170g', 170).unitCount).toBe(1);        // → "1 serving"
    });

    it('CONTROL: a hyphen range still reads its FIRST number, not the average', () => {
        // `parseQuantityTokens` averages a range ("2-3" → 2.5). A serving label
        // is not a recipe line and the averaging was never measured against
        // one, so the leading-quantity match refuses any numeric run followed
        // by `-`, `/` or another digit. 405 OffFood rows lead with a hyphen
        // shape (measured 2026-08-18) and NONE of them moves.
        expect(parseOffServingSize('2-3 Tbsp (35 g)', 35).unitCount).toBe(2);
        expect(parseOffServingSize('4 -5 HEARTS (130 g)', 130).unitCount).toBe(4);
        // "1-1/4 cup" is a hyphen-written MIXED number that reads as 1 both
        // before and after — deliberately still not fixed, and named as such.
        expect(parseOffServingSize('1-1/4 cup (85 g)', 85).unitCount).toBe(1);
    });

    it('CONTROL: a word-number label still defaults to 1', () => {
        // `parseQuantityTokens` knows "one"/"two"/"a dozen"; the leading-quantity
        // match requires a DIGIT, so the 241 word-leading rows are untouched.
        expect(parseOffServingSize('One Slice (50g)', 50).unitCount).toBe(1);
        expect(parseOffServingSize('Two 1" balls of dough (32 g)', 32).unitCount).toBe(1);
    });
});

// ============================================================
// 4. Blast radius — the branches `labelUnitWord` feeds
// ============================================================

describe('blast radius of a label word that now exists', () => {
    it('CONTROL: the live label_serving_package_unit record does not move', async () => {
        // off_0039978031600 "Instant rolled oats" is the ONLY record in the
        // moving population with live traffic on a non-volume tier: 360
        // `label_serving_package_unit` events in 30 days, all from
        // "1 packet instant oatmeal", all billing 32 g. Its label word becomes
        // `cup`, the request's unit is `packet`, so `label_unit_match`'s
        // `singularizeUnit(unit) === labelUnitWord` stays false and the bill is
        // unchanged. If this moves, 360 events/month moved with it.
        mockOffFoodFindUnique.mockResolvedValue(offRow({
            barcode: '0039978031600',
            name: 'Instant rolled oats',
            servingSize: '1/3 cup (32 g)',
            servingGrams: 32,
            nutrientsPer100g: { calories: 379, protein: 13, carbs: 67, fat: 7 },
        }));

        const r = await buildOffResult(
            candidate('0039978031600', 'Instant rolled oats'),
            parsedLine({ qty: 1, unit: 'packet', name: 'instant oatmeal' }),
            0.9,
            '1 packet instant oatmeal',
        );

        expect(r?.servingTier).toBe('label_serving_package_unit');
        expect(r?.grams).toBe(32);
    });

    it('the bare-request guard now sees the household unit on an exactly-100 g label', () => {
        // `usableBareLabelServing` rejects a 100 g serving with NO unit word as
        // the EU per-100g panel placeholder, and its own docstring says
        // "A genuine `1 cup (100 g)` passes via its unit word". A fraction-led
        // cup label is exactly that, and was being rejected only because the
        // reader could not see the word. This is the ONE class in the PR that
        // moves a rung on live traffic, and it is small: the whole-part-1 guard
        // removes `off_0041512162565` ("2 1/2 cup (100 g)", the only such SKU
        // with events) from the moving set, leaving 0 events in 90 days over
        // the rest. The honest caveat: some of these are per-100 g panels
        // wearing a household word — but so are the WHOLE-number "1 cup
        // (100 g)" labels this rule already admits, and narrowing it is a
        // different change with its own arm.
        const label = parseOffServingSize('2/3 cup (100 g)', 100);   // off_0015418011197, Vanilla gelato
        expect(usableBareLabelServing(100, extractLabelServingUnit(label.description))).toBe(100);

        // Unchanged: a placeholder with no household word is still refused.
        expect(usableBareLabelServing(100, extractLabelServingUnit('100 g'))).toBeNull();
        expect(usableBareLabelServing(100, extractLabelServingUnit('1 portion (100 g)'))).toBeNull();
    });

    it('CONTROL: an ordinary fractional label leaves the bare tiers where they were', async () => {
        // The bare branches only consult `labelUnitWord` through
        // `usableBareLabelServing`, which ignores it unless the serving is
        // EXACTLY 100 g. 110 g is not 100 g, so the headline record's bare
        // request bills the same tier and the same grams as before.
        mockOffFoodFindUnique.mockResolvedValue(offRow({
            barcode: '0081312620001',
            name: 'Cottage cheese',
            servingSize: '1/2 cup (110 g)',
            servingGrams: 110,
            nutrientsPer100g: { calories: 98, protein: 11, carbs: 3.4, fat: 4.3 },
        }));

        const r = await buildOffResult(
            candidate('0081312620001', 'Cottage cheese'),
            parsedLine({ qty: 1, unit: null, name: 'cottage cheese' }),
            0.9,
            'cottage cheese',
        );

        expect(r?.servingTier).toBe('bare_label_serving');
        expect(r?.grams).toBe(110);
    });
});
