/**
 * buildFatSecretResult — a cup word bills the record's OWN size row (s459 LATTE-b).
 *
 * FatSecret's generic drink records declare their cups: `Chai Latte` fs_10975795 carries
 * `1 small` 306 g / `1 medium` 408 g / `1 large` 485 g beside a `1 cup` 204 g default.
 * `a medium chai latte` parses `medium` as a unit and bills the `1 medium` row; `a grande chai
 * latte` parsed no unit and billed the 204 g default (cold probe, live build
 * mdfBlAuQ_FMtpFkaSgZK0, 2026-11-15). drinkCupSizeRow() names the row (tall = small,
 * grande = medium, venti = large); the builder bills it only when it RAISES the grams.
 *
 * The fixtures are the records' real serving rows (box, read-only, 2026-11-15).
 */

const mockFatSecretFoodFindUnique = jest.fn();

jest.mock('../../db', () => ({
    prisma: {
        fatSecretFood: {
            findUnique: (...args: unknown[]) => mockFatSecretFoodFindUnique(...args),
        },
    },
}));

import { buildFatSecretResult } from '../build-fatsecret-result';
import { parseIngredientLine } from '../../parse/ingredient-line';
import { drinkCupSizeRow } from '../../servings/bare-query-guard';

type Sv = [string, string, number, number]; // servingId, description, grams, kcal

function row(fsId: string, name: string, per100kcal: number, defaultServingId: string, servings: Sv[]) {
    return {
        fsId, name, brandName: null, foodType: 'Generic',
        nutrientsPer100g: { calories: per100kcal, protein: 2, carbs: 8, fat: 1.5 },
        defaultServingId,
        fetchedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
        servings: servings.map(([servingId, description, grams, kcal]) => ({
            servingId, description, measurementDescription: description.replace(/^1\s+/, ''),
            grams, volumeMl: null, numberOfUnits: description === '100 g' ? 100 : 1,
            nutrients: { calories: kcal, protein: grams * 0.02, carbohydrate: grams * 0.08, fat: grams * 0.015 },
        })),
    };
}

// fs_10975795 "Chai Latte": default `1 cup` 204 g.
const CHAI = row('10975795', 'Chai Latte', 65, '10451060', [
    ['10451058', '1 fl oz', 25.5, 16], ['10451060', '1 cup', 204, 132], ['10451061', '1 small', 306, 198],
    ['10451062', '1 medium', 408, 264], ['10451063', '1 large', 485, 314], ['10451064', '100 g', 100, 65],
]);
// fs_7350 "Cappuccino": default `1 mug (8 fl oz)` 240 g.
const CAPPUCCINO = row('7350', 'Cappuccino', 31, '28300', [
    ['26732', '1 serving (486 g)', 486, 151], ['26809', '1 small', 365, 113], ['27060', '1 medium', 486, 151],
    ['27157', '1 large', 578, 179], ['27228', '1 fl oz', 30, 9], ['27229', '1 coffee cup (6 fl oz)', 180, 56],
    ['28300', '1 mug (8 fl oz)', 240, 74], ['28637', '1 cup (8 fl oz)', 240, 74], ['56030', '100 g', 100, 31],
]);
// fs_7337 "Latte Coffee": default `1 medium` 408 g, so only `venti` raises.
const LATTE_COFFEE = row('7337', 'Latte Coffee', 33, '28553', [
    ['27465', '1 serving (408 g)', 408, 135], ['27734', '1 fl oz', 25.5, 8], ['27952', '1 large', 485, 160],
    ['28464', '1 small', 306, 101], ['28516', '1 cup', 204, 67], ['28553', '1 medium', 408, 135], ['56017', '100 g', 100, 33],
]);
// fs_351094 "Reduced Fat Cappuccino": default `1 coffee cup (6 fl oz)` 180 g; `1 medium` / `1 large` but NO `1 small`.
const REDUCED_FAT_CAPPUCCINO = row('351094', 'Reduced Fat Cappuccino', 22, '384222', [
    ['384221', '1 fl oz', 30, 7], ['384222', '1 coffee cup (6 fl oz)', 180, 40], ['384223', '1 mug (8 fl oz)', 240, 53],
    ['384225', '1 cup (8 fl oz)', 240, 53], ['384227', '1 medium', 486, 108], ['384228', '1 large', 578, 128], ['384229', '100 g', 100, 22],
]);
// Not a cup head (hot chocolate is its own row, s453 #653): `Hot Chocolate Cocoa (Made with Whole Milk)` fs_892.
const COCOA = row('892', 'Hot Chocolate Cocoa (Made with Whole Milk)', 76, 'c1', [
    ['c1', '1 cup', 250, 190], ['c2', '1 serving (250 g)', 250, 190], ['c3', '100 g', 100, 76],
]);

async function bill(line: string, rec: ReturnType<typeof row>) {
    mockFatSecretFoodFindUnique.mockResolvedValue(rec);
    const candidate = { id: `fs_${rec.fsId}`, source: 'fatsecret' as const, name: rec.name, brandName: null, score: 1, foodType: 'Generic', rawData: {} } as any;
    return buildFatSecretResult(candidate, parseIngredientLine(line), 0.9, line);
}

