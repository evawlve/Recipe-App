/**
 * readMadeWithHeads - S240 (MGR 18:44Z (2)). An item carrying its own personal made-with marker is the dish: its
 * normalizedForm becomes the head, rawText kept; a bare label claim stays. Every case of the fixture
 * (fixtures/dish-part-made-with.json, a copy of snapshots/s240/rowMadeWith/fixture.json: 51 cases, 19 with heads)
 * runs through the shipped function.
 */

import { readMadeWithHeads } from '../dish-part-drop';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/dish-part-made-with.json';

type It = { rawText: string; normalizedForm?: string; brand?: string };
interface Case {
  src: string;
  line: string;
  input: It[];
  expect: Array<{ rawText: string; normalizedForm: string }>;
  heads: string[];
}
const CASES = fixture as Case[];

describe('readMadeWithHeads - made-with fixture', () => {
  test('the fixture is the cut it claims to be: 51 cases, 19 with heads', () => {
    expect(CASES).toHaveLength(51);
    expect(CASES.filter(c => c.heads.length > 0)).toHaveLength(19);
  });

  test.each(CASES.map(c => [`${c.src}: ${c.line}`, c] as const))('%s', (_name, c) => {
    const r = readMadeWithHeads(canonicalizeSegLine(c.line), c.input);
    expect(r.items.map(i => ({ rawText: i.rawText, normalizedForm: i.normalizedForm ?? '' }))).toEqual(c.expect);
    expect(r.heads.map(h => h.head)).toEqual(c.heads);
  });

  test('never mutates its input', () => {
    for (const c of CASES) {
      const snapshot = JSON.parse(JSON.stringify(c.input));
      readMadeWithHeads(canonicalizeSegLine(c.line), c.input);
      expect(c.input).toEqual(snapshot);
    }
  });
});
