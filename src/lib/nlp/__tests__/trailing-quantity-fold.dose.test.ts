/**
 * Dose fold (S240, MGR 16:36Z): `a protein shake with N scoops [in milk]` bills N scoops of protein powder.
 * Table-driven over fixtures/dose-scoops.json (a copy of snapshots/s240/rowScoop/fixture-dose.json: 71 cases, 27 dose).
 */

import { foldTrailingQuantityClauses } from '../trailing-quantity-fold';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/dose-scoops.json';

interface Case {
  src: string;
  line: string;
  input: { rawText: string; normalizedForm?: string; brand?: string }[];
  expect: { rawText: string; normalizedForm: string }[];
  expectKinds: string[];
}
const CASES = fixture as Case[];

describe('dose-scoops fixture', () => {
  test('fixture shape: 71 cases, 27 dose', () => {
    expect(CASES).toHaveLength(71);
    expect(CASES.filter(c => c.expectKinds.includes('dose'))).toHaveLength(27);
  });

  test.each(CASES.map(c => [`${c.src}: ${c.line}`, c] as const))('%s', (_name, c) => {
    const before = JSON.stringify(c.input);
    const out = foldTrailingQuantityClauses(canonicalizeSegLine(c.line), c.input);
    expect(out.items.map(i => ({ rawText: i.rawText, normalizedForm: i.normalizedForm ?? '' }))).toEqual(c.expect);
    expect(out.folds.map(f => f.kind)).toEqual(c.expectKinds);
    expect(JSON.stringify(c.input)).toBe(before);
  });
});
