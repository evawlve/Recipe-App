/**
 * Gap-fold hesitation skip (S240, cloud-38 D8): `a large pizza, um, i had 3 slices` folds the clause after the `um`.
 * Table-driven over fixtures/gap-hesitation.json (a copy of snapshots/s240/rowD8/fixture.json: 66 cases, 27 changed).
 * `6 eggs, had 2` and `6 eggs, nope, had 2` were re-pinned from unchanged to `2 eggs` when #570 (a count-noun stock
 * re-counts, cloud-38 D13) merged in; their src says so.
 */

import { foldTrailingQuantityClauses } from '../trailing-quantity-fold';
import { resolveSelfCorrections } from '../self-correction';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/gap-hesitation.json';

interface Case {
  src: string;
  line: string;
  input: { rawText: string; normalizedForm?: string; brand?: string }[];
  expect: { rawText: string; normalizedForm: string }[];
  expectKinds: string[];
  changed: boolean;
}
const CASES = fixture as Case[];

describe('gap-hesitation fixture', () => {
  test('fixture shape: 66 cases, 27 changed', () => {
    expect(CASES).toHaveLength(66);
    expect(CASES.filter(c => c.changed)).toHaveLength(27);
  });

  test.each(CASES.map(c => [`${c.src}: ${c.line}`, c] as const))('%s', (_name, c) => {
    const before = JSON.stringify(c.input);
    const out = foldTrailingQuantityClauses(canonicalizeSegLine(c.line), c.input);
    expect(out.items.map(i => ({ rawText: i.rawText, normalizedForm: i.normalizedForm ?? '' }))).toEqual(c.expect);
    expect(out.folds.map(f => f.kind)).toEqual(c.expectKinds);
    expect(JSON.stringify(c.input)).toBe(before);
  });
});

describe('self-correction quantity-only tier is unchanged', () => {
  test('two slices of toast, er, one slice -> one item 1 slice of toast', () => {
    const input = [
      { rawText: 'two slices of toast', normalizedForm: 'toast' },
      { rawText: 'one slice', normalizedForm: 'slice' },
    ];
    const out = resolveSelfCorrections(canonicalizeSegLine('two slices of toast, er, one slice'), input);
    expect(out.items).toHaveLength(1);
    expect(out.items[0].rawText).toBe('1 slice of toast');
  });
});
