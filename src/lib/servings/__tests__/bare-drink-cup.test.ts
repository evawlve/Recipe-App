/**
 * bareDrinkCupOverride() (S202, companion to PR 502): a bare prepared drink on a
 * drink panel bills as a 240 g cup, never a sachet or the 100 g floor.
 */

import { bareDrinkCupOverride } from '../bare-query-guard';
import { parseIngredientLine } from '../../parse/ingredient-line';
import { isBorrowedOrDefaultedTier, portionProvenanceForTier } from '../../mapping/serving-ai-tiers';

function run(line: string, grams: number, foodName: string, kcalPer100g: number | null) {
    const parsed = parseIngredientLine(line);
    return bareDrinkCupOverride({ grams, parsed, rawLine: line, queryName: parsed?.name ?? '', foodName, kcalPer100g });
}

describe('bareDrinkCupOverride', () => {
    const FIRES: Array<[string, number, string, number]> = [
        ['latte', 14, 'Latte', 42],
        ['a latte', 100, 'Latte', 26],
        ['a flat white', 100, 'Flat White', 57],
        ['london fog', 100, 'London Fog', 50],
        ['golden milk latte', 50, 'GOLDEN TURMERIC OAT MILK LATTE', 48],
        ['cappuccino', 15, 'Cappuccino', 38],
        ['mocha', 100, 'Mocha', 88],
        // s459 LATTE: `N shot` is the espresso in ONE drink (#690), not a quantity.
        ['2 shot latte', 140, 'Latte', 42],
        ['a 2 shot latte', 140, 'Latte', 42],
        ['3 shot latte', 100, 'Latte', 42],
        // An ICED line is never sized (the cup holds ice); a bare iced line keeps the bare cup.
        ['a grande iced vanilla latte', 100, 'Vanilla Iced Latte', 41],
        // refute rf-latte: a size that cannot bill its cup keeps the bare cup, exactly as before.
        ['a grande latte', 100, 'Iced Caffe Latte', 60],
        ['a venti mocha', 100, 'Mocha', 145],
        ['a tall glass of latte', 100, 'Latte', 42],
    ];
    it.each(FIRES)('fires on %s (%d g, %s, %d kcal)', (line, grams, food, kcal) => {
        const r = run(line, grams, food, kcal);
        expect(r).not.toBeNull();
        expect(r?.grams).toBe(240);
        expect(r?.servingTier).toBe('bare_prepared_drink_cup');
    });

    // s459 LATTE: a named cup size bills that cup (hot, ~1 g/ml): small = tall = 12 oz, medium = grande = 16, large = venti = 20.
    const SIZED: Array<[string, number, string, number, number]> = [
        ['a small latte', 250, 'Latte', 42, 355],
        ['a medium latte', 240, 'Latte', 42, 473],
        ['a large latte', 300, 'Latte', 42, 591],
        ['a short latte', 100, 'Latte', 42, 240],
        ['a tall latte', 240, 'Latte', 26, 355],
        ['a grande latte', 14, 'Latte', 42, 473],
        ['a venti latte', 100, 'Latte', 42, 591],
        ['latte grande', 100, 'Latte', 42, 473],
        ['a large cappuccino', 300, 'Cappuccino', 38, 591],
        ['a large latte with oat milk', 300, 'Latte', 42, 591],
        ['a 3 shot grande latte', 140, 'Latte', 42, 473],
    ];
    it.each(SIZED)('sizes %s (%d g, %s, %d kcal) to %d g', (line, grams, food, kcal, want) => {
        const r = run(line, grams, food, kcal);
        expect(r?.grams).toBe(want);
        expect(r?.servingTier).toBe('bare_prepared_drink_cup');
    });

    it('names the size in the description', () => {
        expect(run('a grande latte', 14, 'Latte', 42)?.servingDescription).toBe('1 grande (~473g)');
        expect(run('a large latte', 300, 'Latte', 42)?.servingDescription).toBe('1 large (~591g)');
        expect(run('latte', 14, 'Latte', 42)?.servingDescription).toBe('1 cup (~240g)');
    });

    const NULLS: Array<[string, number, string, number | null]> = [
        ['a coconut milk latte', 80, 'Coconut Milk', 100],
        ['coffee creamer (mocha)', 15, 'Mocha Coffee Creamer', 120],
        ['oat milk for latte', 100, 'Oat Milk', 48],
        ['greek yogurt mocha', 150, 'Greek Yogurt Mocha', 90],
        ['latte', 240, 'Latte', 42],
        ['latte', 300, 'Latte', 42],
        ['latte', 14, 'Latte', 0],
        ['latte', 14, 'Latte', 397],
        ['latte', 14, 'Latte', null],
        ['a cortado', 100, 'Cortado', 40],
        ['a macchiato', 60, 'Macchiato', 40],
        ['2 lattes', 28, 'Latte', 42],
        ['a 16 oz latte', 100, 'Latte', 42],
        ['matcha latte powder', 20, 'Matcha Latte Powder', 120],
        // s459 LATTE: raise-only against the size; iced is not sized; any other amount refuses.
        ['a large latte', 600, 'Latte', 42],
        ['a venti latte', 591.47, 'Starbucks, Vanilla Latte With 2% Milk, Venti', 10.5],
        ['a grande latte', 473, 'Latte', 42],
        ['a large iced latte', 240, 'Iced Latte', 41],
        ['a medium iced latte', 240, 'Iced Latte', 75],
        ['a grande iced vanilla latte', 240, 'Vanilla Iced Latte', 41],
        ['2 large lattes', 600, 'Latte', 42],
        ['2 shots of latte', 60, 'Latte', 42],
        ['a large mocha almonds', 30, 'Mocha Almonds', 560],
        ['a large coffee creamer', 15, 'Mocha Coffee Creamer', 120],
        ['a grande latte', 14, 'Latte', 397],
        ['a cup of latte', 100, 'Latte', 42],
        // the record's own head clause is `Starbucks` (comma-led name), so it is not read as a drink -- unchanged from the bare rule
        ['starbucks tall flat white with almond milk', 300, 'Starbucks, Flat White With Whole Milk, Tall', 15.5],
        // refute rf-latte: an iced RECORD, a panel over SIZED_CUP_MAX_KCAL, a size word that is not the cup.
        ['a large latte', 240, 'Iced Latte', 75],
        ['a large double shot latte', 240, 'Double Shot Iced Latte', 60],
        ['a large mocha', 240, 'Mocha', 145],
        ['a small amount of latte', 100, 'Latte', 42],
        ['a small sip of latte', 100, 'Latte', 42],
        ['medium roast latte', 100, 'Latte', 42],
        ['small batch latte', 100, 'Latte', 42],
    ];
    it.each(NULLS)('stays null on %s (%d g, %s, %s kcal)', (line, grams, food, kcal) => {
        expect(run(line, grams, food, kcal)).toBeNull();
    });

    it('is off when OFF_BARE_SERVING_GUARD=0', () => {
        const prev = process.env.OFF_BARE_SERVING_GUARD;
        try {
            process.env.OFF_BARE_SERVING_GUARD = '0';
            expect(run('latte', 14, 'Latte', 42)).toBeNull();
        } finally {
            if (prev === undefined) delete process.env.OFF_BARE_SERVING_GUARD;
            else process.env.OFF_BARE_SERVING_GUARD = prev;
        }
    });

    it('the tier is borrowed/defaulted', () => {
        expect(isBorrowedOrDefaultedTier('bare_prepared_drink_cup')).toBe(true);
        expect(portionProvenanceForTier('bare_prepared_drink_cup')).toBe('borrowed');
    });
});
