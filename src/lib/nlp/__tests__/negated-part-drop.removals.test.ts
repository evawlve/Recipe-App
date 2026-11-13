/**
 * negated-part-drop - S240 (MGR 17:14Z b): a removed / negated part the segmenter split off is dropped.
 * Table-driven over fixtures/negated-part-removals.json (90 cases: the refuter's three attack sets + seat lines).
 */

import { dropNegatedParts } from '../negated-part-drop';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/negated-part-removals.json';

interface Case {
  src: string;
  line: string;
  input: Array<{ rawText: string; normalizedForm: string; brand: string }>;
  expectRawTexts: string[];
  expectKinds: string[];
}
const CASES = fixture as Case[];

describe('dropNegatedParts - removals fixture', () => {
  test('the fixture holds 90 cases', () => {
    expect(CASES).toHaveLength(90);
  });

  test.each(CASES.map(c => [`${c.src}: ${c.line}`, c] as [string, Case]))('%s', (_name, c) => {
    const before = JSON.stringify(c.input);
    const res = dropNegatedParts(canonicalizeSegLine(c.line), c.input);
    expect(res.items.map(i => i.rawText)).toEqual(c.expectRawTexts);
    expect(JSON.stringify(c.input)).toBe(before);
  });
});
