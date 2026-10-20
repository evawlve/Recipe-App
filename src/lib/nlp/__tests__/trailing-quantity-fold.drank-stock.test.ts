/**
 * Drank / finished stock fold - S240 cloud-38 D7. On a one-item line a stock whose clause the plain reader cannot parse
 * (`drank half`, `finished 2`) is re-counted through the consumed-count reading; a valid target is never rewritten.
 * Every case of fixtures/drank-stock.json (a copy of snapshots/s240/rowD7/fixture.json: 170 cases, 49 changed) runs
 * through the shipped function. Two `um, drank half` / `um, had half` cases were re-pinned from unchanged to `1/2 bottle of
 * wine` when #563 (an um / ok gap does not hide the clause, cloud-38 D8) merged in; their src says so.
 */

import { foldTrailingQuantityClauses } from '../trailing-quantity-fold';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/drank-stock.json';

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

describe('foldTrailingQuantityClauses - drank-stock fixture', () => {
  test('the fixture is the cut it claims to be: 170 cases, 49 changed', () => {
    expect(CASES).toHaveLength(170);
    expect(CASES.filter(c => c.changed)).toHaveLength(49);
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
