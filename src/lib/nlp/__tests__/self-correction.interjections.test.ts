/**
 * self-correction.interjections.test.ts - every fixture case of the S240 interjection row (seat C69, MGR 17:14Z):
 * er / um / uh / hmm / oops / whoops / nope / okay / ok correct a quantity, never a food.
 * The fixture is the seat-read expectation: 30 cases (draws, negative-control draws, attack lines).
 */

import { resolveSelfCorrections } from '../self-correction';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/self-correction-interjections.json';

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

describe('resolveSelfCorrections - interjections fixture', () => {
  test('the fixture holds 30 cases', () => {
    expect(cases).toHaveLength(30);
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
