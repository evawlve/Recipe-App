/**
 * S202 (route 25): gram abbreviations and quantity hedges in parseIngredientLine().
 * `90 gms of chicken` was read as 2,520 g; `2~3 eggs` must average like a dash range.
 * Expectations are seat-measured at probe level.
 */

import { parseIngredientLine } from '../ingredient-line';

type Want = { qty?: number; multiplier?: number; unit?: string | null; name?: string };

function check(line: string, want: Want) {
  const r = parseIngredientLine(line);
  expect(r).not.toBeNull();
  for (const k of Object.keys(want) as (keyof Want)[]) {
    expect((r as any)[k]).toEqual(want[k]);
  }
}

describe('gram aliases resolve to unit g', () => {
  test.each<[string, Want]>([
    ['90 gms of chicken', { qty: 90, unit: 'g', name: 'chicken' }],
    ['100 grms rice', { qty: 100, unit: 'g' }],
    ['100 gr rice', { qty: 100, unit: 'g' }],
    ['100 gm rice', { qty: 100, unit: 'g' }],
    ['350 gr of cooked chicken breast', { qty: 350, unit: 'g' }],
    ['200 gr de pollo', { qty: 200, unit: 'g' }],
    ['100 gramos de arroz', { qty: 100, unit: 'g' }],
    ['100 gr. de arroz', { qty: 100, unit: 'g' }],
    ['1 gr. salt', { qty: 1, unit: 'g' }],
    ['100 gm. rice', { qty: 100, unit: 'g' }],
    ['100 g. rice', { qty: 100, unit: 'g' }],
  ])('%s', check);
});

describe('hedges never change quantity or unit', () => {
  test.each<[string, Want]>([
    ['100 grams-ish of cheddar', { qty: 100, unit: 'g', name: 'cheddar' }],
    ['100g-ish of rice', { qty: 100, unit: 'g', name: 'rice' }],
    ['~100 g of rice', { qty: 100, unit: 'g', name: 'rice' }],
    ['~2 cups', { qty: 2, unit: 'cup' }],
    ['2 tbsp-ish butter', { qty: 2, unit: 'tbsp', name: 'butter' }],
    ['1 tsp ish salt', { qty: 1, unit: 'tsp', name: 'salt' }],
  ])('%s', check);
});

describe('tilde ranges average like a dash range', () => {
  test.each<[string, Want]>([
    ['2~3 eggs', { qty: 2.5 }],
    ['1~2 cups rice', { qty: 1.5, unit: 'cup' }],
    ['100~150 g chicken', { qty: 125, unit: 'g' }],
    ['3~4 eggs', { qty: 3.5 }],
    ['2 ~ 3 eggs', { qty: 2.5 }],
  ])('%s', check);
});

describe('false friends are unchanged', () => {
  test.each<[string, Want]>([
    ['2 green apples', { unit: null, name: 'green apples' }],
    ['2 radish', { name: 'radish' }],
    ['1 tbsp relish', { name: 'relish' }],
    ['2 gs cookies', { unit: null }],
    ['100 grams of cheddar', { qty: 100, unit: 'g' }],
    ['100g rice', { qty: 100, unit: 'g' }],
    ['2 x 100g chicken', { qty: 2, multiplier: 100, unit: 'g' }],
  ])('%s', check);

  test.each(['3 grapes', 'gravy', 'grilled chicken', '2 swedish meatballs', 'a dish of pasta', '3 reddish apples'])(
    '%s keeps its words and gains no gram unit',
    (line) => {
      const r = parseIngredientLine(line);
      expect(r).not.toBeNull();
      expect(r!.unit).not.toBe('g');
      expect(r!.name).toMatch(/grapes|gravy|grilled chicken|swedish meatballs|dish|reddish apples/);
    },
  );
});

describe('named costs, pinned as they are', () => {
  test('5 gr aspirin reads gr as grams', () => check('5 gr aspirin', { unit: 'g' }));
  test('1 GM cereal reads GM as grams', () => check('1 GM cereal', { unit: 'g' }));
});
