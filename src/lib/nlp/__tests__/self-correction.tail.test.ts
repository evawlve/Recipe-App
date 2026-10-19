/**
 * self-correction.tail.test.ts - every fixture case of the S240 self-correction tail row (seat C69, cloud-36 C10):
 * `more or less`, `extra large` and `plus <item>` in a correction's tail are not additions.
 * The fixture is the seat-read expectation: 56 cases (the refuter's attack set), 10 changed vs the base pass.
 */

import { resolveSelfCorrections } from '../self-correction';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/self-correction-tail.json';

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

describe('resolveSelfCorrections - correction-tail fixture', () => {
  test('the fixture holds 56 cases', () => {
    expect(cases).toHaveLength(56);
  });

  test.each(cases.map(c => [`${c.src}: ${c.line}`, c] as const))('%s', (_name, c) => {
    const out = resolveSelfCorrections(canonicalizeSegLine(c.line), c.input);
    expect(out.items.map(i => i.rawText)).toEqual(c.expectRawTexts);
  });

  test('the input array and its items are never mutated', () => {
    for (const c of cases) {
      const arr = c.input.map(i => ({ ...i }));
      const snapshot = JSON.stringify(arr);
      resolveSelfCorrections(canonicalizeSegLine(c.line), arr);
      expect(JSON.stringify(arr)).toBe(snapshot);
    }
  });
});
