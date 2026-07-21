/**
 * Unit tests for the OFF bare-query serving guard (PR D pt3, Lever A1).
 * Golden anchors: n-serv-36 (olive oil), n-serv-42 (doritos), n-serv-43
 * (ghost pre workout), n-serv-45 (bacon), n-serv-46 (coca cola),
 * n-serv-48/49/50 (ketchup/honey/peanut butter regression guards),
 * n-serv-27/28 (red bull/clif untouchable tiers).
 */

import { applyOffBareQueryGuard, BareQueryGuardInput } from '../bare-query-guard';
import type { ParsedIngredient } from '../../parse/ingredient-line';

function bare(name: string, over: Partial<ParsedIngredient> = {}): ParsedIngredient {
    return { qty: 1, multiplier: 1, unit: null, name, ...over };
}

function input(over: Partial<BareQueryGuardInput> = {}): BareQueryGuardInput {
    return {
        grams: 250,
        servingTier: 'package_quantity_own',
        parsed: bare('olive oil'),
        rawLine: 'olive oil',
        queryName: 'olive oil',
        foodName: 'Extra Virgin Olive Oil',
        ...over,
    };
}

const CAP_TIERS = [
    'package_count_own',
    'package_count_sibling',
    'package_quantity_own',
    'package_quantity_sibling',
    'label_serving_default',
    'seed_count_default',
];
const REPLACE_TIERS = ['flat_100g_default', 'count_unresolved_floor'];
const UNTOUCHED_TIERS = [
    'weight_unit',
    'volume_unit',
    'label_unit_match',
    'label_serving_package_unit',
    'discrete_unit_backfill',
    'count_unit_cached',
    'count_unit_ai',
    'label_count_derived',
];

describe('applyOffBareQueryGuard — CAP tiers (ratio-gated inflation)', () => {
    it.each(CAP_TIERS)('caps a 250g olive oil package on tier %s', (tier) => {
        const r = applyOffBareQueryGuard(input({ servingTier: tier }));
        expect(r).toEqual({
            grams: 14,
            servingTier: 'bare_category_default',
            servingDescription: '1 serving (~14g)',
        });
    });

    it("caps the bell-pepper seed hijack on bare 'black pepper' (164g seed vs 2.5g spice, n-serv-38)", () => {
        const r = applyOffBareQueryGuard(input({
            grams: 164,
            servingTier: 'seed_count_default',
            parsed: bare('black pepper'),
            rawLine: 'black pepper',
            queryName: 'black pepper',
            foodName: 'Black Pepper',
        }));
        expect(r).toEqual({
            grams: 2.5,
            servingTier: 'bare_category_default',
            servingDescription: '1 serving (~2.5g)',
        });
    });

    it("keeps a legit seed-count serving under the ratio gate ('almond' 1.2g seed vs 28g default)", () => {
        const r = applyOffBareQueryGuard(input({
            grams: 1.2,
            servingTier: 'seed_count_default',
            parsed: bare('almond'),
            rawLine: 'almond',
            queryName: 'almond',
            foodName: 'Almonds',
        }));
        expect(r).toBeNull();
    });

    it('leaves grams within 2x the default alone (ketchup 15g label, n-serv-48)', () => {
        const r = applyOffBareQueryGuard(input({
            grams: 15,
            servingTier: 'label_serving_default',
            parsed: bare('ketchup'),
            rawLine: 'ketchup',
            queryName: 'ketchup',
            foodName: 'Tomato Ketchup',
        }));
        expect(r).toBeNull();
    });

    it('is inert on peanut butter: own 32g entry makes the cap threshold 64g (n-serv-50)', () => {
        const r = applyOffBareQueryGuard(input({
            grams: 32,
            servingTier: 'label_serving_default',
            parsed: bare('peanut butter'),
            rawLine: 'peanut butter',
            queryName: 'peanut butter',
            foodName: 'Creamy Peanut Butter',
        }));
        expect(r).toBeNull();
    });

    it('caps a 130g doritos package to the salty-snack 28g (n-serv-42)', () => {
        const r = applyOffBareQueryGuard(input({
            grams: 130,
            servingTier: 'package_count_own',
            parsed: bare('doritos'),
            rawLine: 'doritos',
            queryName: 'doritos',
            foodName: 'Doritos Nacho Cheese Tortilla Chips',
        }));
        expect(r!.grams).toBe(28);
        expect(r!.servingTier).toBe('bare_category_default');
    });

    it('never uses the foodName lexicon on CAP tiers (finding-3 amendment)', () => {
        // Query has no lexicon entry; the OFF foodName contains "Pretzels".
        // A foodName fallback would cap this genuine 200g label serving.
        const r = applyOffBareQueryGuard(input({
            grams: 200,
            servingTier: 'label_serving_default',
            parsed: bare('brandx puffs'),
            rawLine: 'brandx puffs',
            queryName: 'brandx puffs',
            foodName: 'BrandX Salted Pretzels',
        }));
        expect(r).toBeNull();
    });
});

