/**
 * Unit tests for the bare-query serving lexicon (getBareQueryDefault).
 *
 * The table is first-match-wins, so placement is part of the contract: the
 * ordering-regression block pins every pre-existing name's output, with the
 * PR D pt3 intentional exceptions enumerated (sugar 120->4, molasses,
 * peanut butter 14->32, muscle milk 240->414).
 */

import { getBareQueryDefault } from '../ambiguous-serving-estimator';

const grams = (name: string) => getBareQueryDefault(name)?.grams ?? null;

describe('getBareQueryDefault — ordering regression (pre-existing entries unchanged)', () => {
    it.each([
        // spices & extracts
        ['cinnamon', 2.5],
        ['salt', 2.5],
        ['black pepper', 2.5],
        ['vanilla extract', 2.5],
        // condiments & spreads
        ['mayonnaise', 14],
        ['ketchup', 14],
        ['butter', 14],
        ['olive oil', 14],
        ['fish sauce', 14],
        ['maple syrup', 14],
        // flours & baking dry
        ['flour', 120],
        ['baking flour', 120],
        ['cornstarch', 120],
        ['cocoa powder', 120],
        ['baking soda', 4],
        ['baking powder', 4],
        // cheese
        ['cheese', 28],
        ['cheddar cheese', 28],
        // liquids
        ['milk', 240],
        ['almond milk', 240],
        ['orange juice', 240],
        ['chicken broth', 240],
    ])('%s still resolves to %sg', (name, expected) => {
        expect(grams(name as string)).toBe(expected);
    });

    it('honey gained a condiment entry 2026-07-21 (n-serv-49 flapped on the AI size estimate without it)', () => {
        expect(grams('honey')).toBe(14);
    });

    it.each([
        ['sugar', 4],          // was 120 via the flour rule — tsp-scale is the fix
        ['brown sugar', 4],
        ['molasses', 4],       // new sweetener token (was null)
        ['peanut butter', 32], // was condiment 14 — 32g keeps the CAP inert
        ['muscle milk', 414],  // was liquids 240 — RTD can
    ])('intentional exception: %s now resolves to %sg', (name, expected) => {
        expect(grams(name as string)).toBe(expected);
    });

    it('sugar snap peas does not hit the new sweetener entry', () => {
        expect(grams('sugar snap peas')).not.toBe(4);
    });
});

describe('getBareQueryDefault — new entries (PR D pt3)', () => {
    it.each([
        // peanut/nut butters: 32g
        ['crunchy peanut butter', 32],
        ['almond nut butter', 32],
        // condiment extension: 14g
        ['ghee', 14],
        ['lard', 14],
        ['tallow', 14],
        ['miso', 14],
        ['mirin', 14],
        ['tahini', 14],
        ['pesto', 14],
        ['hummus', 14],
        // nuts & seeds: 28g
        ['almonds', 28],
        ['cashews', 28],
        ['peanuts', 28],
        ['pecans', 28],
        ['walnuts', 28],
        ['pistachios', 28],
        ['macadamias', 28],
        ['hazelnuts', 28],
        ['sunflower seeds', 28],
        ['pumpkin seeds', 28],
        ['chia seeds', 28],
        ['flax seed', 28],
        ['trail mix', 28],
        // pre-workout / creatine: 12g
        ['ghost pre workout', 12],
        ['pre-workout', 12],
        ['creatine', 12],
        // protein powders: 35g
        ['protein powder', 35],
        ['orgain organic protein powder', 35],
        ['whey', 35],
        ['casein', 35],
        ['collagen', 35],
        ['greens powder', 35],
        ['mass gainer', 35],
        // salty snacks: 28g
        ['mission tortilla chips', 28],
        ['doritos', 28],
        ['crisps', 28],
        ['crackers', 28],
        ['pretzels', 28],
        ['goldfish', 28],
        ['popcorn', 28],
        ['cheetos', 28],
        // cured / breakfast meats: 28g
        ['bacon', 28],
        ['sausage link', 28],
        ['salami', 28],
        ['pepperoni', 28],
        ['prosciutto', 28],
        ['beef jerky', 28],
        // cereals: 40g
        ['cereal', 40],
        ['granola', 40],
        ['muesli', 40],
        // oats dry: 40g
        ['oats', 40],
        ['oatmeal', 40],
        ['rolled oats', 40],
        // dry grains: 45g
        ['couscous', 45],
        ['bulgur', 45],
        ['barley', 45],
        ['polenta', 45],
        ['farro', 45],
        // beverage cans: 355g
        ['coca cola', 355],
        ['coke', 355],
        ['soda', 355],
        ['soft drink', 355],
        ['energy drink', 355],
        ['sports drink', 355],
        ['kombucha', 355],
        ['lemonade', 355],
        ['iced tea', 355],
    ])('%s resolves to %sg', (name, expected) => {
        expect(grams(name as string)).toBe(expected);
    });

    it('appended entries never shadow earlier rules', () => {
        // "peanut" alone is nuts 28g, but "peanut butter" stays on its 32g entry.
        expect(grams('peanut')).toBe(28);
        expect(grams('peanut butter')).toBe(32);
        // "baking soda" hits the baking rule before the beverage "soda" token.
        expect(grams('baking soda')).toBe(4);
        // "chocolate milk" stays a liquid; only "muscle milk" is the RTD can.
        expect(grams('chocolate milk')).toBe(240);
    });

    it('deliberately absent categories return null (yogurt, bars, eggs, produce, meat cuts)', () => {
        expect(getBareQueryDefault('greek yogurt')).toBeNull();
        expect(getBareQueryDefault('rx bar')).toBeNull();
        expect(getBareQueryDefault('egg')).toBeNull();
        expect(getBareQueryDefault('banana')).toBeNull();
        expect(getBareQueryDefault('ribeye')).toBeNull();
    });
});

