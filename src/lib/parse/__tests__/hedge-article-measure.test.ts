/**
 * S202 (route 37): an approximator before an ARTICLE-led measure keeps the unit.
 * `roughly a pound of strawberries` billed 12 g (one berry); it must parse like `a pound of strawberries`.
 * Expectations are seat-measured at probe level on the prototype.
 */

import { parseIngredientLine } from '../ingredient-line';

type Want = { qty?: number; unit?: string | null; name?: string };

function check(line: string, want: Want) {
  const r = parseIngredientLine(line);
  expect(r).not.toBeNull();
  for (const k of Object.keys(want) as (keyof Want)[]) {
    expect((r as any)[k]).toEqual(want[k]);
  }
}

describe('hedge before an article measure is dropped', () => {
  test.each<[string, Want]>([
    ['roughly a pound of strawberries', { qty: 1, unit: 'lb', name: 'strawberries' }],
    ['about a pound of strawberries', { qty: 1, unit: 'lb', name: 'strawberries' }],
    ['roughly a cup of strawberries', { qty: 1, unit: 'cup', name: 'strawberries' }],
    ['about a gallon of milk', { qty: 1, unit: 'gallon', name: 'milk' }],
    ['about a tablespoon of butter', { qty: 1, unit: 'tbsp', name: 'butter' }],
    ['like a liter of water', { qty: 1, unit: 'l', name: 'water' }],
    ['almost a cup of cooked oatmeal', { qty: 1, unit: 'cup', name: 'oatmeal' }],
  ])('%s', check);
});

describe('hedged parse equals the un-hedged parse', () => {
  test('about a cup of egg whites', () => {
    expect(parseIngredientLine('about a cup of egg whites')).toEqual(parseIngredientLine('a cup of egg whites'));
  });
  test('roughly a pound of strawberries', () => {
    expect(parseIngredientLine('roughly a pound of strawberries')).toEqual(
      parseIngredientLine('a pound of strawberries'),
    );
  });
});

describe('shapes the strip must NOT touch (unit null, whole line is the name)', () => {
  test.each<string>([
    'about a cup or two of rice',
    'like a pound cake',
    'about a cup noodles',
    'like a second helping of rice',
    'like a banana',
    'about time seasoning',
  ])('%s', (line) => {
    const r = parseIngredientLine(line);
    expect(r).not.toBeNull();
    expect(r!.unit).toBeNull();
    expect(r!.name).toBe(line);
  });

  test('about a dozen eggs is unchanged', () => {
    check('about a dozen eggs', { qty: 12, unit: 'egg' });
  });
});
