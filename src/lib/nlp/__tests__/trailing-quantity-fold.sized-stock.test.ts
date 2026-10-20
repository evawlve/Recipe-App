/**
 * trailing-quantity-fold - S240 cloud-38 D5. A consumed whole count over a COUNT-stock container before `of` (a family size
 * bag of chips) re-counts the food, not the bags. Every case of the sized-stock fixture (fixtures/sized-stock.json, a copy
 * of snapshots/s240/rowD5/fixture.json: 91 cases, 40 changed) runs through the shipped function. Five `drank 2` cases were
 * re-pinned from unchanged to `2 <food>` when #568 (drank re-counts a stock, cloud-38 D7) merged in; their src says so.
 */

import { foldTrailingQuantityClauses } from '../trailing-quantity-fold';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/sized-stock.json';

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

describe('foldTrailingQuantityClauses - sized-stock fixture', () => {
  test('the fixture is the cut it claims to be: 91 cases, 40 changed', () => {
    expect(CASES).toHaveLength(91);
    expect(CASES.filter(c => c.changed)).toHaveLength(40);
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
