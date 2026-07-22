/**
 * Unit tests for the OFF bare-query serving guard (PR D pt3, Lever A1).
 * Golden anchors: n-serv-36 (olive oil), n-serv-42 (doritos), n-serv-43
 * (ghost pre workout), n-serv-45 (bacon), n-serv-46 (coca cola),
 * n-serv-48/49/50 (ketchup/honey/peanut butter regression guards),
 * n-serv-27/28 (red bull/clif untouchable tiers).
 */

import {
    applyOffBareQueryGuard, BareQueryGuardInput,
    isBareUnitlessQty1, usableBareLabelServing,
} from '../bare-query-guard';
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

describe('usableBareLabelServing — own-label usability band (Track 3)', () => {
    it('accepts a genuine in-band label serving (yoplait 170g)', () => {
        expect(usableBareLabelServing(170, null)).toBe(170);
    });

    it('rejects the flat-100g placeholder in all its spellings', () => {
        expect(usableBareLabelServing(100, null)).toBeNull();       // "100 g" / no description
        expect(usableBareLabelServing(100, 'g')).toBeNull();        // "100.0g"
        expect(usableBareLabelServing(100, 'portion')).toBeNull();  // "1 portion (100 g)"
    });

    it('accepts a genuine 100g serving carried by a household unit word ("1 cup (100 g)")', () => {
        expect(usableBareLabelServing(100, 'cup')).toBe(100);
    });

    it('rejects garbage sub-3g metadata (trout/hot-pocket "1.0g" rows)', () => {
        expect(usableBareLabelServing(1, 'g')).toBeNull();
        expect(usableBareLabelServing(1, null)).toBeNull();
    });

    it('rejects package-scale servings above 400g (turkey-leg 976g pack, miso 623g tub)', () => {
        expect(usableBareLabelServing(976, 'leg')).toBeNull();
        expect(usableBareLabelServing(623.7, 'container')).toBeNull();
    });

    it('accepts a single-serve RTD at 355g (pumpkin spice latte)', () => {
        expect(usableBareLabelServing(355, 'portion')).toBe(355);
    });

    it('rejects null/zero', () => {
        expect(usableBareLabelServing(null, null)).toBeNull();
        expect(usableBareLabelServing(0, null)).toBeNull();
    });
});

describe('applyOffBareQueryGuard — head-gated CAP on bare_label/bare_sibling tiers (Track 3)', () => {
    it("still caps a whole-bottle label when the category IS the query head ('olive oil' 250g → 14g)", () => {
        const r = applyOffBareQueryGuard(input({
            grams: 250,
            servingTier: 'bare_label_serving',
        }));
        expect(r).toEqual({
            grams: 14,
            servingTier: 'bare_category_default',
            servingDescription: '1 serving (~14g)',
        });
    });

    it("does NOT cap a genuine label on a contained-token hijack ('pepper jack' 28g vs spice 2.5g)", () => {
        const r = applyOffBareQueryGuard(input({
            grams: 28,
            servingTier: 'bare_label_serving',
            parsed: bare('pepper jack'),
            rawLine: 'pepper jack',
            queryName: 'pepper jack',
            foodName: 'Pepper Jack Cheese Slices',
        }));
        expect(r).toBeNull();
    });

    it("does NOT cap 'butter chicken' (condiment token, head 'chicken') — the 100g portion stands", () => {
        const r = applyOffBareQueryGuard(input({
            grams: 100,
            servingTier: 'bare_label_serving',
            parsed: bare('butter chicken'),
            rawLine: 'butter chicken',
            queryName: 'butter chicken',
            foodName: 'Butter Chicken',
        }));
        expect(r).toBeNull();
    });

    it("does NOT cap 'pumpkin spice latte' (spice token, head 'latte') — the 355ml RTD stands", () => {
        const r = applyOffBareQueryGuard(input({
            grams: 355,
            servingTier: 'bare_label_serving',
            parsed: bare('pumpkin spice latte'),
            rawLine: 'pumpkin spice latte',
            queryName: 'pumpkin spice latte',
            foodName: 'Pumpkin Spice Oat Latte',
        }));
        expect(r).toBeNull();
    });

    it('never touches the sibling-median tier (median of >=3 real labels beats a category default)', () => {
        // Even a head-anchored lexicon hit ("olive oil") leaves the sibling
        // median alone; and trailing-lexicon-noun dishes keep their median
        // ("hot pocket ham and cheese" 127g must not become a 28g cheese cap).
        expect(applyOffBareQueryGuard(input({
            grams: 250,
            servingTier: 'bare_sibling_serving',
        }))).toBeNull();

        expect(applyOffBareQueryGuard(input({
            grams: 127,
            servingTier: 'bare_sibling_serving',
            parsed: bare('hot pocket ham and cheese'),
            rawLine: 'hot pocket ham and cheese',
            queryName: 'hot pocket ham and cheese',
            foodName: 'Ham & Cheese Hot Pocket',
        }))).toBeNull();
    });

    it('peanut butter keeps its multi-word category on the head gate (head "butter" is lexicon-covered)', () => {
        // 300g package-scale "label" on a bare peanut butter query: head token
        // "butter" is itself lexicon-covered, so the CAP fires with the
        // full-query 32g default (300 > 64).
        const r = applyOffBareQueryGuard(input({
            grams: 300,
            servingTier: 'bare_label_serving',
            parsed: bare('peanut butter'),
            rawLine: 'peanut butter',
            queryName: 'peanut butter',
            foodName: 'Creamy Peanut Butter',
        }));
        expect(r!.grams).toBe(32);
    });
});

