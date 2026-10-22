/**
 * trailing-quantity-fold - S340 row R (MGR 20:30Z, C68's deploy-3 read). A span-less item the segmenter restated as a
 * fraction of the item before it (`a bottle of wine, um, drank half` -> [`a bottle of wine`] + [`half a bottle of wine`])
 * folds onto that item, only when the line states the same fraction behind a consume verb and nothing but filler follows.
 * Every case of the fixture (fixtures/restated-fraction.json, a copy of snapshots/s340/rowRestate/fixture.json: 99 cases,
 * 33 changed) runs through the shipped function. The `refute r1 B1/M1 control` cases pin a later portion (B1) and a
 * reordered stated item (M1) to the base reading.
 */

import { foldTrailingQuantityClauses } from '../trailing-quantity-fold';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/restated-fraction.json';

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

describe('foldTrailingQuantityClauses - restated-fraction fixture', () => {
  test('the fixture is the cut it claims to be: 99 cases, 33 changed', () => {
    expect(CASES).toHaveLength(99);
    expect(CASES.filter(c => c.changed)).toHaveLength(33);
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