describe('applyOffBareQueryGuard — REPLACE tiers (fabricated grams)', () => {
    it.each(REPLACE_TIERS)('replaces the 100g floor with the mayo 14g default on tier %s', (tier) => {
        const r = applyOffBareQueryGuard(input({
            grams: 100,
            servingTier: tier,
            parsed: bare('mayonnaise'),
            rawLine: 'mayonnaise',
            queryName: 'mayonnaise',
            foodName: 'Real Mayonnaise',
        }));
        expect(r).toEqual({
            grams: 14,
            servingTier: 'bare_category_default',
            servingDescription: '1 serving (~14g)',
        });
    });

    it('replaces in the inflation direction too (coca cola 100g -> 355g can, n-serv-46)', () => {
        const r = applyOffBareQueryGuard(input({
            grams: 100,
            servingTier: 'flat_100g_default',
            parsed: bare('coca cola'),
            rawLine: 'coca cola',
            queryName: 'coca cola',
            foodName: 'Coca-Cola Classic',
        }));
        expect(r!.grams).toBe(355);
    });

    it('falls back to the foodName lexicon on REPLACE tiers (finding-3 amendment)', () => {
        // Same no-entry query as the CAP counterexample — fabricated tier, so
        // the product name ("… Pretzels") may resolve the category.
        const r = applyOffBareQueryGuard(input({
            grams: 100,
            servingTier: 'flat_100g_default',
            parsed: bare('brandx puffs'),
            rawLine: 'brandx puffs',
            queryName: 'brandx puffs',
            foodName: 'BrandX Salted Pretzels',
        }));
        expect(r!.grams).toBe(28);
        expect(r!.servingTier).toBe('bare_category_default');
    });

    it('is a no-op when neither name has a lexicon entry (greek yogurt)', () => {
        const r = applyOffBareQueryGuard(input({
            grams: 100,
            servingTier: 'flat_100g_default',
            parsed: bare('greek yogurt'),
            rawLine: 'greek yogurt',
            queryName: 'greek yogurt',
            foodName: 'Chobani Greek Yogurt',
        }));
        expect(r).toBeNull();
    });

    it('honey replaces the flat floor since its 2026-07-21 condiment entry (n-serv-49 flap fix)', () => {
        const r = applyOffBareQueryGuard(input({
            grams: 100,
            servingTier: 'flat_100g_default',
            parsed: bare('honey'),
            rawLine: 'honey',
            queryName: 'honey',
            foodName: 'Raw Wildflower Honey',
        }));
        expect(r).toEqual({
            grams: 14,
            servingTier: 'bare_category_default',
            servingDescription: '1 serving (~14g)',
        });
    });
});

describe('applyOffBareQueryGuard — never-touched tiers', () => {
    it.each(UNTOUCHED_TIERS)('returns null on tier %s even with a lexicon hit and huge grams', (tier) => {
        const r = applyOffBareQueryGuard(input({ grams: 500, servingTier: tier }));
        expect(r).toBeNull();
    });

    it('never touches a label-unit tier without a query lexicon entry (red bull can, n-serv-27)', () => {
        const r = applyOffBareQueryGuard(input({
            grams: 250,
            servingTier: 'label_serving_package_unit',
            parsed: bare('red bull'),
            rawLine: 'red bull',
            queryName: 'red bull',
            foodName: 'Red Bull Energy Drink',
        }));
        expect(r).toBeNull();
    });
});

describe('applyOffBareQueryGuard — eligibility gates', () => {
    it('rejects raw lines containing digits ("15 pretzels" keeps its count floor)', () => {
        const r = applyOffBareQueryGuard(input({
            grams: 100,
            servingTier: 'count_unresolved_floor',
            parsed: bare('pretzels', { qty: 1 }),
            rawLine: '15 pretzels',
            queryName: 'pretzels',
            foodName: 'Salted Pretzels',
        }));
        expect(r).toBeNull();
    });

    it('rejects when a unit is present', () => {
        const r = applyOffBareQueryGuard(input({
            parsed: bare('olive oil', { unit: 'cup' }),
        }));
        expect(r).toBeNull();
    });

    it('rejects qty !== 1', () => {
        const r = applyOffBareQueryGuard(input({
            parsed: bare('olive oil', { qty: 2 }),
            rawLine: 'two olive oils',
        }));
        expect(r).toBeNull();
    });

    it('rejects multiplier !== 1', () => {
        const r = applyOffBareQueryGuard(input({
            parsed: bare('olive oil', { multiplier: 2 }),
        }));
        expect(r).toBeNull();
    });

    it('rejects a null parse', () => {
        expect(applyOffBareQueryGuard(input({ parsed: null }))).toBeNull();
    });

    it('rejects an undefined serving tier', () => {
        expect(applyOffBareQueryGuard(input({ servingTier: undefined }))).toBeNull();
    });
});

describe('applyOffBareQueryGuard — kill-switch', () => {
    const original = process.env.OFF_BARE_SERVING_GUARD;

    afterEach(() => {
        if (original === undefined) delete process.env.OFF_BARE_SERVING_GUARD;
        else process.env.OFF_BARE_SERVING_GUARD = original;
    });

    it('OFF_BARE_SERVING_GUARD=0 disables the guard entirely', () => {
        process.env.OFF_BARE_SERVING_GUARD = '0';
        expect(applyOffBareQueryGuard(input())).toBeNull();
    });

    it('any other value keeps the guard active', () => {
        process.env.OFF_BARE_SERVING_GUARD = '1';
        expect(applyOffBareQueryGuard(input())).not.toBeNull();
    });
});
