import { resolveVolumeGrams, volumeToGrams } from '../volume-density';

/**
 * Lane B1b — the volume classifier missed drinkable beverages.
 *
 * WHY THIS FILE EXISTS. `LIQUID_RE` names nine tokens (broth, stock, water,
 * juice, milk, sauce, vinegar, oil, syrup) and nothing else pours. Measured
 * 2026-08-17 over the 314 seeds the coverage corpus itself labels
 * `sodas-energy` / `coffee-tea` / `alcohol`, it classified 32 of them liquid —
 * 10.2% recall — so 89.5% of drinkable foods were billed at the dry-goods
 * 0.5 g/ml and `1 cup coffee` came to 120 g. Re-derive:
 *   awk -F'\t' '$1=="coffee-tea"||$1=="sodas-energy"||$1=="alcohol"{print $3}' \
 *     scripts/eval/coverage-corpus-2026-08-08.tsv
 * then run each through resolveVolumeGrams().
 *
 * The blocks below are split on purpose:
 *   - "the defect" assertions were RED before the fix and are the diagnostic;
 *   - "unchanged" assertions are GREEN ON BOTH TREES and are the control. A red
 *     in this file means nothing unless the control block is green, because a
 *     test that only asserts values its own commit just changed proves nothing.
 */

describe('B1b — the drinkable-beverage tier (the defect)', () => {
    // Every one of these was `solid` at 0.5 g/ml before 2026-08-17.
    it.each([
        'Coffee', 'Iced Coffee', 'Espresso', 'Caffe Latte', 'Cappuccino',
        'Cold Brew', 'Caramel Macchiato', 'Mocha Frappuccino',
        'Green Tea', 'Sweet Tea', 'Kombucha', 'Chai',
        'Cola', 'Coca-Cola', 'Root Beer', 'Ginger Ale', 'Lemonade',
        'Club Soda', 'Tonic', 'Sports Drink', 'Energy Drink',
        'Smoothie', 'Protein Shake', 'Kefir', 'Horchata', 'Mango Lassi',
        'Hot Chocolate', 'Eggnog',
        'Lager', 'Pale Ale', 'Stout', 'Hard Cider', 'Red Wine', 'Champagne',
    ])('%s is a beverage, not a 0.5 g/ml solid', (name) => {
        expect(resolveVolumeGrams(name).volumeClass).toBe('beverage');
    });

    it('1 cup of coffee bills 240 g, not the dry-goods 120 g', () => {
        expect(volumeToGrams(1, 'cup', 'Coffee')!.grams).toBe(240);
        // The number this replaces, spelled out so a re-tune has to argue with it:
        expect(240 * 0.5).toBe(120);
    });

    it('the beverage tier is the LIQUID numbers, not a new density', () => {
        // The module header forbids changing the NUMBERS here — this is a
        // CLASSIFICATION change only. Mutation: give beverages their own g/ml
        // and this goes red on the first differing key.
        const bev = resolveVolumeGrams('Cold Brew');
        const liq = resolveVolumeGrams('Whole Milk');
        expect(bev.volumeClass).toBe('beverage');
        expect(liq.volumeClass).toBe('liquid');
        expect(bev.perUnit).toEqual(liq.perUnit);
    });

    /**
     * The vocabulary is checked LAST, so the change is provably one-directional:
     * a name that is liquid or paste today keeps its class and its grams.
     */
    it('is one-directional — only `solid` can become `beverage`', () => {
        // "Butter Sauce" is liquid via LIQUID_RE and contains no beverage token;
        // "Port Wine Cheese Spread" is a PASTE that DOES contain one (`wine`).
        // Order is what keeps it a spread.
        expect(resolveVolumeGrams('Butter Sauce').volumeClass).toBe('liquid');
        expect(resolveVolumeGrams('Port Wine Cheese Spread').volumeClass).toBe('paste');
        expect(resolveVolumeGrams('Port Wine Cheese Spread').perUnit['cup']).toBe(250);
    });
});

