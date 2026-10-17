/**
 * drink-milk-fold - S202 row 3, 8(e) (seat C69), Diego's Option A (2026-10-17). Every case of the r3 fixture
 * (fixtures/drink-milk-fold-r3.json, a copy of snapshots/s202/row3/expected-drink-r3.json: 129 cases, 52
 * folding) is run through the shipped function; `src` names where the input came from.
 */

import { foldDrinkMilk } from '../drink-milk-fold';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/drink-milk-fold-r3.json';

type It = { rawText: string; normalizedForm?: string; brand?: string };
interface Case {
  src: string;
  line: string;
  input: It[];
  expectItems: Array<{ rawText: string; normalizedForm: string | null }>;
}
const CASES = fixture as Case[];

describe('foldDrinkMilk - r3 fixture', () => {
  test('the fixture is the cut it claims to be: 129 cases, 52 folding', () => {
    expect(CASES).toHaveLength(129);
    expect(CASES.filter(c => c.expectItems.length < c.input.length)).toHaveLength(52);
  });

  test.each(CASES.map((c, i) => [`${c.src} #${i}: ${c.line}`, c] as const))('%s', (_name, c) => {
    const r = foldDrinkMilk(canonicalizeSegLine(c.line), c.input);
    expect(r.items.map(x => ({ rawText: x.rawText, normalizedForm: x.normalizedForm ?? null }))).toEqual(
      c.expectItems,
    );
    expect(r.folds).toHaveLength(c.input.length - c.expectItems.length);
  });
});

describe('foldDrinkMilk - purity', () => {
  const line = 'a matcha latte with almond milk';
  const input = (): It[] => [
    { rawText: 'a matcha latte', normalizedForm: 'matcha latte', brand: 'Starbucks' },
    { rawText: 'almond milk', normalizedForm: 'almond milk' },
  ];

  test('the input is never mutated', () => {
    const items = input();
    const before = JSON.parse(JSON.stringify(items));
    const r = foldDrinkMilk(canonicalizeSegLine(line), items);
    expect(r.items).toHaveLength(1);
    expect(items).toEqual(before);
  });

  test('drop only: the drink (brand included) is passed through unchanged', () => {
    const r = foldDrinkMilk(canonicalizeSegLine(line), input());
    expect(r.items).toEqual([{ rawText: 'a matcha latte', normalizedForm: 'matcha latte', brand: 'Starbucks' }]);
    expect(r.folds).toEqual([{ index: 1, rawText: 'almond milk', drink: 'a matcha latte', kind: 'fold' }]);
  });
});
