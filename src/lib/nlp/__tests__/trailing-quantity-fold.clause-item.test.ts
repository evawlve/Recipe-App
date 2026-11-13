/**
 * trailing-quantity-fold - S240 rowMint (MGR 00:16Z). A partial-eat clause the segmenter emits as its OWN item
 * (`a muffin` + [`ate the top only`]) is dropped and scales the item before it, not minted as a food. Every case of
 * fixtures/clause-item.json (a copy of snapshots/s240/rowMint/fixture.json: 31 cases, 19 changed) runs through the
 * shipped function.
 */

import { foldTrailingQuantityClauses } from '../trailing-quantity-fold';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/clause-item.json';

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

describe('foldTrailingQuantityClauses - clause-item fixture', () => {
  test('the fixture is the cut it claims to be: 31 cases, 19 changed', () => {
    expect(CASES).toHaveLength(31);
    expect(CASES.filter(c => c.changed)).toHaveLength(19);
  });

  test.each(CASES.map(c => [`${c.src}: ${c.line}`, c] as const))('%s', (_name, c) => {
    const r = foldTrailingQuantityClauses(canonicalizeSegLine(c.line), c.input);
    expect(r.items.map(i => ({ rawText: i.rawText, normalizedForm: i.normalizedForm ?? '' }))).toEqual(c.expect);
    expect(r.folds.map(f => f.kind)).toEqual(c.expectKinds);
  });
});
