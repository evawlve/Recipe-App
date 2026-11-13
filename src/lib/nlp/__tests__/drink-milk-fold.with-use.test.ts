/**
 * drink-milk-fold.with-use - S240 cloud-36 C6. `with` + a word that opens a later item (not ice, not a drink addition)
 * is second-use evidence for an `and` milk, so `a latte and milk with cereal` keeps the cereal's milk. Every case of the
 * fixture (fixtures/drink-milk-with-use.json, a copy of snapshots/s240/rowC6/fixture.json: 58 cases, 16 changed)
 * runs through the shipped function.
 */

import { foldDrinkMilk } from '../drink-milk-fold';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/drink-milk-with-use.json';

type It = { rawText: string; normalizedForm?: string; brand?: string };
interface Case {
  src: string;
  line: string;
  input: It[];
  expectRawTexts: string[];
  expectKinds: string[];
  changed: boolean;
}
const CASES = fixture as Case[];

describe('foldDrinkMilk - with-use fixture', () => {
  test('the fixture is the cut it claims to be: 58 cases, 16 changed', () => {
    expect(CASES).toHaveLength(58);
    expect(CASES.filter(c => c.changed)).toHaveLength(16);
  });

  test.each(CASES.map(c => [`${c.src}: ${c.line}`, c] as const))('%s', (_name, c) => {
    const r = foldDrinkMilk(canonicalizeSegLine(c.line), c.input);
    expect(r.items.map(i => i.rawText)).toEqual(c.expectRawTexts);
    expect(r.folds.map(f => f.kind)).toEqual(c.expectKinds);
  });

  test('never mutates its input', () => {
    for (const c of CASES) {
      const snapshot = JSON.parse(JSON.stringify(c.input));
      foldDrinkMilk(canonicalizeSegLine(c.line), c.input);
      expect(c.input).toEqual(snapshot);
    }
  });
});
