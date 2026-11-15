import { resolveVolumeGrams, volumeToGrams } from '../volume-density';

/**
 * Wet fresh dairy bills the paste cell (s459 DENS-2). WET_DAIRY_RE in
 * volume-density.ts is a slice checked LAST, so only solid -> paste can move
 * and no number moves.
 *
 * Blocks: the defect (red on base), the exclusions (BASE class and cup
 * pinned), and the control (the other classes byte-identical).
 */

describe('wet dairy paste — the defect', () => {
    it.each([
        // The records the cold pipeline lands on today (s459 pd-cot probes C01-C08).
        'Cottage cheese', 'Fat Free Cottage Cheese', 'Cottage Cheese Pineapple', 'Skyr', 'Labneh', 'Creme fraiche', 'Quark',
        // Spellings and label forms from the record census.
        'Cottage chese', '4% Small Curd Cottage Cheese', 'Cheese, cottage', '1% Queso Cottage', "Siggis' Skyr",
        'Crème Fraîche', 'Quark cheese', 'Fromage frais', 'Fromage blanc', 'Labne',
        // The token BEFORE a connector keeps the class.
        'Cottage Cheese with Pineapple', 'Cottage cheese with cucumber and dill',
    ])('%s is a paste billed at 16 g/tbsp and 250 g/cup', (name) => {
        const r = resolveVolumeGrams(name);
        expect(r.volumeClass).toBe('paste');
        expect(r.perUnit.tbsp).toBe(16);
        expect(r.perUnit.cup).toBe(250);
    });

    it('0.5 cup of OFF `Cottage cheese` bills 125 g, the half cup `1 cup greek yogurt` already bills (label truth ~113 g)', () => {
        expect(volumeToGrams(0.5, 'cup', 'Cottage cheese')).toEqual({ grams: 125, volumeClass: 'paste' });
        expect(volumeToGrams(0.5, 'cup', 'greek yogurt')).toEqual({ grams: 125, volumeClass: 'paste' });
    });
});

describe('wet dairy paste — exclusions are byte-identical to BASE (class and cup pinned)', () => {
    it.each([
        // `cottage` alone is not the cheese.
        ['Cottage Pie', 'solid', 120], ['Cottage Bread', 'solid', 120], ['Cottage Bacon', 'solid', 120],
        // Dry and frozen forms (dry curd ~0.6 g/ml; ice cream ~0.57).
        ['Dry Curd Cottage Cheese', 'solid', 120], ['Cottage cheese powder', 'solid', 120], ['Cottage Cheese Ice Cream', 'solid', 120],
        // Paneer sold as `Indian cottage cheese`.
        ['PANERIR Indian cottage cheese', 'solid', 120], ['Paneer (Cottage cheese)', 'solid', 120],
        // Dishes and bakes that carry the token.
        ['Cottage Cheese Perogies', 'solid', 120], ['Sweet Cottage Cheese Pierogi', 'solid', 120],
        ['Cottage Cheese Pancakes', 'solid', 120], ['Cottage Cheese Crust Four-Cheese Pizza', 'solid', 120],
        ['The original cottage cheese bar', 'solid', 120], ['Skyr Bun', 'solid', 120], ['Skyr granola', 'solid', 120],
        ['Quark Riegel Schoko', 'solid', 120], ['Blechkuchen Quark', 'solid', 120], ['Spinach Creme Fraiche Flatbread', 'solid', 120],
        ['Potato Cottage Cheese', 'solid', 120], ['Fresh Fruit and Cottage Cheese Plate', 'solid', 120],
        ['Pressed Cottage Cheese', 'solid', 120], ['Fromage frais à pâte ferme', 'solid', 120],
        // The token as an accompaniment.
        ['Pancakes with cottage cheese and raisins', 'solid', 120],
        ['Mediterranean Turkey Meatballs with Vegetable Farro & Labneh', 'solid', 120],
        ['Smoked Salmon with Crème Fraîche', 'solid', 120], ['Roasted Carrots with Labneh', 'solid', 120],
        ['Beets w/ skyr', 'solid', 120], ['Saumon avec fromage frais', 'solid', 120],
    ])('%s stays %s at %d g/cup', (name, cls, cup) => {
        const r = resolveVolumeGrams(name);
        expect(r.volumeClass).toBe(cls);
        expect(r.perUnit.cup).toBe(cup);
    });
});

describe('wet dairy paste — control: the other classes are byte-identical', () => {
    it.each([
        // Dairy the earlier slices already own.
        ['greek yogurt', 'paste', 250], ['Icelandic Style Skyr Non-fat Yogurt - Plain', 'paste', 250],
        ['sour cream', 'paste', 250], ['cream cheese', 'paste', 250], ['ricotta', 'paste', 250],
        ['Whole Milk Classic Cottage Cheese', 'liquid', 240], ['Labne Kefir Cheese', 'beverage', 240],
        ['Skyr Smoothie - Mango Banana', 'beverage', 240], ['heavy cream', 'beverage', 240], ['Ranch', 'paste', 250],
        // Light dairy that is NOT in this class (shredded ~0.47, ice cream ~0.57 g/ml).
        ['Shredded Cheddar', 'solid', 120], ['Grated Parmesan', 'solid', 120], ['Ice cream', 'solid', 120],
        ['Cream', 'solid', 120], ['Creamer', 'solid', 120],
        ['white rice', 'solid', 120], ['Cheerios', 'solid', 36],
    ])('%s stays %s at %d g/cup', (name, cls, cup) => {
        const r = resolveVolumeGrams(name);
        expect(r.volumeClass).toBe(cls);
        expect(r.perUnit.cup).toBeCloseTo(cup as number, 6);
    });
});
