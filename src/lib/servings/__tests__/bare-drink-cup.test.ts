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
        ['a grande latte', 14, 'Latte', 42],
        ['mocha', 100, 'Mocha', 88],
    ];
    it.each(FIRES)('fires on %s (%d g, %s, %d kcal)', (line, grams, food, kcal) => {
        const r = run(line, grams, food, kcal);
        expect(r).not.toBeNull();
        expect(r?.grams).toBe(240);
        expect(r?.servingTier).toBe('bare_prepared_drink_cup');
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
