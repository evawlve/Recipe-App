import chilis from '../adapters/chilis-us';

// A small synthetic file in the Nutritionix INM shape (never a copy of the real one).
type N = Record<string, number>;
const base = (o: N = {}): N => ({ calories: 500, totalFat: 20, saturatedFat: 5, transFat: 0, cholesterol: 0, sodium: 800, totalCarb: 50, fiber: 3, sugars: 6, addedSugars: 0, protein: 20, servingWeight: 0, ...o });
const item = (id: number, name: string, nutrition: N, isActive = 1) => ({ id, name, isActive, nutrition });
const file = (items: unknown[], tags: unknown[] = [], generatedAt = '2026-11-06T14:29:30+00:00') => JSON.stringify({ generatedAt, items, tags });

const main = file(
  [
    item(1, 'Big Mouth&reg; Bites', { ...base(), calculatedCalories: 999, calculatedTotalFat: 99 }),
    item(2, 'Ghost Dish', base(), 0),
    item(3, 'Light Beer', base({ calories: 110, totalFat: 0, totalCarb: 6, protein: 1, sodium: 10 })),
    item(4, 'Frozen Marg', base({ calories: 300, totalFat: 0, totalCarb: 40, protein: 0, sodium: 5 })),
    item(5, 'Sub Black Bean Patty', base({ calories: 180, totalFat: 9, totalCarb: 4, protein: 4 })),
    item(6, 'Marg Blackberry', base()),
    item(7, 'Marg Dragon Fruit', base()),
    item(8, 'Fried Mozzarella', base({ calories: 600, totalFat: 30, totalCarb: 50, protein: 20, sodium: 100 })),
    item(9, 'TD&trade; Fried Mozzarella', base({ calories: 600, totalFat: 30, totalCarb: 50, protein: 20, sodium: 100 })),
  ],
  [
    { name: 'Entrees', items: [1, 5, 6, 7, 8, 9], children: [] },
    { name: 'Alcohol', items: [3], children: [{ name: 'Margaritas', items: [4], children: [] }] },
  ],
);

describe('chilis-us parse', () => {
  const { items, components } = chilis.parse({ menu: main });
  const byKey = new Map(items.map((i) => [i.key, i]));

  it('reads base fields only, never calculated*, and has no components', () => {
    expect(byKey.get('chilis-big-mouth-bites')?.panel).toMatchObject({ kcal: 500, fatG: 20 });
    expect(components).toEqual([]);
  });
  it('drops inactive items', () => {
    expect(byKey.has('chilis-ghost-dish')).toBe(false);
  });
  it('Rule Z: a field 0 on every active item is null; any other 0 is published', () => {
    const p = byKey.get('chilis-big-mouth-bites')!;
    expect(p.panel.addedSugarG).toBeNull();
    expect(p.servingG).toBeNull();
    const withOne = chilis.parse({ menu: file([item(1, 'A', base({ addedSugars: 2, servingWeight: 100 })), item(2, 'B', base())]) });
    const b = withOne.items.find((i) => i.key === 'chilis-b')!;
    expect(b.panel.addedSugarG).toBe(0);
    expect(b.servingG).toBe(0);
    expect(withOne.items.find((i) => i.key === 'chilis-a')?.servingG).toBe(100);
    // cholesterol is 0 on every row of the first file: null
    expect(byKey.get('chilis-big-mouth-bites')?.panel.cholesterolMg).toBeNull();
    expect(byKey.get('chilis-big-mouth-bites')?.panel.sodiumMg).toBe(800);
  });
  it('decodes entities and strips marks from names and keys', () => {
    expect(byKey.get('chilis-big-mouth-bites')?.name).toBe('Big Mouth Bites');
    expect(byKey.has('chilis-td-fried-mozzarella')).toBe(true);
  });
  it('exempts the Alcohol tag and its child tags only', () => {
    expect(byKey.get('chilis-light-beer')?.atwaterExempt).toBe('alcohol');
    expect(byKey.get('chilis-frozen-marg')?.atwaterExempt).toBe('alcohol');
    expect(byKey.get('chilis-big-mouth-bites')?.atwaterExempt).toBeUndefined();
  });
  it('leaves the SOURCE_ERRORS row out', () => {
    expect(byKey.has('chilis-sub-black-bean-patty')).toBe(false);
  });
  it('keeps identical panels under different names', () => {
    expect(byKey.has('chilis-marg-blackberry') && byKey.has('chilis-marg-dragon-fruit')).toBe(true);
    expect(byKey.has('chilis-fried-mozzarella') && byKey.has('chilis-td-fried-mozzarella')).toBe(true);
  });
  it('throws on a duplicate key and on a non-JSON body', () => {
    expect(() => chilis.parse({ menu: file([item(1, 'Fries&reg;', base()), item(2, 'Fries', base())]) })).toThrow(/appears twice/);
    expect(() => chilis.parse({ menu: '<html>' })).toThrow(/not JSON/);
  });
  it('takes generatedAt from the file, date part, and throws when it is missing', () => {
    expect(chilis.generatedAt?.('menu', main)).toBe('2026-11-06');
    expect(() => chilis.generatedAt?.('menu', JSON.stringify({ items: [] }))).toThrow(/not a date/);
  });
});
