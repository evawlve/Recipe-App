/**
 * negated-part-drop - S192 row 3. Base inputs are the driver draws in
 * snapshots/s192/row3/neg-base.tsv (itemsJson r=rawText n=normalizedForm b=brand), verbatim.
 */

import { dropNegatedParts } from '../negated-part-drop';
import { foldTrailingQuantityClauses } from '../trailing-quantity-fold';
import { canonicalizeSegLine } from '../seg-line-key';

type It = { rawText: string; normalizedForm: string; brand: string };
const it = (r: string, n: string, b = ''): It => ({ rawText: r, normalizedForm: n, brand: b });

function run(line: string, items: It[]) {
  return dropNegatedParts(canonicalizeSegLine(line), items);
}
const raws = (xs: It[]) => xs.map(x => x.rawText);

describe('dropNegatedParts - true positives', () => {
  test.each([
    ['a double cheeseburger, no bun (draw 0.1)', 'a double cheeseburger, no bun',
      [it('a double cheeseburger', 'double cheeseburger'), it('no bun', 'bun')], ['a double cheeseburger'], ['negated']],
    ['a double cheeseburger, no bun (draw 0.2)', 'a double cheeseburger, no bun',
      [it('a double cheeseburger', 'double cheeseburger'), it('no bun', 'bun')], ['a double cheeseburger'], ['negated']],
    ['a burrito bowl, no rice and no beans', 'a burrito bowl, no rice and no beans',
      [it('a burrito bowl', 'burrito bowl'), it('no rice', 'rice'), it('no beans', 'beans')], ['a burrito bowl'], ['negated', 'negated']],
    ['breakfast sandwich, no sausage', 'an egg and cheese breakfast sandwich, no sausage',
      [it('an egg and cheese breakfast sandwich', 'egg and cheese breakfast sandwich'), it('no sausage', 'sausage')],
      ['an egg and cheese breakfast sandwich'], ['negated']],
    ['club sandwich, i took off the bacon', 'a club sandwich, i took off the bacon',
      [it('a club sandwich', 'club sandwich'), it('bacon', 'bacon')], ['a club sandwich'], ['removed']],
    ['spaghetti and meatballs, picked out (draw 9.1)', 'spaghetti and meatballs but i picked out the meatballs',
      [it('spaghetti and meatballs', 'spaghetti and meatballs'), it('meatballs', 'meatballs')], ['spaghetti and meatballs'], ['removed']],
    ['spaghetti and meatballs, picked out (draw 9.3, n spaghetti)', 'spaghetti and meatballs but i picked out the meatballs',
      [it('spaghetti and meatballs', 'spaghetti'), it('meatballs', 'meatballs')], ['spaghetti and meatballs'], ['removed']],
    ['baked potato with everything except sour cream', 'a baked potato with everything except sour cream',
      [it('a baked potato', 'baked potato'), it('everything except sour cream', 'everything except sour cream')],
      ['a baked potato'], ['exclusion']],
  ] as Array<[string, string, It[], string[], string[]]>)('%s', (_name, line, items, keep, kinds) => {
    const res = run(line, items);
    expect(raws(res.items)).toEqual(keep);
    expect(res.drops.map(d => d.kind)).toEqual(kinds);
  });

  test('drops[] fields: kind, ORIGINAL index, rawText', () => {
    const a = run('a burrito bowl, no rice and no beans',
      [it('a burrito bowl', 'burrito bowl'), it('no rice', 'rice'), it('no beans', 'beans')]);
    expect(a.drops).toEqual([
      { kind: 'negated', index: 1, rawText: 'no rice' },
      { kind: 'negated', index: 2, rawText: 'no beans' },
    ]);
    const b = run('a club sandwich, i took off the bacon', [it('a club sandwich', 'club sandwich'), it('bacon', 'bacon')]);
    expect(b.drops).toEqual([{ kind: 'removed', index: 1, rawText: 'bacon' }]);
  });
});

