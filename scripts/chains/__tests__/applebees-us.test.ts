import applebees from '../adapters/applebees-us';

// A small synthetic file in the Nutritionix INM shape (never a copy of the real one).
type N = Record<string, number>;
const calc = (o: N = {}): N => ({
  calculatedCalories: 1089.079, calculatedTotalFat: 61.343, calculatedSaturatedFat: 17.6, calculatedTransFat: 1.404,
  calculatedCholesterol: 84.8, calculatedSodium: 2048.2, calculatedTotalCarb: 92.7, calculatedFiber: 6.6, calculatedSugars: 7.937,
  calculatedAddedSugars: 5, calculatedProtein: 42.6, calculatedServingWeight: 700, ...o,
});
const item = (id: number, name: string, categoryId: number, nutrition: N, over: Record<string, unknown> = {}) =>
  ({ id, name, categoryId, isActive: 1, defaultModifiers: [{ id: 1, quantity: 1 }], nutrition, ...over });
const cats = [{ id: 1, name: 'Handcrafted Burgers' }, { id: 2, name: 'Catering (INM Only)' }, { id: 3, name: 'Menu Items (INM Only)' }];
const file = (items: unknown[], categories: unknown[] = cats, generatedAt = '2026-11-23T14:07:27+00:00') =>
  JSON.stringify({ generatedAt, categories, items });

const main = file([
  item(1, 'Classic Burger&reg;', 1, { ...calc(), calories: 5, totalFat: 1 }),
  item(2, 'Ghost Burger', 1, calc(), { isActive: 0 }),
  item(3, 'Fountain Drinks', 1, calc({ calculatedCalories: 0 }), { defaultModifiers: [] }),
  item(4, 'Boneless Wings (Serves 6-8)', 2, calc()),
  item(5, 'Signature Cole Slaw', 1, calc({ calculatedCalories: 131.12, calculatedCholesterol: 3.2, calculatedProtein: 0.7, calculatedSugars: 12.4 })),
  item(6, 'Fat Free Italian', 3, calc({ calculatedCalories: 18.62, calculatedTotalFat: 0.1, calculatedTransFat: 0 })),
]);

describe('applebees-us parse', () => {
  const { items, components } = applebees.parse({ menu: main });
  const byKey = new Map(items.map((i) => [i.key, i]));

  it('reads the calculated fields through fdaRound, never the base fields, and has no components', () => {
    expect(byKey.get('applebees-classic-burger')?.panel).toMatchObject({
      kcal: 1090, fatG: 61, satFatG: 18, transFatG: 1.5, cholesterolMg: 85, sodiumMg: 2050, carbsG: 93, fiberG: 7, sugarG: 8, proteinG: 43,
    });
    expect(components).toEqual([]);
  });
  it('keeps active items with default modifiers outside Catering, and drops the rest', () => {
    expect([...byKey.keys()].sort()).toEqual(['applebees-classic-burger', 'applebees-fat-free-italian', 'applebees-signature-cole-slaw']);
  });
  it('a "less than" band is null, and a small value rounds down to 0 or to the nearest 5', () => {
    const slaw = byKey.get('applebees-signature-cole-slaw')!;
    expect(slaw.panel.cholesterolMg).toBeNull();
    expect(slaw.panel.proteinG).toBeNull();
    expect(slaw.panel.kcal).toBe(130);
    expect(byKey.get('applebees-fat-free-italian')?.panel).toMatchObject({ kcal: 20, fatG: 0, transFatG: 0 });
  });
  it('addedSugarG and servingG are null on every row even when the file carries them', () => {
    for (const i of items) {
      expect(i.panel.addedSugarG).toBeNull();
      expect(i.servingG).toBeNull();
    }
  });
  it('cleans entities and marks from names and keys', () => {
    expect(byKey.get('applebees-classic-burger')?.name).toBe('Classic Burger');
  });
  it('throws when no category is named Catering, on a duplicate key and on a non-JSON body', () => {
    expect(() => applebees.parse({ menu: file([item(1, 'A', 1, calc())], [{ id: 1, name: 'Burgers' }]) })).toThrow(/no category named/);
    expect(() => applebees.parse({ menu: file([item(1, 'Fries&reg;', 1, calc()), item(2, 'Fries', 1, calc())]) })).toThrow(/appears twice/);
    expect(() => applebees.parse({ menu: '<html>' })).toThrow(/not JSON/);
  });
  it('takes generatedAt from the file, date part, and throws when it is missing', () => {
    expect(applebees.generatedAt?.('menu', main)).toBe('2026-11-23');
    expect(() => applebees.generatedAt?.('menu', JSON.stringify({ items: [], categories: [] }))).toThrow(/not a date/);
  });
});
