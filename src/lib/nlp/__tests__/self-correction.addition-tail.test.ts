/**
 * self-correction addition tail - S240 cloud-36 C4 + C5. A later comma piece that is a pure addition tail
 * (`a turkey sandwich, actually a ham sandwich, too`) and a span-less j's tail read from its matched prefix
 * (`..., sorry, a ham sandwhich too`) make j an addition, so the corrected-away item is kept. Every case of
 * fixtures/self-correction-addition-tail.json (a copy of snapshots/s240/rowC4/fixture.json: 67 cases, 14 changed)
 * runs through the shipped function.
 */

import { resolveSelfCorrections } from '../self-correction';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/self-correction-addition-tail.json';

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

describe('resolveSelfCorrections - addition-tail fixture', () => {
  test('the fixture is the cut it claims to be: 67 cases, 14 changed', () => {
    expect(CASES).toHaveLength(67);
    expect(CASES.filter(c => c.changed === true)).toHaveLength(14);
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
