/**
 * dish-part-drop - S240 cloud-36 C12. A whole provenance phrase (`from last night's dinner`) does not end the
 * dish-part list. Every case of the provenance fixture (fixtures/dish-part-provenance.json, a copy of
 * snapshots/s240/rowC1213/fixture-provenance.json: 52 cases) runs through the shipped function.
 */

import { dropDishParts } from '../dish-part-drop';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/dish-part-provenance.json';

type It = { rawText: string; normalizedForm?: string; brand?: string };
interface Case {
  src: string;
  line: string;
  input: It[];
  expectRawTexts: string[];
}
const CASES = fixture as Case[];

describe('dropDishParts - provenance fixture', () => {
  test('the fixture is the cut it claims to be: 52 cases', () => {
    expect(CASES).toHaveLength(52);
  });

  test.each(CASES.map(c => [`${c.src}: ${c.line}`, c] as const))('%s', (_name, c) => {
    const r = dropDishParts(canonicalizeSegLine(c.line), c.input);
    expect(r.items.map(i => i.rawText)).toEqual(c.expectRawTexts);
  });

  test('never mutates its input', () => {
    for (const c of CASES) {
      const snapshot = JSON.parse(JSON.stringify(c.input));
      dropDishParts(canonicalizeSegLine(c.line), c.input);
      expect(c.input).toEqual(snapshot);
    }
  });
});