describe('getBareQueryDefault — token-containment guards (warm-2026-07-21 regressions)', () => {
    it('bell peppers are produce, not the pepper spice', () => {
        expect(getBareQueryDefault('bell pepper')).toBeNull();
        expect(getBareQueryDefault('red bell pepper')).toBeNull();
        expect(getBareQueryDefault('yellow bell pepper')).toBeNull();
        // The spice itself and non-bell forms keep the 2.5g default.
        expect(grams('black pepper')).toBe(2.5);
        expect(grams('pepper')).toBe(2.5);
        expect(grams('ground pepper')).toBe(2.5);
    });

    it('cinnamon-flavored product names skip the spice rule; the spice itself does not', () => {
        expect(getBareQueryDefault('ghost vegan protein cinnamon roll')).toBeNull();
        expect(getBareQueryDefault('cinnamon toast crunch')).toBeNull();
        expect(grams('cinnamon')).toBe(2.5);
        expect(grams('ground cinnamon')).toBe(2.5);
    });

    it("bare 'vanilla' is a flavor word — only 'extract' carries the spice default", () => {
        expect(getBareQueryDefault('vanilla')).toBeNull();
        expect(grams('orgain organic protein powder vanilla')).toBe(35);
        expect(grams('vanilla extract')).toBe(2.5);
    });

    it('cottage/ricotta keep their ~125g label servings (no 28g hard-cheese default)', () => {
        expect(getBareQueryDefault('cottage cheese')).toBeNull();
        expect(getBareQueryDefault('ricotta cheese')).toBeNull();
        expect(grams('cream cheese')).toBe(28);
        expect(grams('cheddar cheese')).toBe(28);
    });

    it('nutella is a spread (14g), capping the 200g package serve', () => {
        expect(grams('nutella')).toBe(14);
        expect(grams('hazelnut spread')).toBe(14);
    });

    it('bare honey is a condiment (14g) so the AI size estimate stops flapping to the 340g bottle', () => {
        expect(grams('honey')).toBe(14);
        expect(grams('raw honey')).toBe(14);
        expect(grams('manuka honey')).toBe(14);
    });

    it('honey-flavored product names skip the honey token (own category or guard no-op)', () => {
        expect(getBareQueryDefault('honey nut cheerios')).toBeNull(); // no rule — label serving kept
        expect(grams('honey bunches of oats')).toBe(40);   // oats-dry rule
        expect(grams('honey graham crackers')).toBe(28);   // salty snack (crackers)
        expect(grams('honey mustard')).toBe(14);           // still a condiment via mustard
    });
});
