/**
 * segmenter-echo-drop - S240 cloud-38 D9. An echo cannot borrow its span from inside a later item
 * (`coffee with milk, wait no, oat milk` keeps `oat milk`, drops the echo `milk`). Every case of the fixture
 * (fixtures/echo-later-span.json, a copy of snapshots/s240/rowD9/fixture.json: 30 cases, 10 changed) runs
 * through the shipped function.
 */

import { dropSegmenterEchoes } from '../segmenter-echo-drop';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/echo-later-span.json';

type It = { rawText: string; normalizedForm?: string; brand?: string };
interface Case {
  src: string;
  line: string;
  input: It[];
  expectRawTexts: string[];
  echoes: string[];
  changed: boolean;
}
const CASES = fixture as Case[];

describe('dropSegmenterEchoes - later-span fixture', () => {
  test('the fixture is the cut it claims to be: 30 cases, 10 changed', () => {
    expect(CASES).toHaveLength(30);
    expect(CASES.filter(c => c.changed)).toHaveLength(10);
  });

  test.each(CASES.map(c => [`${c.src}: ${c.line}`, c] as const))('%s', (_name, c) => {
    const r = dropSegmenterEchoes(canonicalizeSegLine(c.line), c.input);
    expect(r.items.map(i => i.rawText)).toEqual(c.expectRawTexts);
    expect(r.echoes.map(e => e.rawText)).toEqual(c.echoes);
  });

  test('never mutates its input', () => {
    for (const c of CASES) {
      const snapshot = JSON.parse(JSON.stringify(c.input));
      dropSegmenterEchoes(canonicalizeSegLine(c.line), c.input);
      expect(c.input).toEqual(snapshot);
    }
  });
});