describe('applyOffBareQueryGuard — bounded discrete floor on REPLACE tiers (Track 3)', () => {
    it("bills one ~50g bar instead of the flat 100g ('quest protein bar birthday cake')", () => {
        const r = applyOffBareQueryGuard(input({
            grams: 100,
            servingTier: 'flat_100g_default',
            parsed: bare('quest protein bar birthday cake'),
            rawLine: 'quest protein bar birthday cake',
            queryName: 'quest protein bar birthday cake',
            foodName: 'Protein Bar Birthday Cake',
        }));
        expect(r).toEqual({
            grams: 50,
            servingTier: 'bare_discrete_floor',
            servingDescription: '1 bar (~50g)',
        });
    });

    it('lexicon categories still win over the floor (doritos stays 28g via salty snacks)', () => {
        const r = applyOffBareQueryGuard(input({
            grams: 100,
            servingTier: 'flat_100g_default',
            parsed: bare('doritos'),
            rawLine: 'doritos',
            queryName: 'doritos',
            foodName: 'Doritos Nacho Cheese Tortilla Chips',
        }));
        expect(r!.grams).toBe(28);
        expect(r!.servingTier).toBe('bare_category_default');
    });

    it('falls back to the foodName noun when the query names none', () => {
        const r = applyOffBareQueryGuard(input({
            grams: 100,
            servingTier: 'count_unresolved_floor',
            parsed: bare('barebells caramel'),
            rawLine: 'barebells caramel',
            queryName: 'barebells caramel',
            foodName: 'Barebells Caramel Protein Bar',
        }));
        expect(r!.servingTier).toBe('bare_discrete_floor');
        expect(r!.grams).toBe(50);
    });

    it('still a no-op when neither lexicon nor a discrete noun applies (greek yogurt)', () => {
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
});

describe('isBareUnitlessQty1', () => {
    it('accepts a digitless unitless qty-1 line', () => {
        expect(isBareUnitlessQty1(bare('protein bar'), 'protein bar')).toBe(true);
    });

    it.each([
        ['digit in raw line', bare('gatorade'), '1 gatorade'],
        ['explicit unit', bare('olive oil', { unit: 'cup' }), 'cup of olive oil'],
        ['qty !== 1', bare('almonds', { qty: 2 }), 'two almonds'],
        ['multiplier !== 1', bare('olive oil', { multiplier: 2 }), 'olive oil'],
    ])('rejects %s', (_label, parsed, rawLine) => {
        expect(isBareUnitlessQty1(parsed as ParsedIngredient, rawLine as string)).toBe(false);
    });

    it('rejects a null parse', () => {
        expect(isBareUnitlessQty1(null, 'olive oil')).toBe(false);
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
