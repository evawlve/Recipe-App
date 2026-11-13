/**
 * foldTrailingQuantityClauses() - every row of the S192 row-2 design table.
 *
 * Inputs are the segmenter draws in sync-docs row2/pop-base.tsv (r = rawText, n = normalizedForm,
 * b = brand), copied verbatim; lineKey = the line lowercased with trailing punctuation stripped.
 * Rows marked "synthetic" are false-positive pins written for the design, not driver draws.
 */

import { foldTrailingQuantityClauses } from '../trailing-quantity-fold';
import { parseIngredientLine } from '@/lib/parse/ingredient-line';

type In = { rawText: string; normalizedForm?: string; brand?: string };
const it = (r: string, n = '', b = ''): In => ({ rawText: r, normalizedForm: n, brand: b });
const key = (line: string) => line.toLowerCase().replace(/\s+/g, ' ').trim().replace(/[.,;:!?]+$/, '').trim();
const fold = (line: string, items: In[]) => foldTrailingQuantityClauses(key(line), items);
const raws = (items: In[]) => items.map(i => i.rawText);

describe('shape A - a quantity-only segment folds into the item before it', () => {
  const L0 = 'lunch was the leftover tuna salad, maybe a cup';
  test.each([
    ['draw 1 (empty n)', [it('the leftover tuna salad', 'tuna salad'), it('maybe a cup', '')]],
    ['draw 2 (n=cup)', [it('the leftover tuna salad', 'tuna salad'), it('maybe a cup', 'cup')]],
  ])('0 tuna salad %s', (_n, items) => {
    expect(raws(fold(L0, items).items)).toEqual(['1 cup of leftover tuna salad']);
  });

  test('2 chicken tikka masala + half', () => {
    const r = fold('we ordered chicken tikka masala for dinner and i had maybe half', [
      it('chicken tikka masala', 'chicken tikka masala'), it('half', ''),
    ]);
    expect(raws(r.items)).toEqual(['1/2 chicken tikka masala']);
  });

  test('5 homemade chicken noodle soup + about two cups', () => {
    const r = fold('homemade chicken noodle soup, about two cups', [
      it('homemade chicken noodle soup', 'chicken noodle soup'), it('about two cups', ''),
    ]);
    expect(raws(r.items)).toEqual(['2 cups of homemade chicken noodle soup']);
  });

  test('9 some chili + two bowls', () => {
    const r = fold('some chili for dinner, probably two bowls', [it('some chili', 'chili'), it('two bowls', 'bowls')]);
    expect(raws(r.items)).toEqual(['2 bowls of chili']);
  });

  test('10 pad thai + half the container', () => {
    const r = fold('pad thai, maybe half the container', [it('pad thai', 'pad thai'), it('half the container', 'pad thai')]);
    expect(raws(r.items)).toEqual(['1/2 container of pad thai']);
  });

  test('11 leftover lasagna + a big slice', () => {
    const r = fold('leftover lasagna, a big slice', [it('leftover lasagna', 'lasagna'), it('a big slice', 'slice')]);
    expect(raws(r.items)).toEqual(['1 slice of leftover lasagna']);
  });
});

