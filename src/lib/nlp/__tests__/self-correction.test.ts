/**
 * self-correction.test.ts - every fixture case of the S202 row 4 (8d) narrowed cut, r3.
 * The fixture is the refuter-verified expectation: 144 cases (45 corrections, 37 false-positive probes,
 * 62 new splits), 86 of them changed by the pass.
 */

import { resolveSelfCorrections } from '../self-correction';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/self-correction-r3.json';

interface In {
  rawText: string;
  normalizedForm?: string;
  brand?: string;
}
interface Case {
  src: string;
  line: string;
  input: In[];
  expectItems: Array<{ rawText: string; normalizedForm: string | null; brand: string | null }>;
}

const cases = fixture as unknown as Case[];
const shape = (items: In[]) =>
  items.map(i => ({ rawText: i.rawText, normalizedForm: i.normalizedForm ?? null, brand: i.brand || null }));

describe('resolveSelfCorrections - r3 fixture', () => {
  test('the fixture holds 144 cases', () => {
    expect(cases).toHaveLength(144);
  });

  test.each(cases.map(c => [`${c.src}: ${c.line}`, c] as const))('%s', (_name, c) => {
    const out = resolveSelfCorrections(canonicalizeSegLine(c.line), c.input);
    expect(shape(out.items)).toEqual(c.expectItems);
  });

  test('the input array and its items are never mutated', () => {
    for (const c of cases) {
      const before = JSON.stringify(c.input);
      const arr = c.input.map(i => ({ ...i }));
      const frozen = JSON.stringify(arr);
      resolveSelfCorrections(canonicalizeSegLine(c.line), arr);
      expect(JSON.stringify(arr)).toBe(frozen);
      expect(frozen).toBe(before.replace(/\s+$/, ''));
    }
  });

  test('a correction reports its kind and the ORIGINAL index it acted on', () => {
    const items = [
      { rawText: 'four pancakes', normalizedForm: 'pancakes', brand: '' },
      { rawText: 'three pancakes', normalizedForm: 'pancakes', brand: '' },
    ];
    const out = resolveSelfCorrections(canonicalizeSegLine('four pancakes, wait no, three pancakes'), items);
    expect(out.items).toHaveLength(1);
    expect(out.corrections).toHaveLength(1);
    expect(out.corrections[0]).toMatchObject({ index: 0, before: 'four pancakes' });
  });

  test('a line without a correction word comes back equal and reports nothing', () => {
    const items = [{ rawText: 'eggs' }, { rawText: 'toast' }, { rawText: 'a banana' }];
    const out = resolveSelfCorrections(canonicalizeSegLine('eggs and toast, then later a banana'), items);
    expect(out.items).toEqual(items);
    expect(out.corrections).toEqual([]);
  });
});
