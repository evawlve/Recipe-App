/**
 * segmenter-echo-drop - S202 (30)(i) (seat C69 S240). Every case of fixtures/segmenter-echo-drop.json (a copy of
 * snapshots/s240/row1-echo/fixture-echo.json: 24 cases, 6 drop) is run through the shipped function.
 */

import { dropSegmenterEchoes } from '../segmenter-echo-drop';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/segmenter-echo-drop.json';

type It = { rawText: string; normalizedForm?: string; brand?: string };
interface Case {
  src: string;
  line: string;
  input: It[];
  expectRawTexts: string[];
}
const CASES = fixture as Case[];

describe('dropSegmenterEchoes - fixture', () => {
  test('the fixture is the cut it claims to be: 24 cases, 6 dropping', () => {
    expect(CASES).toHaveLength(24);
    expect(CASES.filter(c => c.expectRawTexts.length < c.input.length)).toHaveLength(6);
  });

  test.each(CASES.map(c => [`${c.src}: ${c.line}`, c] as const))('%s', (_name, c) => {
    const r = dropSegmenterEchoes(canonicalizeSegLine(c.line), c.input);
    expect(r.items.map(i => i.rawText)).toEqual(c.expectRawTexts);
  });
});

describe('dropSegmenterEchoes - contract', () => {
  const kraft = CASES.find(c => c.line === 'kraft mayo with olive oil') as Case;

  test('the kraft case reports the echo with its original index and host', () => {
    const r = dropSegmenterEchoes(canonicalizeSegLine(kraft.line), kraft.input);
    expect(r.echoes).toEqual([{ index: 1, rawText: 'olive oil', host: 'kraft mayo with olive oil' }]);
  });

  test('the input is never mutated', () => {
    for (const c of CASES) {
      const before = structuredClone(c.input);
      dropSegmenterEchoes(canonicalizeSegLine(c.line), c.input);
      expect(c.input).toEqual(before);
    }
  });

  test('survivors are the same object references', () => {
    for (const c of CASES) {
      const r = dropSegmenterEchoes(canonicalizeSegLine(c.line), c.input);
      r.items.forEach(it => expect(c.input.includes(it)).toBe(true));
    }
    const r = dropSegmenterEchoes(canonicalizeSegLine(kraft.line), kraft.input);
    expect(r.items[0]).toBe(kraft.input[0]);
  });
});