describe('shape B - a restating segment folds into the item it names', () => {
  test('4 scrambled eggs + spinach + mushrooms + two eggs (draw 1)', () => {
    const r = fold('scrambled eggs with spinach and mushrooms, two eggs', [
      it('scrambled eggs', 'scrambled eggs'), it('spinach', 'spinach'), it('mushrooms', 'mushrooms'), it('two eggs', 'eggs'),
    ]);
    expect(raws(r.items)).toEqual(['2 scrambled eggs', 'spinach', 'mushrooms']);
  });

  test('4 scrambled eggs with spinach + mushrooms + two eggs (draw 2)', () => {
    const r = fold('scrambled eggs with spinach and mushrooms, two eggs', [
      it('scrambled eggs with spinach', 'scrambled eggs'), it('mushrooms', 'mushrooms'), it('two eggs', 'eggs'),
    ]);
    expect(raws(r.items)).toEqual(['2 scrambled eggs with spinach', 'mushrooms']);
  });

  test('8 grilled chicken + rice + about a cup of rice', () => {
    const r = fold('grilled chicken and rice, about a cup of rice', [
      it('grilled chicken', 'grilled chicken'), it('rice', 'rice'), it('about a cup of rice', 'rice'),
    ]);
    expect(raws(r.items)).toEqual(['grilled chicken', '1 cup of rice']);
  });

  test('17 coffee + a muffin + two muffins', () => {
    const r = fold('coffee and a muffin, maybe two', [it('coffee', 'coffee'), it('a muffin', 'muffin'), it('two muffins', 'muffin')]);
    expect(raws(r.items)).toEqual(['coffee', '2 muffin']);
  });

  test('6 hot dogs + one hot dog / one (overlaps row 8i; named, not claimed)', () => {
    const line = 'the kids had hot dogs and i had one too';
    expect(raws(fold(line, [it('hot dogs', 'hot dogs'), it('one hot dog', 'hot dog')]).items)).toEqual(['1 hot dogs']);
    expect(raws(fold(line, [it('hot dogs', 'hot dogs'), it('one', 'hot dog')]).items)).toEqual(['1 hot dogs']);
  });
});

describe('shape C - a dropped clause is read out of the text between items (gap fold)', () => {
  test('1 kids nuggets, clause dropped (rawText keeps the possessive, drops "the")', () => {
    const line = "dinner was the kids' leftover chicken nuggets, maybe four";
    expect(raws(fold(line, [it("the kids' leftover chicken nuggets", 'chicken nuggets')]).items))
      .toEqual(["4 kids' leftover chicken nuggets"]);
    expect(raws(fold(line, [it('leftover chicken nuggets', 'chicken nuggets')]).items))
      .toEqual(['4 leftover chicken nuggets']);
  });

  test('3 hard boiled eggs, two of them, and some butter lettuce', () => {
    const r = fold('brunch was hard boiled eggs, two of them, and some butter lettuce', [
      it('hard boiled eggs', 'hard boiled eggs'), it('butter lettuce', 'butter lettuce'),
    ]);
    expect(raws(r.items)).toEqual(['2 hard boiled eggs', 'butter lettuce']);
  });

  test('5 soup, "about two cups" dropped', () => {
    const r = fold('homemade chicken noodle soup, about two cups', [it('homemade chicken noodle soup', 'chicken noodle soup')]);
    expect(raws(r.items)).toEqual(['2 cups of homemade chicken noodle soup']);
  });

  test('7 mac and cheese, like a cup and a half (FRAC2)', () => {
    const r = fold('mac and cheese, like a cup and a half', [it('mac and cheese', 'mac and cheese')]);
    expect(raws(r.items)).toEqual(['1.5 cup of mac and cheese']);
  });

  test('8 draw 2 - rice, "about a cup of rice" dropped', () => {
    const r = fold('grilled chicken and rice, about a cup of rice', [it('grilled chicken', 'grilled chicken'), it('rice', 'rice')]);
    expect(raws(r.items)).toEqual(['grilled chicken', '1 cup of rice']);
  });

  test('9 draw 3 - the meal frame "for dinner" is skipped', () => {
    const r = fold('some chili for dinner, probably two bowls', [it('some chili', 'chili')]);
    expect(raws(r.items)).toEqual(['2 bowls of chili']);
  });

  test('11 draw 1 - lasagna, "a big slice" dropped', () => {
    expect(raws(fold('leftover lasagna, a big slice', [it('leftover lasagna', 'lasagna')]).items))
      .toEqual(['1 slice of leftover lasagna']);
  });

  test('17 draw 3 - "a muffin" shares piece 0 with coffee: unchanged', () => {
    const items = [it('coffee', 'coffee'), it('a muffin', 'muffin')];
    const r = fold('coffee and a muffin, maybe two', items);
    expect(raws(r.items)).toEqual(['coffee', 'a muffin']);
    expect(r.folds).toEqual([]);
  });
});

