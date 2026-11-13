/**
 * trailing-quantity-fold - TOPPING (S240, cloud-38 D4, MGR 19:10Z). A food-less spoon measure after a dish named with its
 * topping measures the topping, not the dish. Every case of fixtures/topping-spoon.json (a copy of
 * snapshots/s240/rowD4/fixture.json: 32 cases, 25 changed) runs through the shipped function.
 */

import { foldTrailingQuantityClauses } from '../trailing-quantity-fold';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/topping-spoon.json';

type It = { rawText: string; normalizedForm?: string; brand?: string };
interface Case {
  src: string;
  line: string;
  input: It[];
  expect: { rawText: string; normalizedForm: string }[];
  expectKinds: string[];
  changed: boolean;
}
const CASES = fixture as Case[];

describe('foldTrailingQuantityClauses - topping-spoon fixture', () => {
  test('the fixture is the cut it claims to be: 32 cases, 25 changed', () => {
    expect(CASES).toHaveLength(32);
    expect(CASES.filter(c => c.changed)).toHaveLength(25);
  });

  test.each(CASES.map(c => [`${c.src}: ${c.line}`, c] as const))('%s', (_name, c) => {
    const r = foldTrailingQuantityClauses(canonicalizeSegLine(c.line), c.input);
    expect(r.items.map(i => ({ rawText: i.rawText, normalizedForm: i.normalizedForm ?? '' }))).toEqual(c.expect);
    expect(r.folds.map(f => f.kind)).toEqual(c.expectKinds);
  });

  test('named miss: a spoon-measured spread host loses its stated amount', () => {
    const line = 'peanut butter with honey, 4 tbsp';
    const input: It[] = [
      { rawText: 'peanut butter with honey', normalizedForm: 'peanut butter with honey', brand: '' },
      { rawText: '4 tbsp', normalizedForm: '4 tbsp', brand: '' },
    ];
    const r = foldTrailingQuantityClauses(canonicalizeSegLine(line), input);
    expect(r.items.map(i => i.rawText)).toEqual(['peanut butter with honey']);
  });

  test('never mutates its input', () => {
    for (const c of CASES) {
      const snapshot = JSON.parse(JSON.stringify(c.input));
      foldTrailingQuantityClauses(canonicalizeSegLine(c.line), c.input);
      expect(c.input).toEqual(snapshot);
    }
  });
});
