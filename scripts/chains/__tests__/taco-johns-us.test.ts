import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChainSnapshot } from '../../../src/lib/chains/snapshot';
import tacoJohns from '../adapters/taco-johns-us';
import { fdaRound } from '../lib/fda-round';

// A small synthetic file in the Nutritionix INM shape (never a copy of the real one).
type N = Record<string, number>;
const calc = (o: N = {}): N => ({
  calculatedCalories: 513.968, calculatedTotalFat: 24.7, calculatedSaturatedFat: 6.8, calculatedTransFat: 0.3,
  calculatedCholesterol: 26.1, calculatedSodium: 1137.2, calculatedTotalCarb: 56.3, calculatedFiber: 4.2, calculatedSugars: 2.4,
  calculatedAddedSugars: 1.1, calculatedProtein: 15.2, calculatedServingWeight: 235.2, ...o,
});
const link = (id: number, servingWeightGrams = 100, servingSize = 1, quantity = 1) => ({ id, quantity, servingSize, servingWeightGrams });
const item = (id: number, name: string, categoryId: number, nutrition: N, over: Record<string, unknown> = {}) =>
  ({ id, name, categoryId, isActive: 1, defaultModifiers: [link(1)], nutrition, ...over });
const mod = (id: number, name: string, n: N = {}) => ({
  id, name, isActive: 1,
  nutrition: { calories: 333.33, totalFat: 21.1, saturatedFat: 3.2, transFat: 0.1, cholesterol: 0, sodium: 1063, totalCarb: 33.5, fiber: 3.1,
    sugars: 0.4, addedSugars: 0, protein: 2.6, servingWeight: 100, ...n },
});
const MODS = [mod(1, 'Seasoned Potato Ol&eacute;s&reg;'), mod(2, 'Iceberg Lettuce', { calories: 14, servingWeight: 100 }), mod(3, 'Steak', { calories: 150, servingWeight: 85 })];
const cats = [{ id: 1, name: 'Burritos', previewOnly: 0 }, { id: 2, name: 'Preview Only - Burritos', previewOnly: 1 }, { id: 3, name: 'Drinks', previewOnly: 0 }];
const file = (items: unknown[], categories: unknown[] = cats, generatedAt = '2026-11-09T14:23:28+00:00', modifiers: unknown[] = MODS) =>
  JSON.stringify({ generatedAt, categories, items, modifiers });

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

  it('reads the calculated fields through fdaRound, never the base fields', () => {
    expect(byKey.get('taco-johns-meat-and-potato-burrito')?.panel).toMatchObject({
      kcal: 510, fatG: 25, satFatG: 7, transFatG: 0, cholesterolMg: 25, sodiumMg: 1140, carbsG: 56, fiberG: 4, sugarG: 2, proteinG: 15,
    });
    expect(components.map((c) => c.key)).toEqual(['taco-johns-seasoned-potato-oles']);
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

describe('taco-johns-us default modifiers (CHAIN-6b)', () => {
  const burrito = item(1, 'Meat &amp; Potato Burrito', 1, calc(), { defaultModifiers: [link(2, 21.2645), link(1, 38.985)] });
  const steak = item(4, 'Meat &amp; Potato Burrito, Steak', 2, calc(), { defaultModifiers: [link(3, 42.5)] });
  const { items, components } = tacoJohns.parse({ menu: file([burrito, steak]) });

  it('makes each default a part in file order through the shared helper, and a preview-only item makes no component', () => {
    const [lettuce, oles] = items[0].parts;
    expect(lettuce).toMatchObject({ componentKey: 'taco-johns-iceberg-lettuce', grams: 21.2645, kcalPublished: 0, isDefault: true, portionLabel: null, quantity: null, without: null });
    expect(lettuce.contribution?.kcal).toBe(2.977);
    expect(oles).toMatchObject({ componentKey: 'taco-johns-seasoned-potato-oles', grams: 38.985, kcalPublished: 130 });
    expect(oles.contribution).toMatchObject({ kcal: 129.9487, fatG: 8.2258, sodiumMg: 414.4106, proteinG: 1.0136, addedSugarG: null });
    expect(components).toEqual([
      { key: 'taco-johns-iceberg-lettuce', name: 'Iceberg Lettuce', removalKeys: ['iceberg lettuce'], portions: [] },
      { key: 'taco-johns-seasoned-potato-oles', name: 'Seasoned Potato Olés', removalKeys: ['seasoned potato olés'], portions: [] },
    ]);
  });
  it('throws in the taco-johns-us name on a missing modifier, a modifier twice and no serving factor', () => {
    const one = (links: unknown[]) => () => tacoJohns.parse({ menu: file([item(1, 'A', 1, calc(), { defaultModifiers: links })]) });
    expect(one([link(9)])).toThrow(/^taco-johns-us: A default modifier 9 is not in modifiers$/);
    expect(one([link(1), link(1)])).toThrow(/^taco-johns-us: A lists default modifier 1 twice$/);
    expect(one([link(2, 0, 0)])).toThrow(/^taco-johns-us: A default Iceberg Lettuce has no serving factor$/);
  });
});

describe('taco-johns-us committed menu closes exactly but for one named cell', () => {
  const snap = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'chains', 'menus', 'taco-johns-us.json'), 'utf8')) as ChainSnapshot;
  const RULES = { kcal: 'kcal', fatG: 'fat', satFatG: 'fat', transFatG: 'fat', cholesterolMg: 'chol', sodiumMg: 'sodium',
    carbsG: 'gram', fiberG: 'gram', sugarG: 'gram', proteinG: 'gram' } as const;

  it('every item panel is fdaRound of its default parts summed and every kcalPublished is fdaRound of its kcal, except Tropicana Orange Juice kcal', () => {
    const bad: string[] = [];
    for (const it of snap.items) {
      if (it.parts.length === 0) bad.push(`${it.key}: no parts`);
      for (const [f, rule] of Object.entries(RULES) as Array<[keyof typeof RULES, (typeof RULES)[keyof typeof RULES]]>) {
        const sum = it.parts.filter((p) => p.isDefault).reduce((a, p) => a + (p.contribution?.[f] ?? NaN), 0);
        if (fdaRound(rule, Math.max(0, sum)) !== it.panel[f]) bad.push(`${it.key} ${f}`);
      }
      for (const p of it.parts) if (p.kcalPublished !== fdaRound('kcal', Math.max(0, p.contribution?.kcal ?? NaN))) bad.push(`${it.key} ${p.componentKey} kcalPublished`);
    }
    // The file's kcal is 165.0001 (label 170); its one part is 165.0000 at 4 dp, an FDA tie that rounds to 160.
    expect(bad).toEqual(['taco-johns-tropicana-orange-juice kcal', 'taco-johns-tropicana-orange-juice taco-johns-tropicana-orange-juice kcalPublished']);
  });
});
