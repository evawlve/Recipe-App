/**
 * drink-milk-fold pronoun rule - S240 (seat C69), cloud-36 C11. Every case of the pronoun fixture
 * (fixtures/drink-milk-pronoun.json, a copy of snapshots/s240/rowC11/fixture.json: 36 cases) is run through
 * the shipped function; `src` names where the input came from.
 */

import { foldDrinkMilk } from '../drink-milk-fold';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/drink-milk-pronoun.json';

type It = { rawText: string; normalizedForm?: string; brand?: string };
interface Case {
  src: string;
  line: string;
  input: It[];
  expectRawTexts: string[];
}
const CASES = fixture as Case[];

describe('foldDrinkMilk - pronoun fixture', () => {
  test('the fixture is the cut it claims to be: 36 cases', () => {
    expect(CASES).toHaveLength(36);
  });

  test.each(CASES.map(c => [`${c.src}: ${c.line}`, c] as const))('%s', (_name, c) => {
    const r = foldDrinkMilk(canonicalizeSegLine(c.line), c.input);
    expect(r.items.map(i => i.rawText)).toEqual(c.expectRawTexts);
  });

  test('the input is never mutated', () => {
    for (const c of CASES) {
      const before = JSON.stringify(c.input);
      foldDrinkMilk(canonicalizeSegLine(c.line), c.input);
      expect(JSON.stringify(c.input)).toBe(before);
    }
  });
});
