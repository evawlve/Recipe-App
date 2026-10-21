/**
 * trailing-quantity-fold - S240 cloud-38 D3. A self-correction that rewrites the dose (`two scoops, ok, three scoops`)
 * must not hide it from the dose fold. Every case of fixtures/dose-correction.json (a copy of
 * snapshots/s240/rowD3/fixture.json: 66 cases, 18 changed) runs through the shipped function.
 */

import { foldTrailingQuantityClauses } from '../trailing-quantity-fold';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/dose-correction.json';

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

describe('foldTrailingQuantityClauses - dose correction fixture', () => {
  test('the fixture is the cut it claims to be: 66 cases, 18 changed', () => {
    expect(CASES).toHaveLength(66);
    expect(CASES.filter(c => c.changed)).toHaveLength(18);
  });

  test.each(CASES.map(c => [`${c.src}: ${c.line}`, c] as const))('%s', (_name, c) => {
    const r = foldTrailingQuantityClauses(canonicalizeSegLine(c.line), c.input);
    expect(r.items.map(i => ({ rawText: i.rawText, normalizedForm: i.normalizedForm ?? '' }))).toEqual(c.expect);
    expect(r.folds.map(f => f.kind)).toEqual(c.expectKinds);
  });

  test('never mutates its input', () => {
    for (const c of CASES) {
      const snapshot = JSON.parse(JSON.stringify(c.input));
      foldTrailingQuantityClauses(canonicalizeSegLine(c.line), c.input);
      expect(c.input).toEqual(snapshot);
    }
  });
});