describe('controls stay separate', () => {
  test.each([
    ['a turkey sandwich, two cookies', [it('a turkey sandwich', 'turkey sandwich'), it('two cookies', 'cookies')]],
    ['greek yogurt, a cup of blueberries', [it('greek yogurt', 'greek yogurt'), it('a cup of blueberries', 'blueberries')]],
    ['oatmeal with a banana, two eggs', [it('oatmeal with a banana', 'oatmeal'), it('a banana', 'banana'), it('two eggs', 'eggs')]],
    ['oatmeal with a banana, two eggs', [it('oatmeal with a banana', 'oatmeal'), it('banana', 'banana'), it('two eggs', 'eggs')]],
    ['pizza, three slices, and a coke', [it('three slices of pizza', 'pizza'), it('a coke', 'coke')]],
    ['pizza, three slices, and a coke', [it('three slices of pizza', 'pizza'), it('a coke', 'coke', 'Coca-Cola')]],
  ])('%s', (line, items) => {
    const r = fold(line, items);
    expect(raws(r.items)).toEqual(raws(items));
    expect(r.folds).toEqual([]);
  });
});

describe('false-positive pins (synthetic)', () => {
  test.each([
    ['coffee with half and half', [it('coffee', 'coffee'), it('half and half', 'half and half')]],
    ['a bowl, soy sauce', [it('a bowl', 'bowl'), it('soy sauce', 'soy sauce')]],
    ['an 8 oz steak, 6 oz', [it('an 8 oz steak', 'steak'), it('6 oz', 'oz')]],
    ['two tacos, three tacos', [it('two tacos', 'tacos'), it('three tacos', 'tacos')]],
    ['a large pizza, two slices', [it('a large pizza', 'pizza'), it('two slices', 'slices')]],
    [
      'a homemade pizza with pepperoni and mushrooms, two slices',
      [it('a homemade pizza', 'pizza'), it('pepperoni', 'pepperoni'), it('mushrooms', 'mushrooms'), it('two slices', 'slices')],
    ],
    ['peanut butter toast, 2 tbsp peanut butter', [it('peanut butter toast', 'peanut butter toast'), it('2 tbsp peanut butter', 'peanut butter')]],
    ['salad with chicken, 6 oz chicken', [it('salad with chicken', 'salad with chicken'), it('6 oz chicken', 'chicken')]],
    ['eggs and toast, two of each', [it('eggs', 'eggs'), it('toast', 'toast'), it('two of each', '')]],
    ['half a cup of rice, no, a full cup', [it('half a cup of rice', 'rice'), it('no', ''), it('a full cup', 'cup')]],
  ])('%s', (line, items) => {
    const r = fold(line, items);
    expect(raws(r.items)).toEqual(raws(items));
    expect(r.folds).toEqual([]);
  });

  test('oatmeal, a cup of blueberries (blueberries dropped): coverage fails', () => {
    const r = fold('oatmeal, a cup of blueberries', [it('oatmeal', 'oatmeal')]);
    expect(raws(r.items)).toEqual(['oatmeal']);
    expect(r.folds).toEqual([]);
  });

  test('toast, two of each (clause dropped): no coverage, unchanged', () => {
    const r = fold('toast, two of each', [it('toast', 'toast')]);
    expect(r.folds).toEqual([]);
  });
});