beforeEach(() => jest.clearAllMocks());

describe('a cup word bills the record’s own size row', () => {
    const MOVES: Array<[string, ReturnType<typeof row>, number, number]> = [
        ['a tall chai latte', CHAI, 306, 198],
        ['a grande chai latte', CHAI, 408, 264],
        ['a venti chai latte', CHAI, 485, 314],
        ['grande chai latte', CHAI, 408, 264],
        ['a grande chai tea latte', CHAI, 408, 264],
        ['a tall cappuccino', CAPPUCCINO, 365, 113],
        ['a grande cappuccino', CAPPUCCINO, 486, 151],
        ['a venti cappuccino', CAPPUCCINO, 578, 179],
        ['a venti latte', LATTE_COFFEE, 485, 160],
        ['a grande reduced fat cappuccino', REDUCED_FAT_CAPPUCCINO, 486, 108],
    ];
    it.each(MOVES)('%s bills the row (%#)', async (line, rec, grams, kcal) => {
        // MUTATION: drop the builder block, or map grande to nothing — the line falls back to the default serving.
        const r = await bill(line, rec);
        expect(r!.grams).toBe(grams);
        expect(r!.kcal).toBeCloseTo(kcal, 0);
        expect(r!.servingTier).toBe('fs_label_count');
    });

    it('the unit path it mirrors is unchanged: `a medium chai latte` already bills `1 medium`', async () => {
        const r = await bill('a medium chai latte', CHAI);
        expect(r!.grams).toBe(408);
        expect(r!.servingTier).toBe('fs_label_count');
    });
});

describe('everything else keeps today’s bill', () => {
    const KEEPS: Array<[string, ReturnType<typeof row>, number, string]> = [
        // bare: no size word
        ['chai latte', CHAI, 204, 'fs_default_serving'],
        ['a cappuccino', CAPPUCCINO, 240, 'fs_default_serving'],
        // raise-only: the record already bills 408 g (its `1 medium` default, out of the bare band, re-weighed
        // by panel inversion), which exceeds `small` and equals `medium`
        ['a tall latte', LATTE_COFFEE, 408, 'fs_serving_macros_only'],
        ['a grande latte', LATTE_COFFEE, 408, 'fs_serving_macros_only'],
        // short has no row
        ['a short chai latte', CHAI, 204, 'fs_default_serving'],
        // iced (on the line): the record's hot cup is not the iced drink
        ['a grande iced chai latte', CHAI, 204, 'fs_default_serving'],
        // the size word does not name the cup
        ['a tall glass of chai latte', CHAI, 204, 'fs_default_serving'],
        // another amount on the line
        ['2 grande chai lattes', CHAI, 408, 'fs_default_serving'],
        // the size sits in another item's clause
        ['chai latte with a venti cookie', CHAI, 204, 'fs_default_serving'],
        // the record lacks the named row (`1 small`): today's 180 g default stays
        ['a tall reduced fat cappuccino', REDUCED_FAT_CAPPUCCINO, 180, 'fs_default_serving'],
        // not a cup head
        ['a grande hot chocolate', COCOA, 250, 'fs_default_serving'],
    ];
    it.each(KEEPS)('%s keeps today (%#)', async (line, rec, grams, tier) => {
        const r = await bill(line, rec);
        expect(r!.grams).toBe(grams);
        expect(r!.servingTier).toBe(tier);
    });
});

describe('drinkCupSizeRow() guards', () => {
    const p = (line: string) => parseIngredientLine(line);
    it.each([
        ['a grande chai latte', 'Chai Latte', 65, 'medium'],
        ['a tall mocha', 'Mocha Coffee', 81, 'small'],
        ['a venti matcha latte', 'Matcha Almond Milk Latte', 32, 'large'],
    ])('%s on %s (%d kcal) names %s', (line, food, kcal, want) => {
        expect(drinkCupSizeRow({ parsed: p(line as string), rawLine: line as string, foodName: food as string, kcalPer100g: kcal as number })).toBe(want);
    });
    it.each([
        // MUTATION: drop the record-name head check — a muffin carrying `1 large` would bill it.
        ['a venti mocha', 'Chocolate Muffin', 80],
        // record iced
        ['a grande chai latte', 'Iced Chai Latte', 42],
        // panel denser than any hot cafe drink
        ['a grande mocha', 'Mocha Coffee', 145],
        // not a cup head
        ['a grande hot chocolate', 'Hot Chocolate', 76],
        // non-drink word
        ['a grande mocha frozen yogurt', 'Mocha Frozen Yogurt Cone', 90],
    ])('%s on %s (%d kcal) names nothing', (line, food, kcal) => {
        expect(drinkCupSizeRow({ parsed: p(line as string), rawLine: line as string, foodName: food as string, kcalPer100g: kcal as number })).toBeNull();
    });
    it('a panel-less record (no per-100 g kcal, the #687 shape) names nothing', () => {
        expect(drinkCupSizeRow({ parsed: p('a grande chai latte'), rawLine: 'a grande chai latte', foodName: 'Chai Latte', kcalPer100g: null })).toBeNull();
    });
});
