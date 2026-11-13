/**
 * self-correction tail hesitation - S240 cloud-40 F1. A later comma piece of hesitation words only (`, um,`) is
 * transparent to the addition tail, so `a turkey sandwich, actually a ham sandwich, um, too` keeps the turkey sandwich.
 * Every case of fixtures/self-correction-tail-hesitation.json (a copy of snapshots/s240/rowF1/fixture.json: 15 cases,
 * 7 changed) runs through the shipped function.
 */

import { resolveSelfCorrections } from '../self-correction';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/self-correction-tail-hesitation.json';

type It = { rawText: string; normalizedForm?: string; brand?: string };
interface Case {
  src: string;
  line: string;
  input: It[];
  expectRawTexts: string[];
  expectKinds: string[];
  changed?: boolean;
}
const CASES = fixture as Case[];

describe('resolveSelfCorrections - tail-hesitation fixture', () => {
  test('the fixture is the cut it claims to be: 15 cases, 7 changed', () => {
    expect(CASES).toHaveLength(15);
    expect(CASES.filter(c => c.changed === true)).toHaveLength(7);
  });

  test.each(CASES.map(c => [`${c.src}: ${c.line}`, c] as const))('%s', (_name, c) => {
    const r = resolveSelfCorrections(canonicalizeSegLine(c.line), c.input);
    expect(r.items.map(i => i.rawText)).toEqual(c.expectRawTexts);
    expect(r.corrections.map(k => k.kind)).toEqual(c.expectKinds);
  });

  test('never mutates its input', () => {
    for (const c of CASES) {
      const snapshot = JSON.parse(JSON.stringify(c.input));
      resolveSelfCorrections(canonicalizeSegLine(c.line), c.input);
      expect(c.input).toEqual(snapshot);
    }
  });
});