describe('dropNegatedParts - unchanged', () => {
  test.each([
    ['croutons (i left)', 'a grilled chicken salad, i left the croutons',
      [it('a grilled chicken salad', 'grilled chicken salad'), it('croutons', 'croutons')]],
    ['croutons (i left, draw 14.3)', 'a grilled chicken salad, i left the croutons',
      [it('a grilled chicken salad', 'grilled chicken salad'), it('i left the croutons', 'croutons')]],
    ['nachos + jalapenos', 'nachos with no sour cream and extra jalapenos',
      [it('nachos', 'nachos'), it('jalapenos', 'jalapenos')]],
    ['coffee + milk', 'a cup of coffee with milk, no sugar', [it('a cup of coffee', 'coffee'), it('milk', 'milk')]],
    ['FP item 0: No Cow', 'a no cow protein bar and a banana', [it('a no cow protein bar', 'protein bar', 'No Cow'), it('a banana', 'banana')]],
    ['FP item 0: No Cow n=no cow protein bar', 'a no cow protein bar and a banana',
      [it('a no cow protein bar', 'no cow protein bar', 'No Cow'), it('a banana', 'banana')]],
    ['FP item 0: No Yolks', 'no yolks egg noodles with butter', [it('no yolks egg noodles', 'egg noodles', 'no yolks'), it('butter', 'butter')]],
    ['FP item 0: No Sugar Added applesauce', 'no sugar added applesauce and a granola bar',
      [it('no sugar added applesauce', 'applesauce'), it('a granola bar', 'granola bar')]],
    ['FP item 0: Hold the Cone', 'trader joes hold the cone and a coffee',
      [it('trader joes hold the cone', 'hold the cone', 'trader joes'), it('a coffee', 'coffee')]],
    ['FP item 0: Maranatha No Stir', 'maranatha no stir almond butter on toast',
      [it('maranatha no stir almond butter', 'almond butter', 'Maranatha'), it('toast', 'toast')]],
    ['FP j>=1: parfait 20.2', 'a parfait with no sugar added greek yogurt',
      [it('a parfait', 'parfait'), it('no sugar added greek yogurt', 'greek yogurt')]],
    ['FP j>=1: no cow bar (brand)', 'a banana and no cow bar', [it('a banana', 'banana'), it('no cow bar', 'cow bar', 'No Cow')]],
    ['FP j>=1: hold the cone (no NEG start)', 'a coffee, trader joes hold the cone',
      [it('a coffee', 'coffee'), it('trader joes hold the cone', 'hold the cone', 'trader joes')]],
    ['FP j>=1: no-bake cookies', 'milk and no-bake cookies', [it('milk', 'milk'), it('no-bake cookies', 'bake cookies')]],
    ['FP j>=1: comma-less correction', 'four pancakes no three pancakes', [it('four pancakes', 'pancakes'), it('three pancakes', 'pancakes')]],
    ['FP j>=1: sugar added jam', 'toast with no sugar added jam', [it('toast', 'toast'), it('sugar added jam', 'jam')]],
    ['known miss: item 0 no bun', 'no bun, a double cheeseburger', [it('no bun', 'bun'), it('a double cheeseburger', 'double cheeseburger')]],
  ] as Array<[string, string, It[]]>)('%s', (_name, line, items) => {
    const res = run(line, items);
    expect(res.items).toEqual(items);
    expect(res.drops).toEqual([]);
  });

  test('empty normalizedForm is never dropped by rule (a)', () => {
    const items = [it('a double cheeseburger', 'double cheeseburger'), it('no bun', '')];
    expect(run('a double cheeseburger, no bun', items).items).toEqual(items);
  });

  test('empty and single-item lists pass through', () => {
    expect(run('x', []).items).toEqual([]);
    const one = [it('no bun', 'bun')];
    expect(run('no bun', one).items).toEqual(one);
  });
});

describe('dropNegatedParts - composition and purity', () => {
  // DEVIATION from design.md r2 §Expected (which says `2 double cheeseburger`): the fold reads
  // lineKey, not the dropped items, so the gap fold's first non-connector piece after the cheeseburger
  // is still `no bun` and `two of them` is not reached (row 2 alone gives the same on this line). What
  // drop-first DOES buy is pinned here: the dropped part is never rewritten into a billed `2 no bun`.
  test('route order: drop then fold keeps the cheeseburger and never mints "2 no bun"', () => {
    const line = 'a double cheeseburger, no bun, two of them';
    const key = canonicalizeSegLine(line);
    const base = [it('a double cheeseburger', 'double cheeseburger'), it('no bun', 'bun')];
    const np = dropNegatedParts(key, base);
    const tq = foldTrailingQuantityClauses(key, np.items);
    expect(raws(tq.items)).toEqual(['a double cheeseburger']);
    // fold-first (the rejected order) is what would have billed the negated part:
    expect(raws(foldTrailingQuantityClauses(key, base).items)).toEqual(['a double cheeseburger', '2 no bun']);
  });

  test('the input array and its items are not mutated', () => {
    const items = [it('a club sandwich', 'club sandwich'), it('bacon', 'bacon')];
    const snapshot = JSON.parse(JSON.stringify(items));
    const res = run('a club sandwich, i took off the bacon', items);
    expect(items).toEqual(snapshot);
    expect(res.items).not.toBe(items);
    expect(items).toHaveLength(2);
  });
});
