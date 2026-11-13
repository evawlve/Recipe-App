/**
 * self-correction tail lead - S340 (#588 refute-r1 MAJOR 1). A lone addition piece that OPENS the next item
 * (`a turkey sandwich, actually a ham sandwich, also, a coke`) is that item's lead, not the ham sandwich's tail, so the
 * corrected-away turkey sandwich goes. Every case of fixtures/self-correction-tail-lead.json (a copy of
 * snapshots/s340/row1/fixture.json: 19 cases, 4 changed) runs through the shipped function.
 */

import { resolveSelfCorrections } from '../self-correction';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/self-correction-tail-lead.json';

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

describe('resolveSelfCorrections - tail-lead fixture', () => {
  test('the fixture is the cut it claims to be: 19 cases, 4 changed', () => {
    expect(CASES).toHaveLength(19);
    expect(CASES.filter(c => c.changed === true)).toHaveLength(4);
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
