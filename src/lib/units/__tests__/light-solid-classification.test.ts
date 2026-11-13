/**
 * S1 (s457): a typed cup of a light dry food — RTE cereal, popped/puffed snacks — bills a per-class
 * density, not the 0.5 g/ml solid default. Owner: `lightSolidClass()` / LIGHT_SOLID_DENSITY_GML in ../volume-density.ts.
 * The class test runs FIRST (before liquid/paste/beverage), because on these names `butter` and `honey` are
 * flavour or compound words; the exclude lists keep every MUST-HOLD below byte-identical to base (82544ddd).
 */
import { resolveVolumeGrams, volumeToGrams, lightSolidClass } from '../volume-density';

describe('S1 class table — the cup cell is 240 x the class density', () => {
    it.each([
        ['Cheerios', 'cereal', 36], ['Whole Grain Cheerios', 'cereal', 36], ['Bran flakes', 'cereal', 36],
        ['Cereal', 'cereal', 36], ['Kix', 'cereal', 36], ['Rice Krispies', 'cereal', 36], ['Corn flakes', 'cereal', 36],
        ['Toasted Oat Cereal', 'cereal', 36], ['Honey Nut Cheerios', 'cereal', 36],
        ['Popcorn', 'puffed', 9.6], ['Light popcorn', 'puffed', 9.6], ['Boom chicka pop', 'puffed', 9.6],
        ['Smartfood popcorn', 'puffed', 9.6], ['Kettle corn', 'puffed', 9.6], ['Puffed Rice Cereal', 'puffed', 9.6],
        ['Movie Theater Butter Popcorn', 'puffed', 9.6],
        ['Cappuccino Popcorn', 'puffed', 9.6], ['Céréales Cheerios', 'cereal', 36],
    ])('%s -> %s, %d g/cup', (name, cls, cup) => {
        expect(lightSolidClass(name)).toBe(cls);
        const r = resolveVolumeGrams(name);
        expect(r.perUnit['cup']).toBeCloseTo(cup as number, 6);
        expect(r.volumeClass).toBe('solid');
        expect(r.lightClass).toBe(cls);
    });

    it('tbsp and tsp scale by the same density', () => {
        expect(resolveVolumeGrams('Popcorn').perUnit['tbsp']).toBeCloseTo(0.6, 6);
        expect(resolveVolumeGrams('Cheerios').perUnit['tsp']).toBeCloseTo(0.75, 6);
    });

    it('volumeToGrams() (the FatSecret density fallback) carries it: 3 cups of popcorn is 28.8 g', () => {
        expect(volumeToGrams(3, 'cup', 'Popcorn')?.grams).toBeCloseTo(28.8, 6);
    });
});

describe('S1 MUST-HOLD — byte-identical to base 82544ddd (volumeClass, cup)', () => {
    it.each([
        ['Olive oil', 'liquid', 240], ['Vegetable Oil', 'liquid', 240], ['Peanut butter', 'paste', 250],
        ['Almond butter', 'paste', 250], ['Whole Milk', 'liquid', 240], ['Unsweetened Almond Milk', 'liquid', 240],
        ['Chicken Bone Broth', 'liquid', 240], ['White Rice', 'solid', 120], ['cooked basmati rice', 'solid', 120],
        ['Orzo', 'solid', 120], ['Quinoa', 'solid', 120], ['Rolled Oats', 'solid', 86.4], ['Steel Cut Oats', 'solid', 86.4],
        ['Oat flakes', 'solid', 86.4], ['Granola', 'solid', 120], ['Granola cereal', 'solid', 120],
        ['Raisin Bran Cereal', 'solid', 120], ['Cream of wheat', 'solid', 120], ['Rice Flakes', 'solid', 120],
        ['All-Purpose Flour', 'solid', 127.2], ['Granulated sugar', 'solid', 204], ['Cocoa Powder', 'solid', 132],
        ['Greek yogurt', 'paste', 250], ['Honey', 'paste', 250], ['Broccoli', 'solid', 120], ['Mixed Berries', 'solid', 120],
        ['Hot cheetos', 'solid', 120], ['Croutons', 'solid', 120], ['Cilantro', 'solid', 120], ['Parsley', 'solid', 120],
        ['Sauteed spinach', 'solid', 120], ['Creamed Spinach', 'solid', 120], ['Chopped Spinach', 'solid', 120],
        ['Spinach artichoke dip', 'solid', 120], ['Spinach Tortilla Wrap', 'solid', 120], ['Kale Salad', 'solid', 120],
        ['Spinach salad', 'solid', 120], ['Kale chips', 'solid', 120], ['Spinach soup', 'beverage', 240],
        ['Kale smoothie', 'beverage', 240], ['Yellow popcorn', 'solid', 120], ['Popcorn kernels', 'solid', 120],
        ['Caramel popcorn', 'solid', 120], ['Popcorn chicken', 'solid', 120], ['Popcorn oil', 'liquid', 240],
        ['Cereal milk', 'liquid', 240], ['Cereal Milk Whey Protein', 'liquid', 240], ['Rice Krispies Treats', 'solid', 120],
        ['Cheerios Protein Bar', 'solid', 120], ['Grape-Nuts', 'solid', 132], ['Muesli', 'solid', 120],
        ['Spinach', 'solid', 120], ['Romaine lettuce', 'solid', 120], ['Watercress', 'liquid', 240], ['Butter lettuce', 'paste', 250],
    ])('%s stays %s at %d g/cup', (name, cls, cup) => {
        const r = resolveVolumeGrams(name);
        expect(r.volumeClass).toBe(cls);
        expect(r.perUnit['cup']).toBeCloseTo(cup as number, 6);
        expect(r.lightClass).toBeNull();
    });
});
