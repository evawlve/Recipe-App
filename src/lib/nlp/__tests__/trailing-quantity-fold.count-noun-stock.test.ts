/**
 * Count-noun stock (S240, cloud-38 D13): `6 eggs, had 2` re-counts to `2 eggs`. Every case of fixtures/count-noun-stock.json
 * (a copy of snapshots/s240/rowD13/fixture.json: 88 cases, 22 changed) runs through the shipped function.
 */

import { foldTrailingQuantityClauses } from '../trailing-quantity-fold';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/count-noun-stock.json';

type In = { rawText: string; normalizedForm?: string; brand?: string };
interface Case {
  src: string;
  line: string;
  input: In[];
  expect: { rawText: string; normalizedForm: string }[];
  expectKinds: string[];
  changed: boolean;
}
const CASES = fixture as Case[];

describe('foldTrailingQuantityClauses - count-noun stock fixture', () => {
  test('the fixture is the cut it claims to be: 88 cases, 22 changed', () => {
    expect(CASES).toHaveLength(88);
    expect(CASES.filter(c => c.changed)).toHaveLength(22);
  });

  test.each(CASES.map(c => [`${c.src}: ${c.line}`, c] as const))('%s', (_name, c) => {
    const out = foldTrailingQuantityClauses(canonicalizeSegLine(c.line), c.input);
    expect(out.items.map(i => ({ rawText: i.rawText, normalizedForm: i.normalizedForm ?? '' }))).toEqual(c.expect);
    expect(out.folds.map(f => f.kind)).toEqual(c.expectKinds);
  });

  test('never mutates its input', () => {
    for (const c of CASES) {
      const snapshot = JSON.parse(JSON.stringify(c.input));
      foldTrailingQuantityClauses(canonicalizeSegLine(c.line), c.input);
      expect(c.input).toEqual(snapshot);
    }
  });
});
