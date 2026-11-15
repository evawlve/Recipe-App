/**
 * buildFatSecretResult — a PANEL-LESS record under a count unit (s459 AL-b0).
 *
 * Every panel-less FatSecret record carries its macros on a gram-less serving.
 * Under a count/ambiguous unit the (c2) estimate set grams but no serving, so
 * step 4 found neither a serving to scale nor a per-100g panel, logged
 * `no_macros_for_serving` and returned null — and the mapper billed the NEXT
 * candidate. `1 shot of cinnamon whiskey` lost Fireball (125 kcal) to "Cinnamon
 * Whiskey Caramels" (20 g / 71 kcal).
 *
 * The record now bills when it SAYS how many of the unit its serving holds
 * (label noun, or a "1 serving" label plus a name naming the noun), or when its
 * serving label is a measure the estimate can be billed against. Either way the
 * displayed grams are the (c2) estimate, never the 2.0 kcal/g fabrication (a
 * large coffee is not 2.5 g). A record that says neither keeps the old
 * behaviour (null), because "serving x qty" is wrong whenever the serving is
 * not one unit: `10 piece` on a 4-piece record.
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
import type { ParsedIngredient } from '../../parse/ingredient-line';

/** A candidate-fallback (not persisted) panel-less record: one gram-less serving. */
function panelless(name: string, description: string, kcal: number, brandName: string | null = null) {
    return {
        id: 'fs_1', source: 'fatsecret' as const, name, brandName, score: 1, foodType: 'Brand',
        servings: [{
            description, grams: null,
            nutrients: { calories: kcal, protein: 1, carbohydrate: 10, fat: 2 },
        }],
        rawData: { fsId: '1', nutrientsPer100g: null },
    } as any;
}

function parsedLine(over: Partial<ParsedIngredient>): ParsedIngredient {
    return { qty: 1, multiplier: 1, unit: null, name: '', ...over } as ParsedIngredient;
}

async function bill(c: any, qty: number, unit: string, name: string) {
    return buildFatSecretResult(c, parsedLine({ qty, unit, name }), 0.9, `${qty} ${unit} ${name}`);
}

beforeEach(() => {
    jest.clearAllMocks();
    mockFatSecretFoodFindUnique.mockResolvedValue(null);
    mockGetOrCreateAmbiguousServing.mockResolvedValue({ status: 'success', grams: 44 });
});

describe('a measure label is billed against the estimate (Fireball, fs_4709204)', () => {
    const fireball = () => panelless('Cinnamon Whiskey', '1 1/2 oz', 125, 'Fireball');

    it('"1 shot of cinnamon whiskey" bills Fireball instead of dropping out', async () => {
        // MUTATION: delete the measureLabelGrams() call -> step 4 returns null (the base bug).
        const r = await bill(fireball(), 1, 'shot', 'cinnamon whiskey');
        expect(r).not.toBeNull();
        expect(r!.foodName).toBe('Cinnamon Whiskey');
        expect(r!.grams).toBe(44);
        expect(r!.kcal).toBeCloseTo(125 * 44 / (1.5 * 28.35), 1);
        expect(r!.servingTier).toBe('count_unit_ai');
    });

    it('scales by qty: "2 shots" is two estimated shots', async () => {
        const r = await bill(fireball(), 2, 'shot', 'cinnamon whiskey');
        expect(r!.grams).toBe(88);
        expect(r!.kcal).toBeCloseTo(2 * 125 * 44 / (1.5 * 28.35), 1);
    });

    it('a fl oz label is a pourable at 30 g per fl oz', async () => {
        mockGetOrCreateAmbiguousServing.mockResolvedValue({ status: 'success', grams: 355 });
        const r = await bill(panelless('Cola', '12 fl oz', 140), 1, 'can', 'cola');
        expect(r!.kcal).toBeCloseTo(140 * 355 / 360, 5);
    });

    it('a cup label is NOT a measure here: `a bowl of kimchi jjigae` keeps today\'s drop', async () => {
        // MUTATION: admit cup through volumeToGrams() -> the stew reads 0.5 g/ml,
        // 120 g a cup, and a 300 g bowl bills 737 kcal (replay, 2026-11-15).
        mockGetOrCreateAmbiguousServing.mockResolvedValue({ status: 'success', grams: 300 });
        const r = await bill(panelless('Kimchi Jjigae', '1 cup', 295), 1, 'bowl', 'kimchi jjigae');
        expect(r).toBeNull();
    });
});

