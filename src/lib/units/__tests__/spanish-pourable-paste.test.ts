import { resolveVolumeGrams } from '../volume-density';

/**
 * Spanish-NAMED liquids pour at 1 g/ml and Spanish-named pastes bill the paste
 * cell (2026-11-01). ES_POUR_RE / ES_PASTE_RE in volume-density.ts are
 * HEAD-ANCHORED slices checked last, so only solid -> beverage|paste can move.
 *
 * Blocks: the defect (red on base), the collisions (BASE class and cup pinned),
 * and the control (other classes byte-identical).
 */

describe('spanish pourable — the defect', () => {
    it.each([
        'Leche', 'Leche Semi Descremada', 'Leche de almendras', 'Jugo de mango',
        'Agua de coco', 'aceite de oliva', 'Crema', 'Crema Mexicana', 'Licuado',
        '100% Agua De Coco',
    ])('%s is a beverage billed at 15 g/tbsp and 240 g/cup', (name) => {
        const r = resolveVolumeGrams(name);
        expect(r.volumeClass).toBe('beverage');
        expect(r.perUnit.tbsp).toBe(15);
        expect(r.perUnit.cup).toBe(240);
    });
});

describe('spanish paste — the defect', () => {
    it.each([
        'Crema de cacahuate', 'Mantequilla de maní', 'Crema de maní', 'Miel', 'Cajeta',
        'Mermelada de fresa', 'Yogur natural', 'Queso crema', 'Mostaza',
    ])('%s is a paste billed at 16 g/tbsp and 250 g/cup', (name) => {
        const r = resolveVolumeGrams(name);
        expect(r.volumeClass).toBe('paste');
        expect(r.perUnit.tbsp).toBe(16);
        expect(r.perUnit.cup).toBe(250);
    });
});

describe('spanish pourable/paste — collisions are byte-identical to BASE (class and cup pinned)', () => {
    it.each([
        ['Agua de Jamaica', 'paste', 250], ['Mayonesa', 'paste', 250], ['Pastel de nata', 'paste', 250],
        ['Dulce de leche', 'solid', 120], ['Salsa verde', 'solid', 120], ['Atole', 'solid', 120],
        ['Batido de chocolate', 'solid', 120], ['Nata', 'solid', 120],
        ['Chocolate con Leche', 'solid', 120], ['Pan de leche', 'solid', 120],
        ['Leche en polvo', 'solid', 120], ['Leche Nido', 'solid', 120],
        ['Galletas con leche', 'solid', 120], ['Helado de crema', 'solid', 120],
        ['Crema helada', 'solid', 120], ['Cereal con miel', 'solid', 120],
        ['Barre de sésame au miel', 'solid', 120], ['Queso de leche cruda', 'solid', 120],
        ['Atún en aceite', 'solid', 120], ['Crema y Cebolla', 'solid', 120],
        ['Mantequilla Bean', 'solid', 120], ['Lala Leche entera', 'solid', 120],
        ['Arroz', 'solid', 120], ['white rice', 'solid', 120], ['blueberries', 'solid', 120],
    ])('%s stays %s at %d g/cup', (name, cls, cup) => {
        const r = resolveVolumeGrams(name);
        expect(r.volumeClass).toBe(cls);
        expect(r.perUnit.cup).toBe(cup);
    });
});

describe('spanish pourable/paste — control: the other classes are byte-identical', () => {
    it('broth liquid, peanut butter paste, coke and soup beverage, flour and chili powder solid', () => {
        const broth = resolveVolumeGrams('chicken broth');
        expect(broth.volumeClass).toBe('liquid');
        expect(broth.perUnit.cup).toBe(240);
        const paste = resolveVolumeGrams('peanut butter');
        expect(paste.volumeClass).toBe('paste');
        expect(paste.perUnit.cup).toBe(250);
        const coke = resolveVolumeGrams('coke');
        expect(coke.volumeClass).toBe('beverage');
        expect(coke.perUnit.cup).toBe(240);
        const soup = resolveVolumeGrams('Broccoli Cheddar Soup');
        expect(soup.volumeClass).toBe('beverage');
        expect(soup.perUnit.cup).toBe(240);
        const flour = resolveVolumeGrams('all purpose flour');
        expect(flour.volumeClass).toBe('solid');
        expect(flour.perUnit.cup).toBeCloseTo(240 * flour.solidDensity, 6);
        const chili = resolveVolumeGrams('chili powder');
        expect(chili.volumeClass).toBe('solid');
        expect(chili.perUnit.cup).toBe(132);
    });
});
