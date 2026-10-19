/**
 * self-correction.markers.test.ts - every fixture case of the S240 correction-markers row (seat C69):
 * `ok fine` / a lone `wait` as weak markers, the ordinals as ADD words, and the qty kind keeping the earlier unit.
 * The fixture is the seat-read expectation: 159 cases (7 draws x3, four attack sets), 82 changed vs the base pass.
 */

import { resolveSelfCorrections } from '../self-correction';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/self-correction-markers.json';

interface In {
  rawText: string;
  normalizedForm?: string;
  brand?: string;
}
interface Case {
  src: string;
  line: string;
  input: In[];
  expectRawTexts: string[];
}

const cases = fixture as unknown as Case[];

describe('resolveSelfCorrections - correction-markers fixture', () => {
  test('the fixture holds 159 cases', () => {
    expect(cases).toHaveLength(159);
  });

  test.each(cases.map(c => [`${c.src}: ${c.line}`, c] as const))('%s', (_name, c) => {
    const out = resolveSelfCorrections(canonicalizeSegLine(c.line), c.input);
    expect(out.items.map(i => i.rawText)).toEqual(c.expectRawTexts);
  });

  test('the input array and its items are never mutated', () => {
    for (const c of cases) {
      const before = JSON.stringify(c.input);
      const arr = c.input.map(i => ({ ...i }));
      const snapshot = JSON.stringify(arr);
      resolveSelfCorrections(canonicalizeSegLine(c.line), arr);
      expect(JSON.stringify(arr)).toBe(snapshot);
      expect(snapshot).toBe(before);
    }
  });
});