/**
 * PRECISION. Each name here is a measured collision from the 4,102-seed coverage
 * corpus — a solid food whose name carries a drink word. All 3,788 non-drink
 * seeds were classified either side of the change; these are the only shapes
 * that had to be excluded by hand, and every remaining flip was graded a genuine
 * drinkable. Re-derive by running resolveVolumeGrams() over column 3 of
 * scripts/eval/coverage-corpus-2026-08-08.tsv.
 */
describe('B1b — the measured collisions the vocabulary must NOT sweep in', () => {
    it.each([
        // `shake`: two chain names put it in front of a burger. Admitted only as
        // `protein/meal replacement/milk shake` or at the END of the name.
        'Shake Shack Crinkle Cut Fries', 'Shake Shack Shroom Burger',
        'Steak n Shake Chili', 'Steak n Shake Frisco Melt',
        // distilled spirits are excluded outright — as flavour words they name
        // solids, and at ~0.94 g/ml they are not the 1.0 class anyway.
        'Bourbon Street Chicken', 'Whiskey River BBQ Burger', 'Penne Vodka',
        // `soda`'s one measured collision.
        'Baking Soda',
        // cocoa POWDER is a 0.55 g/ml dry solid; only `hot cocoa` is the drink.
        'Cocoa Powder',
        // boundary checks on short tokens: ale/tea/porter/rum inside longer words
        'Kale Salad', 'Steak', 'Porterhouse Steak', 'Breadcrumbs', 'Chipotle Bowl',
    ])('%s stays a solid', (name) => {
        expect(resolveVolumeGrams(name).volumeClass).toBe('solid');
    });

    it('a milkshake at the end of the name IS admitted', () => {
        // The other half of the `shake` rule — dropping it entirely would lose
        // the whole protein-shake population, which is 25 corpus seeds.
        expect(resolveVolumeGrams('Neapolitan Shake').volumeClass).toBe('beverage');
        expect(resolveVolumeGrams('Premier Protein Shake Chocolate').volumeClass).toBe('beverage');
    });
});

/**
 * THE CONTROL. Nothing in this block is touched by the beverage tier; every
 * assertion is green on the pre-fix tree too. If these ever go red at the same
 * time as the block above, the diagnosis is "the change did something else",
 * not "the fix worked".
 */
describe('B1b — control: the classes that existed before are unchanged', () => {
    it('LIQUID_RE liquids keep their class and their grams', () => {
        for (const name of ['Chicken Broth', 'Whole Milk', 'Orange Juice', 'Maple Syrup', 'Olive Oil']) {
            const r = resolveVolumeGrams(name);
            expect(r.volumeClass).toBe('liquid');
            expect(r.perUnit['cup']).toBe(240);
        }
    });

    it('pastes keep their class and their grams', () => {
        expect(resolveVolumeGrams('Peanut Butter').volumeClass).toBe('paste');
        expect(volumeToGrams(2, 'tbsp', 'Peanut Butter')!.grams).toBe(32);
        expect(volumeToGrams(1, 'cup', 'Greek Yogurt')!.grams).toBe(250);
    });

    it('solids keep the 0.5 default and the dry-granule override', () => {
        expect(resolveVolumeGrams('Salt').solidDensity).toBe(0.5);
        expect(volumeToGrams(1, 'tbsp', 'Salt')!.grams).toBe(7.5);
        expect(resolveVolumeGrams('Granulated Sugar').solidDensity).toBeGreaterThan(0.5);
        expect(resolveVolumeGrams('White Rice').solidDensity).toBe(0.5);
    });

    it('an empty name is still a plain solid, never a crash', () => {
        expect(resolveVolumeGrams(null, undefined, '').volumeClass).toBe('solid');
    });

    it('the units this module has no value for are still dropped, not undefined', () => {
        expect(volumeToGrams(1, 'liter', 'Whole Milk')).toBeNull();
        expect(volumeToGrams(1, 'gallon', 'Whole Milk')).toBeNull();
    });
});
