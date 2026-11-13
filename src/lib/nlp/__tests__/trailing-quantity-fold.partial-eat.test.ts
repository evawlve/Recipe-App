/**
 * Partial-eat fold (S240, MGR route 4): a dropped clause (`a sandwich, i gave half to my friend`) scales the
 * item it follows. Table-driven over fixtures/partial-eat.json (a copy of snapshots/s240/row4-partial/
 * fixture-partial.json: 83 cases, 21 fire as kind `partial`).
 */

import { foldTrailingQuantityClauses, parsePartialEat } from '../trailing-quantity-fold';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/partial-eat.json';

interface Case {
  src: string;
  line: string;
  input: { rawText: string; normalizedForm?: string; brand?: string }[];
  expectRawTexts: string[];
  expectKinds: string[];
}
const CASES = fixture as Case[];

describe('partial-eat fixture', () => {
  test('fixture shape: 83 cases, 21 partial', () => {
    expect(CASES).toHaveLength(83);
    expect(CASES.filter(c => c.expectKinds.includes('partial'))).toHaveLength(21);
  });

  test.each(CASES.map(c => [`${c.src}: ${c.line}`, c] as const))('%s', (_name, c) => {
    const before = JSON.stringify(c.input);
    const out = foldTrailingQuantityClauses(canonicalizeSegLine(c.line), c.input);
    expect(out.items.map(i => i.rawText)).toEqual(c.expectRawTexts);
    expect(out.folds.map(f => f.kind)).toEqual(c.expectKinds);
    expect(JSON.stringify(c.input)).toBe(before);
  });
});

describe('parsePartialEat()', () => {
  test('gave half to my friend -> x1/2, names no food', () => {
    expect(parsePartialEat(['i', 'gave', 'half', 'to', 'my', 'friend'])).toEqual({ factor: 0.5, food: [] });
  });
  test('shared half and half (the creamer) -> null', () => {
    expect(parsePartialEat(['shared', 'half', 'and', 'half'])).toBeNull();
  });
  test('a phrase outside the table -> null', () => {
    expect(parsePartialEat(['couldnt', 'finish', 'it'])).toBeNull();
  });
});
