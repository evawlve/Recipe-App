/**
 * drink-milk-fold ice rule - S240 (seat C69), MGR reserve R2. Every case of the ice fixture
 * (fixtures/drink-ice.json, a copy of snapshots/s240/rowR2/fixture-ice.json: 90 cases, 28 dropping ice) is run
 * through the shipped function; `src` names where the input came from.
 */

import { foldDrinkMilk } from '../drink-milk-fold';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/drink-ice.json';

type It = { rawText: string; normalizedForm?: string; brand?: string };
interface Case {
  src: string;
  line: string;
  input: It[];
  expectRawTexts: string[];
  expectKinds: string[];
}
const CASES = fixture as Case[];

describe('foldDrinkMilk - ice fixture', () => {
  test('the fixture is the cut it claims to be: 90 cases, 28 with kind ice', () => {
    expect(CASES).toHaveLength(90);
    expect(CASES.filter(c => c.expectKinds.includes('ice'))).toHaveLength(28);
  });

  test.each(CASES.map(c => [`${c.src}: ${c.line}`, c] as const))('%s', (_name, c) => {
    const r = foldDrinkMilk(canonicalizeSegLine(c.line), c.input);
    expect(r.items.map(i => i.rawText)).toEqual(c.expectRawTexts);
    expect(r.folds.map(f => f.kind)).toEqual(c.expectKinds);
  });

  test('the input is never mutated', () => {
    for (const c of CASES) {
      const before = JSON.stringify(c.input);
      foldDrinkMilk(canonicalizeSegLine(c.line), c.input);
      expect(JSON.stringify(c.input)).toBe(before);
    }
  });
});
