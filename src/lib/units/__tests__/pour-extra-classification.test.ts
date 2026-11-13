import { resolveVolumeGrams } from '../volume-density';

/**
 * Route 5 (2026-10-17) — half and half, heavy / whipping / light cream and cola
 * brand names billed the dry 0.5 g/ml (`a tablespoon of half and half` 7.5 g,
 * `1 cup of coke` 120 g). POUR_EXTRA_RE in volume-density.ts moves them to the
 * beverage class (liquid numbers: tbsp 15, cup 240).
 *
 * Blocks mirror beverage-classification.test.ts: the defect (red before the
 * change), the collisions (names that carry a token but must NOT move), and the
 * control (untouched classes, green on both trees).
 */

describe('route 5 — pourable dairy and cola brands (the defect)', () => {
    it.each([
        'Half and half', 'Half & Half', 'Half-and-Half', "Half n' Half", 'half and half creamer',
        'Heavy Cream', 'heavy whipping cream', 'Light Cream',
        'coke', 'Diet Coke', 'Coke Zero', 'Pepsi', 'Sprite', 'Sprite Zero', 'Dr Pepper',
        'Mountain Dew', 'Fanta Orange', '7up',
    ])('%s is a beverage billed at 15 g/tbsp and 240 g/cup', (name) => {
        const r = resolveVolumeGrams(name);
        expect(r.volumeClass).toBe('beverage');
        expect(r.perUnit.tbsp).toBe(15);
        expect(r.perUnit.cup).toBe(240);
    });
});

describe('route 5 — collisions keep their base class', () => {
    it.each([
        'Coke Glazed Ham', 'Coke Chicken Wings', 'Pepsi Pulled Pork', 'Dr Pepper Ribs',
        'Sprite Gummies', 'Popcorn with Coke Flavor', '7up Bundt Cake',
        'Heavy Cream Biscuits', 'Half and Half Pizza',
        'Double Cream Brie', 'Double Cream Gouda',
        'Ice Cream', 'Whipped cream', 'Cream of wheat', 'Boston Cream Pie', 'Cookies and cream',
    ])('%s stays a solid', (name) => {
        const r = resolveVolumeGrams(name);
        expect(r.volumeClass).toBe('solid');
        expect(r.volumeClass).not.toBe('beverage');
    });

    it.each(['Sour Cream', 'Cream Cheese'])('%s stays a paste', (name) => {
        expect(resolveVolumeGrams(name).volumeClass).toBe('paste');
    });

    it('a powdered creamer keeps its current class (beverage via `coffee`, already pre-existing)', () => {
        // Not moved by this change: BEVERAGE_RE's `coffee` already claims it.
        expect(resolveVolumeGrams('Coffee-mate Original Powdered Creamer').volumeClass).toBe('beverage');
    });
});

describe('route 5 — control: the other classes are unchanged', () => {
    it('Milk is liquid, Coffee and Root Beer are beverages', () => {
        expect(resolveVolumeGrams('Milk').volumeClass).toBe('liquid');
        expect(resolveVolumeGrams('Coffee').volumeClass).toBe('beverage');
        expect(resolveVolumeGrams('Root Beer').volumeClass).toBe('beverage');
    });

    it('Honey is a paste; Sugar and Flour are solids', () => {
        expect(resolveVolumeGrams('Honey').volumeClass).toBe('paste');
        expect(resolveVolumeGrams('Sugar').volumeClass).toBe('solid');
        expect(resolveVolumeGrams('Flour').volumeClass).toBe('solid');
    });
});
