import { resolveVolumeGrams, volumeToGrams } from '../volume-density';

/**
 * The cases that matter are the ones the three hand-copies DISAGREED on. Each
 * block below names the copy that was right and the number the wrong copies
 * produced, so a future re-tune has to argue with a measurement.
 */

describe('resolveVolumeGrams — the paste tier the other two copies never got', () => {
    it('peanut butter: 16 g/tbsp, not the dry-goods 7.5 g', () => {
        const r = resolveVolumeGrams('Peanut Butter');
        expect(r.volumeClass).toBe('paste');
        expect(r.perUnit['tbsp']).toBe(16);
        // What buildFatSecretResult and the FDC path billed before this module:
        expect(15 * 0.5).toBe(7.5);
    });

    it('2 tbsp peanut butter is ~32 g — the number the OFF comment cites', () => {
        expect(volumeToGrams(2, 'tbsp', 'Peanut Butter')!.grams).toBe(32);
    });

    it('greek yogurt: 250 g/cup, not 120 g', () => {
        const r = volumeToGrams(1, 'cup', 'Greek Yogurt')!;
        expect(r.grams).toBe(250);
        expect(r.volumeClass).toBe('paste');
    });

    it.each([
        'Almond Butter', 'Hummus', 'Honey', 'Mayonnaise', 'Strawberry Jam',
        'Nutella', 'Tahini', 'Cream Cheese', 'Sour Cream', 'Ricotta',
        'Tomato Paste', 'Ranch Dressing', 'Ketchup', 'Dijon Mustard',
    ])('%s classifies as paste', (name) => {
        expect(resolveVolumeGrams(name).volumeClass).toBe('paste');
    });
});

describe('resolveVolumeGrams — liquids outrank pastes', () => {
    it('a sauce containing "butter" is a LIQUID, not a paste', () => {
        // isPaste is `!isLiquid && ...` in the original. Order matters: "butter
        // sauce" matches both regexes, and the liquid answer (15 g/tbsp) is the
        // right one. Mutation: drop the !isLiquid guard -> this goes to 16.
        const r = resolveVolumeGrams('Butter Sauce');
        expect(r.volumeClass).toBe('liquid');
        expect(r.perUnit['tbsp']).toBe(15);
    });

    it.each(['Chicken Broth', 'Beef Stock', 'Water', 'Orange Juice', 'Whole Milk', 'Olive Oil', 'Maple Syrup', 'White Vinegar'])(
        '%s classifies as liquid at 240 g/cup', (name) => {
            const r = resolveVolumeGrams(name);
            expect(r.volumeClass).toBe('liquid');
            expect(r.perUnit['cup']).toBe(240);
        });
});

describe('resolveVolumeGrams — the dry-granular category override', () => {
    it('sugar uses its category density, not the flat 0.5 (n-serv-14)', () => {
        const r = resolveVolumeGrams('Granulated Sugar');
        expect(r.volumeClass).toBe('solid');
        expect(r.solidDensity).toBeGreaterThan(0.5);
        // The regression the override exists to stop: 5 * 0.5 = 2.5 g/tsp.
        expect(r.perUnit['tsp']).toBeGreaterThan(2.5);
    });

    it('uncategorized solids keep the 0.5 default', () => {
        const r = resolveVolumeGrams('Salt');
        expect(r.volumeClass).toBe('solid');
        expect(r.solidDensity).toBe(0.5);
        expect(r.perUnit['tbsp']).toBe(7.5);
    });

    it('rice is NOT overridden — the restriction is load-bearing (n-serv-01/03/04)', () => {
        // rice/grain/dairy are deliberately excluded from the override because
        // overriding them overshoots COOKED servings. Mutation: widen the
        // override to every inferred category -> this goes red.
        const r = resolveVolumeGrams('White Rice');
        expect(r.solidDensity).toBe(0.5);
    });
});

describe('resolveVolumeGrams — name selection', () => {
    it('takes the first non-empty name, so callers can pass candidate then query', () => {
        expect(resolveVolumeGrams('Peanut Butter', 'sugar').volumeClass).toBe('paste');
        expect(resolveVolumeGrams(null, undefined, '   ', 'Peanut Butter').volumeClass).toBe('paste');
    });

    it('an empty name is a plain solid, never a crash', () => {
        const r = resolveVolumeGrams(null, undefined, '');
        expect(r.volumeClass).toBe('solid');
        expect(r.solidDensity).toBe(0.5);
    });
});

describe('volumeToGrams', () => {
    it('returns null for a non-volume unit so callers can fall through', () => {
        expect(volumeToGrams(1, 'g', 'Peanut Butter')).toBeNull();
        expect(volumeToGrams(1, 'slice', 'Bread')).toBeNull();
        expect(volumeToGrams(1, null, 'Peanut Butter')).toBeNull();
    });

    it('is case-insensitive on the unit', () => {
        expect(volumeToGrams(1, 'TBSP', 'Peanut Butter')!.grams).toBe(16);
    });

    it('micro-volume units are absolute, not density-scaled', () => {
        // A pinch of sugar and a pinch of salt weigh the same here on purpose.
        expect(volumeToGrams(1, 'pinch', 'Granulated Sugar')!.grams).toBe(0.3);
        expect(volumeToGrams(1, 'pinch', 'Salt')!.grams).toBe(0.3);
        expect(volumeToGrams(1, 'dash', 'Salt')!.grams).toBe(0.6);
    });

    it('scales linearly with quantity', () => {
        expect(volumeToGrams(0.5, 'cup', 'Peanut Butter')!.grams).toBe(125);
        expect(volumeToGrams(3, 'tsp', 'Salt')!.grams).toBe(7.5);
    });
});
