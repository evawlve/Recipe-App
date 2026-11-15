import { resolveVolumeGrams, volumeToGrams } from '../volume-density';

/**
 * Dressings, dips and condiment spreads bill the paste cell (s459 R-DENS).
 * CONDIMENT_RE in volume-density.ts is a slice checked LAST, so only
 * solid -> paste can move and no number moves.
 *
 * Blocks: the defect (red on base), the exclusions and the OUT tokens (BASE
 * class and cup pinned), and the control (the other classes byte-identical).
 */

describe('condiment paste — the defect', () => {
    it.each([
        'Ranch', 'Hidden Valley Ranch', 'Light ranch', 'Avocado Ranch', 'Buffalo Ranch', 'The Original Ranch',
        'Ranch Dip', 'Bacon & Ranch Dip', 'Pesto', 'Basil Pesto', 'Tzatziki', 'Baba ganoush', 'Baba Ghanoush',
        'Guacamole', 'Guac', 'Garlic Aioli', 'Thousand island', 'Chimichurri', 'Olive Tapenade', 'Remoulade',
        'French Onion Dip', 'Queso dip', 'Spinach & Artichoke Dip', 'Raspberry Vinaigrette',
        // s459 rf-dens: the token BEFORE a connector keeps the class; a brand that contains a dish word does too.
        'Basil pesto with fresh fennel', 'Guacamole with Tomatoes', 'El Pollo Loco, Lowfat Citrus Vinaigrette',
    ])('%s is a paste billed at 16 g/tbsp and 250 g/cup', (name) => {
        const r = resolveVolumeGrams(name);
        expect(r.volumeClass).toBe('paste');
        expect(r.perUnit.tbsp).toBe(16);
        expect(r.perUnit.cup).toBe(250);
    });

    it('2 tbsp of FatSecret `Ranch` bills 32 g, the cell `2 tbsp ranch dressing` already bills', () => {
        expect(volumeToGrams(2, 'tbsp', 'Ranch')).toEqual({ grams: 32, volumeClass: 'paste' });
        expect(volumeToGrams(2, 'tbsp', 'Ranch dressing')).toEqual({ grams: 32, volumeClass: 'paste' });
    });
});

describe('condiment paste — exclusions and OUT tokens are byte-identical to BASE (class and cup pinned)', () => {
    it.each([
        // Flavour words on snacks.
        ['Cool Ranch', 'solid', 120], ['Doritos cool ranch', 'solid', 120], ["Flamin' Hot Cool Ranch", 'solid', 120],
        ['Dill Pickle & Ranch', 'solid', 120], ['Farmhouse Cheese & Ranch', 'solid', 120],
        ['Zesty Ranch Veggie Straws', 'solid', 120], ['Ranch Wheat Thins', 'solid', 120], ['Ranch sunflower kernels', 'solid', 144],
        ['Chipsy tzatziki', 'solid', 120], ['Hint of Guacamole', 'solid', 120],
        // Dry forms.
        ['Ranch Seasoning Mix', 'solid', 120], ['Hidden Valley Ranch Dip Mix', 'solid', 120], ['Guacamole Seasoning', 'solid', 120],
        // Dishes that carry the condiment.
        ['Pesto Ravioli', 'solid', 120], ['Chicken Pesto Pasta', 'solid', 120], ['French Dip', 'solid', 120],
        ['Veggies & Dip', 'solid', 120], ['Tostada with Guacamole', 'solid', 120], ['Bacon Ranch Pizza', 'solid', 120],
        // s459 rf-dens: dish heads and flavour-named snacks the 320-name OFF sample found leaking under r0.
        ['Basil pesto shrimp', 'solid', 120], ['Pesto Risotto', 'solid', 120], ['Guacamole Burrito', 'solid', 120],
        ['Ranch Quesadilla', 'solid', 120], ['Basil pesto lasagna, basil pesto', 'solid', 120], ['Pesto Panini', 'solid', 120],
        ['Chimichurri Rice', 'solid', 120], ['Texas Ranch Beans', 'solid', 120], ['Ranch Cheese Curds', 'solid', 120],
        ['Kale Pesto Meatballs', 'solid', 120], ['Ravioloni burratta pesto pistacchio', 'solid', 120],
        ['Hidden Valley Bacon Ranch Shells & Cheese', 'solid', 120], ['Ranch Thinables', 'solid', 120],
        ['Harvest Snaps Wasabi Ranch', 'solid', 120], ['Wavy Tzatziki', 'solid', 120], ['Pesto Margherita Pizz', 'solid', 120],
        ['Niman ranch, andouille sausage', 'solid', 120], ['Ranch 99 Jasmine Rice', 'solid', 120],
        // The condiment as an accompaniment.
        ['Nocellara Olives with Pesto', 'solid', 120], ['Margherita with basil pesto', 'solid', 120],
        ['Vegetable Palooza with Ranch Dip', 'solid', 120], ['Steamed greens w/ pesto', 'solid', 120],
        ['Légumes grillés au chimichurri', 'solid', 120],
        // Not the dressing.
        ['Huevos Rancheros', 'solid', 120], ['Ranch Water', 'liquid', 240],
        // OUT tokens (see the slice header).
        ['Gravy', 'solid', 120], ['Brown Gravy', 'solid', 120], ['Salsa', 'solid', 120], ['Salsa verde', 'solid', 120],
        ['Queso Fresco', 'solid', 120], ['Caesar Salad', 'solid', 120], ['Blue Cheese Crumbles', 'solid', 120],
    ])('%s stays %s at %d g/cup', (name, cls, cup) => {
        const r = resolveVolumeGrams(name);
        expect(r.volumeClass).toBe(cls);
        expect(r.perUnit.cup).toBe(cup);
    });
});

describe('condiment paste — control: the other classes are byte-identical', () => {
    it.each([
        ['Ranch dressing', 'paste', 250], ['Honey mustard', 'paste', 250], ['hummus', 'paste', 250],
        ['peanut butter', 'paste', 250], ['bbq sauce', 'liquid', 240], ['chicken broth', 'liquid', 240],
        ['coke', 'beverage', 240], ['Broccoli Cheddar Soup', 'beverage', 240], ['Crema de cacahuate', 'paste', 250],
        ['Leche', 'beverage', 240], ['Cheerios', 'solid', 36], ['Boom chicka pop', 'solid', 9.6],
        // s459 DENS-2 moved `Cottage cheese` to paste on purpose (wet-dairy-paste-classification.test.ts).
        ['white rice', 'solid', 120], ['Cottage cheese', 'paste', 250],
    ])('%s stays %s at %d g/cup', (name, cls, cup) => {
        const r = resolveVolumeGrams(name);
        expect(r.volumeClass).toBe(cls);
        expect(r.perUnit.cup).toBeCloseTo(cup as number, 6);
    });
});
