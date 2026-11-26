import tacoJohns from '../adapters/taco-johns-us';

// A small synthetic file in the Nutritionix INM shape (never a copy of the real one).
type N = Record<string, number>;
const calc = (o: N = {}): N => ({
  calculatedCalories: 513.968, calculatedTotalFat: 24.7, calculatedSaturatedFat: 6.8, calculatedTransFat: 0.3,
  calculatedCholesterol: 26.1, calculatedSodium: 1137.2, calculatedTotalCarb: 56.3, calculatedFiber: 4.2, calculatedSugars: 2.4,
  calculatedAddedSugars: 1.1, calculatedProtein: 15.2, calculatedServingWeight: 235.2, ...o,
});
const item = (id: number, name: string, categoryId: number, nutrition: N, over: Record<string, unknown> = {}) =>
  ({ id, name, categoryId, isActive: 1, defaultModifiers: [{ id: 1, quantity: 1 }], nutrition, ...over });
const cats = [{ id: 1, name: 'Burritos', previewOnly: 0 }, { id: 2, name: 'Preview Only - Burritos', previewOnly: 1 }, { id: 3, name: 'Drinks', previewOnly: 0 }];
const file = (items: unknown[], categories: unknown[] = cats, generatedAt = '2026-11-09T14:23:28+00:00') =>
  JSON.stringify({ generatedAt, categories, items });

const main = file([
  item(1, 'Meat &amp; Potato Burrito', 1, { ...calc(), calories: 5, totalFat: 1 }),
  item(2, 'Ghost Burrito', 1, calc(), { isActive: 0 }),
  item(3, 'Empty Build', 1, calc(), { defaultModifiers: [] }),
  item(4, 'Meat &amp; Potato Burrito, Steak', 2, calc()),
  item(5, 'Potato Ol&eacute;s&reg;, Medium', 1, calc({ calculatedCalories: 650.518, calculatedSugars: 0.7, calculatedCholesterol: 3.2 })),
  item(6, 'Diet Pepsi&reg;, Small', 3, calc({ calculatedCalories: 0, calculatedTotalFat: 0, calculatedSaturatedFat: 0, calculatedTransFat: 0,
    calculatedCholesterol: 0, calculatedSodium: 47.1, calculatedTotalCarb: 0.2, calculatedFiber: 0, calculatedSugars: 0, calculatedProtein: 0 })),
]);

describe('taco-johns-us parse', () => {
  const { items, components } = tacoJohns.parse({ menu: main });
  const byKey = new Map(items.map((i) => [i.key, i]));

  it('reads the calculated fields through fdaRound, never the base fields, and has no components', () => {
    expect(byKey.get('taco-johns-meat-and-potato-burrito')?.panel).toMatchObject({
      kcal: 510, fatG: 25, satFatG: 7, transFatG: 0, cholesterolMg: 25, sodiumMg: 1140, carbsG: 56, fiberG: 4, sugarG: 2, proteinG: 15,
    });
    expect(components).toEqual([]);
  });
  it('keeps active items with default modifiers outside previewOnly categories, drinks included, and drops the rest', () => {
    expect([...byKey.keys()].sort()).toEqual(['taco-johns-diet-pepsi-small', 'taco-johns-meat-and-potato-burrito', 'taco-johns-potato-oles-medium']);
  });
  it('a "less than" band is null, and a 0 kcal drink stays a 0 kcal row', () => {
    const oles = byKey.get('taco-johns-potato-oles-medium')!;
    expect(oles.panel.sugarG).toBeNull();
    expect(oles.panel.cholesterolMg).toBeNull();
    expect(oles.panel.kcal).toBe(650);
    expect(byKey.get('taco-johns-diet-pepsi-small')?.panel).toMatchObject({ kcal: 0, sodiumMg: 45, carbsG: 0 });
  });
  it('addedSugarG and servingG are null on every row even when the file carries them', () => {
    for (const i of items) {
      expect(i.panel.addedSugarG).toBeNull();
      expect(i.servingG).toBeNull();
    }
  });
  it('cleans entities and marks from names and keys', () => {
    expect(byKey.get('taco-johns-potato-oles-medium')?.name).toBe('Potato Olés, Medium');
    expect(byKey.get('taco-johns-meat-and-potato-burrito')?.name).toBe('Meat & Potato Burrito');
  });
  it('throws on a category without a 0/1 previewOnly, on a duplicate key and on a non-JSON body', () => {
    expect(() => tacoJohns.parse({ menu: file([item(1, 'A', 1, calc())], [{ id: 1, name: 'Burritos' }]) })).toThrow(/previewOnly/);
    expect(() => tacoJohns.parse({ menu: file([item(1, 'Churro&reg;', 1, calc()), item(2, 'Churro', 1, calc())]) })).toThrow(/appears twice/);
    expect(() => tacoJohns.parse({ menu: '<html>' })).toThrow(/not JSON/);
  });
  it('takes generatedAt from the file, date part, and throws when it is missing', () => {
    expect(tacoJohns.generatedAt?.('menu', main)).toBe('2026-11-09');
    expect(() => tacoJohns.generatedAt?.('menu', JSON.stringify({ items: [], categories: [] }))).toThrow(/not a date/);
  });
});
