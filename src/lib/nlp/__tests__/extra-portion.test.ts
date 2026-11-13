/**
 * extra-portion - S240 (seat C69), MGR 17:30Z relay 1. Every case of the fixture (fixtures/extra-portion.json, a copy of
 * snapshots/s240/rowMeat/fixture-extra-portion.json: 62 cases, 40 with rewrites) is run through the shipped function;
 * `src` names where the input came from.
 */

import { rewriteExtraPortions } from '../extra-portion';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/extra-portion.json';

type It = { rawText: string; normalizedForm?: string; brand?: string };
interface Case {
  src: string;
  line: string;
  input: It[];
  expect: Array<{ rawText: string; normalizedForm?: string }>;
  rewrites: number;
}
const CASES = (fixture as { cases: Case[] }).cases;

describe('rewriteExtraPortions - fixture', () => {
  test('the fixture is the cut it claims to be: 62 cases, 40 with rewrites', () => {
    expect(CASES).toHaveLength(62);
    expect(CASES.filter(c => c.rewrites > 0)).toHaveLength(40);
  });

  test.each(CASES.map(c => [`${c.src}: ${c.line}`, c] as const))('%s', (_name, c) => {
    const r = rewriteExtraPortions(canonicalizeSegLine(c.line), c.input);
    expect(r.items.map(i => ({ rawText: i.rawText, normalizedForm: i.normalizedForm }))).toEqual(c.expect);
    expect(r.rewrites.length).toBe(c.rewrites);
  });

  test('the input is never mutated', () => {
    for (const c of CASES) {
      const before = JSON.stringify(c.input);
      rewriteExtraPortions(canonicalizeSegLine(c.line), c.input);
      expect(JSON.stringify(c.input)).toBe(before);
    }
  });

  test('every rewrite keeps rawText unchanged', () => {
    for (const c of CASES) {
      const r = rewriteExtraPortions(canonicalizeSegLine(c.line), c.input);
      expect(r.items.map(i => i.rawText)).toEqual(c.input.map(i => i.rawText));
    }
  });
});
