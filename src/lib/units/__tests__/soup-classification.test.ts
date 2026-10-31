import { resolveVolumeGrams } from '../volume-density';

/**
 * Soup joins the pourable (`beverage`) class (2026-10-31). A cup of soup billed
 * the dry-solid 120 g where a declared label reads 240-250. SOUP_RE in
 * volume-density.ts is the fourth, last-checked slice.
 *
 * Blocks: the defect (red before the change), the collisions (names that carry
 * a soup-ish token or look like one but must keep their BASE grams), and the
 * control (other classes byte-identical).
 */

describe('soup — the defect', () => {
    it.each([
        'Broccoli Cheddar Soup', 'Soup', 'Caldo con sabor a res', 'French onion soup',
        'Navy Bean Soup', 'clam chowder', 'lobster bisque', 'beef stew',
        'Chicken Noodle Soup', "Campbell's chicken noodle soup", 'beef pho',
    ])('%s is a beverage billed at 15 g/tbsp and 240 g/cup', (name) => {
        const r = resolveVolumeGrams(name);
        expect(r.volumeClass).toBe('beverage');
        expect(r.perUnit.tbsp).toBe(15);
        expect(r.perUnit.cup).toBe(240);
    });
});

describe('soup — collisions keep their base grams (class and cup pinned to base)', () => {
    it.each([
        ['Stewed Prunes', 120], ['stewed tomatoes', 120], ['onion soup mix', 120],
        ['chili powder', 132], ['instant ramen', 120], ['Cup Noodles', 120],
        ['white rice', 120], ['blueberries', 120], ['chicken soup base', 120],
        ['Beef Stew Meat', 120], ['Chili Dog', 120], ['Fritos Chili Cheese', 120],
        ['doritos spicy sweet chili', 120], ['turkey chili', 120], ['Soup Dumplings', 120],
        ['Tortilla Soup Mix', 120],
    ])('%s stays a solid at %d g/cup', (name, cup) => {
        const r = resolveVolumeGrams(name);
        expect(r.volumeClass).toBe('solid');
        expect(r.perUnit.cup).toBe(cup);
    });
});

describe('soup — control: the other classes are byte-identical', () => {
    it('chicken broth stays liquid, a paste stays paste, coke a beverage, flour a solid', () => {
        const broth = resolveVolumeGrams('chicken broth');
        expect(broth.volumeClass).toBe('liquid');
        expect(broth.perUnit.cup).toBe(240);
        const paste = resolveVolumeGrams('peanut butter');
        expect(paste.volumeClass).toBe('paste');
        expect(paste.perUnit.cup).toBe(250);
        const coke = resolveVolumeGrams('coke');
        expect(coke.volumeClass).toBe('beverage');
        expect(coke.perUnit.cup).toBe(240);
        const flour = resolveVolumeGrams('all purpose flour');
        expect(flour.volumeClass).toBe('solid');
        expect(flour.perUnit.cup).toBeCloseTo(240 * flour.solidDensity, 6);
    });
});
