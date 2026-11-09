/**
 * Clock time is not a quantity (s453, seat MAGIC C14): `..., then a chicken wrap at 7` billed 7 chicken wraps (1,225 g /
 * 2,450 kcal) on deploy 21 - the gap fold read `at 7` as a hedged count, because `at` leads `at least 3` / `at most 2`.
 * A clock-time clause never folds, in the gap or the segment shape; `at least` / `at most` and the hedged counts
 * (`chicken nuggets, around 8`) fold exactly as before.
 */

import { foldTrailingQuantityClauses } from '../trailing-quantity-fold';
import { canonicalizeSegLine } from '../seg-line-key';

type It = { rawText: string; normalizedForm?: string };
const run = (line: string, items: It[]) => {
  const before = JSON.stringify(items);
  const out = foldTrailingQuantityClauses(canonicalizeSegLine(line), items);
  expect(JSON.stringify(items)).toBe(before);
  return { raw: out.items.map(i => i.rawText), kinds: out.folds.map(f => f.kind) };
};
const banana: It = { rawText: 'a banana', normalizedForm: 'banana' };
const wrap: It = { rawText: 'a chicken wrap', normalizedForm: 'chicken wrap' };

describe('the organic member (s453 MAGIC C14)', () => {
  test('the protein dose still folds; `at 7` leaves the chicken wrap at one', () => {
    const out = run('after the gym a protein shake with 2 scoops and a banana, then a chicken wrap at 7', [
      { rawText: 'a protein shake', normalizedForm: 'protein shake' },
      { rawText: '2 scoops', normalizedForm: 'scoops' },
      banana,
      wrap,
    ]);
    expect(out.raw).toEqual(['2 scoops of protein powder', 'a banana', 'a chicken wrap']);
    expect(out.kinds).toEqual(['dose']);
  });
});

describe('gap shape: a clock time after the item never folds', () => {
  test.each([
    'at 7', 'at 7pm', 'at 7 pm', 'at 7 p.m.', 'at 6:30', 'at 7 o\'clock', 'at seven', 'at around 7', 'at like 7', 'at 19',
    'around 8', 'about 8', 'around 8pm', 'by 9', 'at noon', 'at midnight', 'tonight',
  ])('a banana, then a chicken wrap %s', tail => {
    const out = run(`a banana, then a chicken wrap ${tail}`, [banana, wrap]);
    expect(out.raw).toEqual(['a banana', 'a chicken wrap']);
    expect(out.kinds).toEqual([]);
  });

  test('a plural item: `chicken nuggets at 7` is still a time', () => {
    const out = run('a banana, chicken nuggets at 7', [banana, { rawText: 'chicken nuggets', normalizedForm: 'chicken nuggets' }]);
    expect(out.raw).toEqual(['a banana', 'chicken nuggets']);
  });
});

describe('segment shape: a split-off clock time never folds onto the item before it', () => {
  test.each(['at 7', 'around 8', 'about 8', 'at seven'])('a banana, then a chicken wrap, + [%s]', tail => {
    const out = run(`a banana, then a chicken wrap, ${tail}`, [banana, wrap, { rawText: tail, normalizedForm: tail }]);
    expect(out.raw.slice(0, 2)).toEqual(['a banana', 'a chicken wrap']);
    expect(out.kinds).toEqual([]);
  });
});

describe('CONTROLS: every count fold is unchanged', () => {
  test.each([
    ['a banana, chicken nuggets, at least 6', 'chicken nuggets', '6 chicken nuggets'],
    ['a coke, tacos, at most 2', 'tacos', '2 tacos'],
    ['a banana, chicken nuggets, around 8', 'chicken nuggets', '8 chicken nuggets'],
    ['a coke, chicken wings, about 10', 'chicken wings', '10 chicken wings'],
    ['a coke, tacos, like 3', 'tacos', '3 tacos'],
    ['a coke, tacos, maybe 3', 'tacos', '3 tacos'],
  ])('%s', (line, food, after) => {
    const first = line.split(',')[0];
    const out = run(line, [{ rawText: first, normalizedForm: first.replace(/^a /, '') }, { rawText: food, normalizedForm: food }]);
    expect(out.raw).toEqual([first, after]);
    expect(out.kinds).toEqual(['gap']);
  });

  test('segment shape: [tacos] + [at least 3] still folds', () => {
    const out = run('a coke, tacos, at least 3', [{ rawText: 'a coke', normalizedForm: 'coke' }, { rawText: 'tacos', normalizedForm: 'tacos' }, { rawText: 'at least 3', normalizedForm: 'at least 3' }]);
    expect(out.raw).toEqual(['a coke', '3 tacos']);
    expect(out.kinds).toEqual(['segment']);
  });
});
