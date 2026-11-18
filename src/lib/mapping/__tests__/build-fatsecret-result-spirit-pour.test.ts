/**
 * buildFatSecretResult — a spirit is one pour, not one fluid ounce (s461 BARE-SPIRIT-POUR).
 *
 * FatSecret's generic Tequila fs_305929, Rum fs_7582, Vodka fs_7731, Whiskey fs_7693, Bourbon fs_307205 and
 * Gin (90 Proof) fs_37734 declare a `1 fl oz` row (27.8-28 g) as their default serving and carry their own
 * drink beside it: `1 jigger` / `1 jigger 1.5 fl oz`, 42 g. Live `whiskey` and `a bourbon` billed 28 g / 70 kcal and
 * `tequila`, `rum`, `vodka` 27.8 g / 64 (cold nosave probes, build h4EUm_rlJ0KcVxGnEkZTi, 2026-11-17). spiritPourRow()
 * bills the jigger on a unitless line, per drink. A `shot` line is #688's count unit and never reaches it.
 *
 * The REAL fixtures are those records' panels and serving rows (box, read-only, 2026-11-16). The SYNTHETIC
 * fixtures each break exactly one guard; the box has 0 records of their shape (every ethanol-only FatSecret
 * record with a `1 fl oz` default is one of the six above, measured 2026-11-16).
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

type Sv = [string, string, number | null]; // servingId, description, grams
type Panel = [number, number, number, number]; // kcal, protein, carbs, fat per 100 g

function row(fsId: string, name: string, p: Panel, defaultServingId: string, servings: Sv[]) {
    return {
        fsId, name, brandName: null, foodType: 'Generic',
        nutrientsPer100g: { calories: p[0], protein: p[1], carbs: p[2], fat: p[3] },
        defaultServingId,
        fetchedAt: new Date(), createdAt: new Date(), updatedAt: new Date(),
        servings: servings.map(([servingId, description, grams]) => ({
            servingId, description, measurementDescription: description.replace(/^1\s+/, ''),
            grams, volumeMl: null, numberOfUnits: description === '100 g' ? 100 : 1,
            nutrients: grams == null ? null : {
                calories: p[0] * grams / 100, protein: p[1] * grams / 100,
                carbohydrate: p[2] * grams / 100, fat: p[3] * grams / 100,
            },
        })),
    };
}
type Rec = ReturnType<typeof row>;

// Real records.
const TEQUILA = row('305929', 'Tequila', [231, 0, 0, 0], '340882', [
    ['340882', '1 fl oz (no ice)', 27.8], ['340881', '1 jigger', 42], ['340883', '1 serving (42 g)', 42], ['340884', '100 g', 100],
]);
const RUM = row('7582', 'Rum', [231, 0, 0, 0], '28729', [
    ['28729', '1 fl oz (no ice)', 27.8], ['28730', '1 serving (42 g)', 42], ['28693', '1 jigger', 42], ['56262', '100 g', 100],
]);
const VODKA = row('7731', 'Vodka', [231, 0, 0, 0], '28387', [
    ['28387', '1 fl oz (no ice)', 27.8], ['28403', '1 serving (42 g)', 42], ['28317', '1 jigger', 42], ['56411', '100 g', 100],
]);
const WHISKEY = row('7693', 'Whiskey', [250, 0, 0.1, 0], '28836', [
    ['28836', '1 fl oz (no ice)', 28], ['28900', '1 serving (42 g)', 42], ['28835', '1 jigger', 42], ['56373', '100 g', 100],
]);
const BOURBON = row('307205', 'Bourbon', [250, 0, 0.1, 0], 'b1', [
    ['b1', '1 fl oz (no ice)', 28], ['b2', '1 jigger', 42], ['b3', '100 g', 100],
]);
const GIN_90 = row('37734', 'Gin (90 Proof)', [262.76, 0, 0, 0], '36595', [
    ['36595', '1 fl oz', 27.8], ['44942', '1 oz', 28.35], ['36596', '1 jigger 1.5 fl oz', 42],
]);
// Generic Gin already declares its jigger.
const GIN = row('7581', 'Gin', [263, 0, 0, 0], '28768', [
    ['28617', '1 fl oz (no ice)', 28], ['28768', '1 jigger', 42], ['28692', '1 serving (42 g)', 42], ['56261', '100 g', 100],
]);
// A cocktail with a `1 fl oz` default (fs_37731 "Whiskey Sour", DRINK-FLOZ-DEFAULT's row, not this one).
const WHISKEY_SOUR = row('37731', 'Whiskey Sour', [153, 0.2, 13.6, 0.1], 'w1', [
    ['w1', '1 fl oz', 30.4], ['w2', '1 portion (2 oz mix + 1.5 oz whiskey)', 106], ['w3', '100 g', 100],
]);

// Synthetic: each breaks one guard.
const SYN_SERVING_DEFAULT = row('900001', 'Tequila Blanco', [231, 0, 0, 0], 's1', [
    ['s1', '1 serving (30 g)', 30], ['s2', '1 jigger', 42], ['s3', '100 g', 100],
]);
const SYN_LIQUEUR = row('900002', 'Spiced Rum Liqueur', [300, 0, 30, 0], 'l1', [
    ['l1', '1 fl oz', 30], ['l2', '1 jigger', 45], ['l3', '100 g', 100],
]);
const SYN_SELTZER = row('900003', 'Vodka Soda', [29, 0, 0, 0], 'v1', [
    ['v1', '1 fl oz', 29.6], ['v2', '1 shot', 44], ['v3', '100 g', 100],
]);
const SYN_CREAM = row('900004', 'Irish Whiskey Cream', [327, 0, 0, 15.7], 'c1', [
    ['c1', '1 fl oz', 30], ['c2', '1 jigger', 45], ['c3', '100 g', 100],
]);
const SYN_NOT_A_SPIRIT = row('900005', 'Pure Vanilla Flavoring', [288, 0, 0, 0], 'n1', [
    ['n1', '1 fl oz', 28], ['n2', '1 jigger', 42], ['n3', '100 g', 100],
]);
const SYN_NO_POUR_ROW = row('900006', 'Vodka (100 Proof)', [295, 0, 0, 0], 'r1', [
    ['r1', '1 fl oz', 27.8], ['r2', '1 serving (42 g)', 42], ['r3', '100 g', 100],
]);

async function bill(line: string, rec: Rec) {
    mockFatSecretFoodFindUnique.mockResolvedValue(rec);
    const candidate = { id: `fs_${rec.fsId}`, source: 'fatsecret' as const, name: rec.name, brandName: null, score: 1, foodType: 'Generic', rawData: {} } as any;
    return buildFatSecretResult(candidate, parseIngredientLine(line), 0.9, line);
}

beforeEach(() => jest.clearAllMocks());

describe('a unitless spirit line bills the record’s own pour, per drink', () => {
    const MOVES: Array<[string, Rec, number, number]> = [
        ['tequila', TEQUILA, 42, 97],
        ['a tequila', TEQUILA, 42, 97],
        ['one tequila', TEQUILA, 42, 97],
        ['1 tequila', TEQUILA, 42, 97],
        ['un tequila', TEQUILA, 42, 97],
        ['rum', RUM, 42, 97],
        ['vodka', VODKA, 42, 97],
        ['whiskey', WHISKEY, 42, 105],
        ['a whiskey', WHISKEY, 42, 105],
        ['whiskey neat', WHISKEY, 42, 105],
        ['a bourbon', BOURBON, 42, 105],
        ['gin', GIN_90, 42, 110],
        ['2 tequilas', TEQUILA, 84, 194],
        ['two whiskeys', WHISKEY, 84, 210],
    ];
    it.each(MOVES)('%s bills %#', async (line, rec, grams, kcal) => {
        // MUTATION M1 (call seat: bill `declaredDefault`) — every row falls back to the 1 fl oz default.
        const r = await bill(line, rec);
        expect(r!.grams).toBeCloseTo(grams, 5);
        expect(r!.kcal).toBeCloseTo(kcal, 0);
        expect(r!.servingTier).toBe('fs_default_serving');
    });
});

describe('everything else keeps today’s bill', () => {
    const KEEPS: Array<[string, string, Rec, number]> = [
        // the record already declares its jigger
        ['default already a jigger', 'gin', GIN, 42],
        // a cocktail panel: not ethanol-only
        ['a cocktail', 'whiskey sour', WHISKEY_SOUR, 30.4],
        // a unit line keeps its own path (M2 drops the unit gate)
        ['a unit line (dash)', 'a dash of tequila', TEQUILA, 27.8],
        ['a unit line (piece)', 'a piece of whiskey', WHISKEY, 28],
        ['a unit line (shot, #688)', 'a shot of tequila', TEQUILA, 27.8],
        // a measure keeps its measure
        ['a measure', '1.5 oz tequila', TEQUILA, 42.525],
        ['a fluid measure', '1 fl oz whiskey', WHISKEY, 28],
        // M3: the default is not a fl-oz row
        ['default is not 1 fl oz', 'tequila blanco', SYN_SERVING_DEFAULT, 30],
        // M4: carbs (a liqueur)
        ['liqueur panel (carbs)', 'spiced rum liqueur', SYN_LIQUEUR, 30],
        // M5: kcal (a seltzer)
        ['seltzer panel (kcal)', 'vodka soda', SYN_SELTZER, 29.6],
        // M6: fat (a cream liqueur)
        ['cream panel (fat)', 'irish whiskey cream', SYN_CREAM, 30],
        // M7: the record name is not a spirit
        ['not a spirit', 'pure vanilla flavoring', SYN_NOT_A_SPIRIT, 28],
        // M8: no jigger/shot row — no 42 g is synthesised and "1 serving" is not a pour
        ['no pour row', 'vodka', SYN_NO_POUR_ROW, 27.8],
    ];
    it.each(KEEPS)('%s: `%s` keeps its bill', async (_why, line, rec, grams) => {
        const r = await bill(line, rec);
        expect(r!.grams).toBeCloseTo(grams, 3);
    });
});
