import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ChainSnapshot } from '../../../src/lib/chains/snapshot';
import applebees from '../adapters/applebees-us';
import { fdaRound } from '../lib/fda-round';

// A small synthetic file in the Nutritionix INM shape (never a copy of the real one).
type N = Record<string, number>;
const calc = (o: N = {}): N => ({
  calculatedCalories: 1089.079, calculatedTotalFat: 61.343, calculatedSaturatedFat: 17.6, calculatedTransFat: 1.404,
  calculatedCholesterol: 84.8, calculatedSodium: 2048.2, calculatedTotalCarb: 92.7, calculatedFiber: 6.6, calculatedSugars: 7.937,
  calculatedAddedSugars: 5, calculatedProtein: 42.6, calculatedServingWeight: 700, ...o,
});
const link = (id: number, servingWeightGrams = 100, servingSize = 1, quantity = 1) => ({ id, quantity, servingSize, servingWeightGrams });
const item = (id: number, name: string, categoryId: number, nutrition: N, over: Record<string, unknown> = {}) =>
  ({ id, name, categoryId, isActive: 1, defaultModifiers: [link(1)], nutrition, ...over });
const mod = (id: number, name: string, n: N = {}) => ({
  id, name, isActive: 1,
  nutrition: { calories: 290, totalFat: 4.4, saturatedFat: 1, transFat: 0, cholesterol: 10, sodium: 455, totalCarb: 52, fiber: 2,
    sugars: 6, addedSugars: 5, protein: 9, servingWeight: 80, ...n },
});
const MODS = [mod(1, 'Toasted Brioche Bun&reg;'), mod(2, 'Pickle Fries', { calories: 288.57, servingWeight: 0 }), mod(3, 'Lettuce', { calories: 2.1, servingWeight: 20 })];
const cats = [{ id: 1, name: 'Handcrafted Burgers' }, { id: 2, name: 'Catering (INM Only)' }, { id: 3, name: 'Menu Items (INM Only)' }];
const file = (items: unknown[], categories: unknown[] = cats, generatedAt = '2026-11-23T14:07:27+00:00', modifiers: unknown[] = MODS) =>
  JSON.stringify({ generatedAt, categories, items, modifiers });

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

  it('reads the calculated fields through fdaRound, never the base fields', () => {
    expect(byKey.get('applebees-classic-burger')?.panel).toMatchObject({
      kcal: 1090, fatG: 61, satFatG: 18, transFatG: 1.5, cholesterolMg: 85, sodiumMg: 2050, carbsG: 93, fiberG: 7, sugarG: 8, proteinG: 43,
    });
    expect(components.map((c) => c.key)).toEqual(['applebees-toasted-brioche-bun']);
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

describe('applebees-us default modifiers (CHAIN-5b)', () => {
  const burger = item(1, 'Classic Burger', 1, calc(), { defaultModifiers: [link(3, 30), link(1, 88)] });
  const pickles = item(2, 'Crispy Pickle Fries', 1, calc(), { defaultModifiers: [link(2, 0, 2)] });
  const sampler = item(3, 'Crispy Pickle Fries - Sampler', 1, calc(), { defaultModifiers: [link(2, 0, 1)] });
  const { items, components } = applebees.parse({ menu: file([burger, pickles, sampler]) });
  const byKey = new Map(items.map((i) => [i.key, i]));

  it('makes each default a part in file order: grams, contribution = modifier x grams / servingWeight, FDA-rounded kcalPublished', () => {
    const [lettuce, bun] = byKey.get('applebees-classic-burger')!.parts;
    expect(lettuce).toMatchObject({ componentKey: 'applebees-lettuce', grams: 30, kcalPublished: 0, isDefault: true, portionLabel: null, quantity: null, without: null });
    expect(lettuce.contribution?.kcal).toBe(3.15);
    expect(bun).toMatchObject({ componentKey: 'applebees-toasted-brioche-bun', grams: 88, kcalPublished: 320 });
    expect(bun.contribution).toMatchObject({ kcal: 319, fatG: 4.84, sodiumMg: 500.5, proteinG: 9.9, addedSugarG: null });
  });
  it('falls back to servingSize when the modifier has no servingWeight, and then grams is null', () => {
    const [p2] = byKey.get('applebees-crispy-pickle-fries')!.parts;
    const [p1] = byKey.get('applebees-crispy-pickle-fries-sampler')!.parts;
    expect(p2).toMatchObject({ grams: null, kcalPublished: 580 });
    expect(p2.contribution?.kcal).toBe(577.14);
    expect(p1.contribution?.kcal).toBe(288.57);
  });
  it('one component per modifier, shared by every item that uses it, with no portions', () => {
    expect(components.map((c) => c.key).sort()).toEqual(['applebees-lettuce', 'applebees-pickle-fries', 'applebees-toasted-brioche-bun']);
    expect(components.find((c) => c.key === 'applebees-toasted-brioche-bun')).toEqual({
      key: 'applebees-toasted-brioche-bun', name: 'Toasted Brioche Bun', removalKeys: ['toasted brioche bun'], portions: [],
    });
  });
  it('throws on a missing modifier, a quantity other than 1, a modifier twice, two modifiers with one key, and a non-number field', () => {
    const one = (links: unknown[], mods: unknown[] = MODS) => () => applebees.parse({ menu: file([item(1, 'A', 1, calc(), { defaultModifiers: links })], cats, undefined, mods) });
    expect(one([link(9)])).toThrow(/not in modifiers/);
    expect(one([link(1, 100, 1, 2)])).toThrow(/quantity 2, not 1/);
    expect(one([link(1), link(1)])).toThrow(/twice/);
    expect(one([link(1), link(4)], [...MODS, mod(4, 'Toasted Brioche Bun')])).toThrow(/component applebees-toasted-brioche-bun appears twice/);
    expect(one([link(5)], [mod(5, 'X', { protein: null as unknown as number })])).toThrow(/protein is not a number/);
    expect(one([link(2, 0, 0)])).toThrow(/no serving factor/);
  });
});

describe('applebees-us committed menu closes exactly', () => {
  const snap = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', 'chains', 'menus', 'applebees-us.json'), 'utf8')) as ChainSnapshot;
  const RULES = { kcal: 'kcal', fatG: 'fat', satFatG: 'fat', transFatG: 'fat', cholesterolMg: 'chol', sodiumMg: 'sodium',
    carbsG: 'gram', fiberG: 'gram', sugarG: 'gram', proteinG: 'gram' } as const;

  it('every item panel is fdaRound of its default parts summed, on all 10 label fields, and every kcalPublished is fdaRound of its kcal', () => {
    const bad: string[] = [];
    for (const it of snap.items) {
      if (it.parts.length === 0) bad.push(`${it.key}: no parts`);
      for (const [f, rule] of Object.entries(RULES) as Array<[keyof typeof RULES, (typeof RULES)[keyof typeof RULES]]>) {
        const sum = it.parts.filter((p) => p.isDefault).reduce((a, p) => a + (p.contribution?.[f] ?? NaN), 0);
        if (fdaRound(rule, Math.max(0, sum)) !== it.panel[f]) bad.push(`${it.key} ${f}`);
      }
      for (const p of it.parts) if (p.kcalPublished !== fdaRound('kcal', Math.max(0, p.contribution?.kcal ?? NaN))) bad.push(`${it.key} ${p.componentKey} kcalPublished`);
    }
    expect(bad).toEqual([]);
  });
});
