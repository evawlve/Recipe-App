/**
 * dish-part-drop - S240 cloud-36 C2. An uncovered word that opens a later comma piece ends the dish's parts list
 * (`a homemade burrito with eggs and cheese, also steak and rice` bills the steak and rice). Every case of the
 * gap-word fixture (fixtures/dish-part-gap-word.json, a copy of snapshots/s240/rowC2/fixture.json: 56 cases,
 * 12 with changed: true) runs through the shipped function.
 */

import { dropDishParts } from '../dish-part-drop';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/dish-part-gap-word.json';

type It = { rawText: string; normalizedForm?: string; brand?: string };
interface Case {
  src: string;
  line: string;
  input: It[];
  expectRawTexts: string[];
  dropped: string[];
  changed?: boolean;
}
const CASES = fixture as Case[];

describe('dropDishParts - gap-word fixture', () => {
  test('the fixture is the cut it claims to be: 56 cases, 12 changed', () => {
    expect(CASES).toHaveLength(56);
    expect(CASES.filter(c => c.changed === true)).toHaveLength(12);
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