describe('mechanics', () => {
  test('the input array and its items are not mutated', () => {
    const items = [it('the leftover tuna salad', 'tuna salad'), it('maybe a cup', '')];
    const snapshot = JSON.parse(JSON.stringify(items));
    const r = fold('lunch was the leftover tuna salad, maybe a cup', items);
    expect(items).toEqual(snapshot);
    expect(r.items).not.toBe(items);
    expect(r.items[0]).not.toBe(items[0]);
    expect(r.items[0].normalizedForm).toBe('tuna salad');
  });

  test('brand, normalizedForm and unrelated fields ride through a fold unchanged', () => {
    const items = [
      { rawText: 'the leftover tuna salad', normalizedForm: 'tuna salad', brand: 'Acme', mealType: 'lunch' },
      { rawText: 'maybe a cup', normalizedForm: '', brand: '', mealType: 'lunch' },
    ];
    const r = foldTrailingQuantityClauses(key('lunch was the leftover tuna salad, maybe a cup'), items);
    expect(r.items).toEqual([{ rawText: '1 cup of leftover tuna salad', normalizedForm: 'tuna salad', brand: 'Acme', mealType: 'lunch' }]);
  });

  test('a span-less item between t and its gap blocks the gap fold', () => {
    const line = 'grilled chicken, maybe four, rice';
    const without = fold(line, [it('grilled chicken', 'grilled chicken'), it('rice', 'rice')]);
    expect(raws(without.items)).toEqual(['4 grilled chicken', 'rice']);
    const withGhost = fold(line, [it('grilled chicken', 'grilled chicken'), it('zzz not in the line', 'zzz'), it('rice', 'rice')]);
    expect(raws(withGhost.items)).toEqual(['grilled chicken', 'zzz not in the line', 'rice']);
    expect(withGhost.folds).toEqual([]);
  });

  test('folds[] carries kind, targetIndex, clause, before, after (segment)', () => {
    const r = fold('mac and cheese, about two cups', [it('mac and cheese', 'mac and cheese'), it('about two cups', '')]);
    expect(r.folds).toEqual([{
      kind: 'segment', targetIndex: 0, clause: 'about two cups', before: 'mac and cheese', after: '2 cups of mac and cheese',
    }]);
  });

  test('folds[] carries kind, targetIndex, clause, before, after (gap)', () => {
    const r = fold('brunch was hard boiled eggs, two of them, and some butter lettuce', [
      it('hard boiled eggs', 'hard boiled eggs'), it('butter lettuce', 'butter lettuce'),
    ]);
    expect(r.folds).toEqual([{
      kind: 'gap', targetIndex: 0, clause: 'two of them', before: 'hard boiled eggs', after: '2 hard boiled eggs',
    }]);
  });

  test('"..., maybe four." and "..., maybe four" (same lineKey) fold identically', () => {
    const items = [it("the kids' leftover chicken nuggets", 'chicken nuggets')];
    const a = foldTrailingQuantityClauses(key("dinner was the kids' leftover chicken nuggets, maybe four."), items);
    const b = foldTrailingQuantityClauses(key("dinner was the kids' leftover chicken nuggets, maybe four"), items);
    expect(key("x, maybe four.")).toBe(key('x, maybe four'));
    expect(a).toEqual(b);
    expect(raws(a.items)).toEqual(["4 kids' leftover chicken nuggets"]);
  });

  test('an empty split returns an empty split', () => {
    expect(foldTrailingQuantityClauses('anything', [])).toEqual({ items: [], folds: [] });
  });
});

describe('S202 row 5 - a pour target keeps its trailing quantity', () => {
  test('a swig of soda + maybe three folds to 3 swig, which parses to 4.5 floz', () => {
    const r = fold('a swig of soda, maybe three', [it('a swig of soda'), it('maybe three')]);
    expect(raws(r.items)).toEqual(['3 swig of soda']);
    const p = parseIngredientLine('3 swig of soda');
    expect([p?.qty, p?.unit, p?.name]).toEqual([4.5, 'floz', 'soda']);
  });

  test('a stated clause unit wins over the pour word', () => {
    const r = fold('a splash of milk, maybe a cup', [it('a splash of milk'), it('maybe a cup')]);
    expect(raws(r.items)).toEqual(['1 cup of milk']);
  });

  test('a non-pour unit target is still rejected (unchanged from base)', () => {
    const r = fold('a cup of rice, maybe two', [it('a cup of rice'), it('maybe two')]);
    expect(raws(r.items)).toEqual(['a cup of rice', 'maybe two']);
  });
});
