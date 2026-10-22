/**
 * trailing-quantity-fold - S340 cloud-40 F2 / H2. A self-correction after a consumed count restates the count, never the bags
 * (`a family size bag of chips, ate 3, sorry,` + [`4`] -> `4 chips`; `a 6 pack of beer, drank 2, wait, 3` -> `3 beer`). Every
 * case of the stock-correction fixture (fixtures/stock-correction.json, a copy of snapshots/s340/row2/fixture.json: 215 cases,
 * 74 changed) runs through the shipped function. The `refute r1 BLOCKER control` cases pin the three refuted over-bills
 * (a first clause naming another food, a unitless count on a valid non-stock host, a correction of someone else's count) to
 * the base reading.
 */

import { foldTrailingQuantityClauses } from '../trailing-quantity-fold';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/stock-correction.json';

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

describe('foldTrailingQuantityClauses - stock-correction fixture', () => {
  test('the fixture is the cut it claims to be: 215 cases, 74 changed', () => {
    expect(CASES).toHaveLength(215);
    expect(CASES.filter(c => c.changed)).toHaveLength(74);
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
