/**
 * dish-part-drop - S240 cloud-38 D1. A meal frame (`for lunch`, `at dinner`, `as a snack`, `this morning`) ends a
 * provenance phrase, so the next food on the line is not swallowed. Every case of the meal-frame fixture
 * (fixtures/dish-part-meal-frame.json, a copy of snapshots/s240/rowD1/fixture.json: 39 cases, 24 changed) runs
 * through the shipped function.
 */

import { dropDishParts } from '../dish-part-drop';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/dish-part-meal-frame.json';

type It = { rawText: string; normalizedForm?: string; brand?: string };
interface Case {
  src: string;
  line: string;
  input: It[];
  expectRawTexts: string[];
  dropped: string[];
  changed: boolean;
}
const CASES = fixture as Case[];

describe('dropDishParts - meal-frame fixture', () => {
  test('the fixture is the cut it claims to be: 39 cases, 24 changed', () => {
    expect(CASES).toHaveLength(39);
    expect(CASES.filter(c => c.changed)).toHaveLength(24);
  });

  test.each(CASES.map(c => [`${c.src}: ${c.line}`, c] as const))('%s', (_name, c) => {
    const r = dropDishParts(canonicalizeSegLine(c.line), c.input);
    expect(r.items.map(i => i.rawText)).toEqual(c.expectRawTexts);
    expect(r.drops.map(d => d.rawText)).toEqual(c.dropped);
  });

  test('never mutates its input', () => {
    for (const c of CASES) {
      const snapshot = JSON.parse(JSON.stringify(c.input));
      dropDishParts(canonicalizeSegLine(c.line), c.input);
      expect(c.input).toEqual(snapshot);
    }
  });
});
