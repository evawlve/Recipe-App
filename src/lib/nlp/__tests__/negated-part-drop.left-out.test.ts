/**
 * negated-part-drop - S240 cloud-38 D2. Bare `left out` with no determiner is leftover food (`a coke and left out pizza
 * from last night`) unless the verb opens its own clause. Every case of fixtures/negated-left-out.json (a copy of
 * snapshots/s240/rowD2/fixture.json: 39 cases, 5 with changed: true) runs through the shipped function.
 */

import { dropNegatedParts } from '../negated-part-drop';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/negated-left-out.json';

type It = { rawText: string; normalizedForm?: string; brand?: string };
interface Case {
  src: string;
  line: string;
  input: It[];
  expectRawTexts: string[];
  changed?: boolean;
}
const CASES = fixture as Case[];

describe('dropNegatedParts - left out fixture', () => {
  test('the fixture is the cut it claims to be: 39 cases, 5 changed', () => {
    expect(CASES).toHaveLength(39);
    expect(CASES.filter(c => c.changed === true)).toHaveLength(5);
  });

  test.each(CASES.map(c => [`${c.src}: ${c.line}`, c] as const))('%s', (_name, c) => {
    const r = dropNegatedParts(canonicalizeSegLine(c.line), c.input);
    expect(r.items.map(i => i.rawText)).toEqual(c.expectRawTexts);
  });

  test('never mutates its input', () => {
    for (const c of CASES) {
      const snapshot = JSON.parse(JSON.stringify(c.input));
      dropNegatedParts(canonicalizeSegLine(c.line), c.input);
      expect(c.input).toEqual(snapshot);
    }
  });
});