describe('the record declares how many of the unit its serving holds', () => {
    it('the label names the unit: "3 slices" on a "2 slices" serving is 1.5 servings at the estimate\'s grams', async () => {
        mockGetOrCreateAmbiguousServing.mockResolvedValue({ status: 'success', grams: 40 });
        const r = await bill(panelless('Garlic Bread', '2 slices', 300), 3, 'slice', 'garlic bread');
        expect(r!.kcal).toBeCloseTo(450, 5);
        expect(r!.grams).toBe(120);
        expect(r!.servingTier).toBe('count_unit_ai');
    });

    it('"2 servings" on a "1 serving" label is two servings', async () => {
        const r = await bill(panelless('Diet Dr Pepper', '1 serving', 0), 2, 'serving', 'diet dr pepper');
        expect(r).not.toBeNull();
        expect(r!.kcal).toBe(0);
    });

    it('the name enumerates the pieces: "10 piece" on "Chicken Nuggets - 4 Pieces" is 2.5 servings', async () => {
        // MUTATION: bill qty x serving (the "skip c2 when no panel" one-liner) -> 1,700 kcal.
        mockGetOrCreateAmbiguousServing.mockResolvedValue({ status: 'success', grams: 16 });
        const r = await bill(panelless('Chicken Nuggets - 4 Pieces', '1 serving', 170, "Wendy's"),
            10, 'piece', 'wendys nuggets');
        expect(r!.kcal).toBeCloseTo(425, 5);
        expect(r!.grams).toBe(160);
    });

    it('the displayed grams are the estimate, not 2.0 kcal/g: "a large dunkin hot coffee" (5 kcal)', async () => {
        // MUTATION: bill the declared unit on the macro-only fallback (r0) -> 2.5 g.
        mockGetOrCreateAmbiguousServing.mockResolvedValue({ status: 'success', grams: 590 });
        const r = await bill(panelless('Hot Coffee - Large', '1 serving', 5, 'Dunkin'), 1, 'large', 'dunkin hot coffee');
        expect(r!.grams).toBe(590);
        expect(r!.kcal).toBeCloseTo(5, 5);
        expect(r!.servingTier).toBe('count_unit_ai');
    });

    it('when the estimate fails, a declared unit still bills the record on the macro-only weight', async () => {
        mockGetOrCreateAmbiguousServing.mockResolvedValue({ status: 'error', error: 'llm down' });
        const r = await bill(panelless('Garlic Bread', '2 slices', 300), 3, 'slice', 'garlic bread');
        expect(r!.kcal).toBeCloseTo(450, 5);
        expect(r!.servingTier).toBe('fs_serving_macros_only_est');
    });

    it('"4 Piece Chicken McNuggets" counts before the noun too', async () => {
        const r = await bill(panelless('6 Piece Chicken McNuggets', '1 serving', 250), 3, 'piece', 'mcnuggets');
        expect(r!.kcal).toBeCloseTo(125, 5);
    });

    it('the name names the unit with no count: "2 slices" of "Personal Pan Pizza Slice" is two servings', async () => {
        const r = await bill(panelless('Pepperoni - Personal Pan Pizza Slice', '1 serving', 160),
            2, 'slice', 'pizza hut pepperoni pan pizza');
        expect(r!.kcal).toBeCloseTo(320, 5);
    });

    it('a size unit the name carries: "a small chili" on "Chili Small"', async () => {
        const r = await bill(panelless('Chili Small', '1 serving', 280), 1, 'small', 'chili');
        expect(r!.kcal).toBeCloseTo(280, 5);
    });
});

describe('a record that does not say keeps the old behaviour (drops out)', () => {
    it('"small fries" on "World Famous Fries - Kids": the name never says small', async () => {
        const r = await bill(panelless('World Famous Fries - Kids', '1 serving', 110), 1, 'small', 'fries');
        expect(r).toBeNull();
        expect(mockGetOrCreateAmbiguousServing).toHaveBeenCalledTimes(1);
    });

    it('a count of something else refuses: "6 wings" on "Classic Bone-in Wings - 6 Pieces"', async () => {
        const r = await bill(panelless('Classic Bone-in Wings - 6 Pieces', '1 serving', 650), 6, 'wing', 'wings');
        expect(r).toBeNull();
    });

    it('"30 Count Boneless Wings" does not read as one wing per serving', async () => {
        const r = await bill(panelless('30 Count Boneless Wings', '1 serving', 1820), 6, 'wing', 'boneless wings');
        expect(r).toBeNull();
    });

    it('a noun label for a different unit: "1 sandwich" under "egg"', async () => {
        const r = await bill(panelless('Egg McMuffin', '1 sandwich', 300), 2, 'egg', 'eggs');
        expect(r).toBeNull();
    });
});

describe('records the change must not touch', () => {
    it('a unitless line still bills the macro-only serving x qty', async () => {
        const r = await buildFatSecretResult(panelless('Chili Small', '1 serving', 280),
            parsedLine({ qty: 1, unit: null, name: 'wendys small chili' }), 0.9, 'wendys small chili');
        expect(r!.kcal).toBeCloseTo(280, 5);
        expect(r!.servingTier).toBe('fs_serving_macros_only_est');
    });

    it('a record WITH a per-100g panel still bills the estimate through the panel', async () => {
        const c = panelless('Whiskey', '1 1/2 oz', 105);
        c.nutrition = { per100g: true, calories: 250, protein: 0, carbs: 0, fat: 0 };
        const r = await bill(c, 1, 'shot', 'whiskey');
        expect(r!.grams).toBe(44);
        expect(r!.kcal).toBeCloseTo(110, 5);
    });
});
