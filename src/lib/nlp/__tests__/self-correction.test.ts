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

describe('resolveSelfCorrections - no i mean / correction markers', () => {
  const nf = (r: string) => r.replace(/^(a|an|two|three)\s+/, '');
  const run = (line: string, raws: string[]) =>
    resolveSelfCorrections(canonicalizeSegLine(line), raws.map(r => ({ rawText: r, normalizedForm: nf(r) }))).items.map(
      x => x.rawText,
    );

  test.each([
    ['a pound of pasta, no i mean a cup of pasta', ['a pound of pasta', 'a cup of pasta'], ['1 cup of pasta']],
    ['a cup of rice, correction, a cup and a half', ['a cup of rice', 'a cup and a half'], ['1.5 cup of rice']],
    ['two eggs, no i mean three eggs', ['two eggs', 'three eggs'], ['3 eggs']],
    ['three tacos, oh wait i mean two tacos', ['three tacos', 'two tacos'], ['2 tacos']],
    ['a latte, correction, a large latte', ['a latte', 'a large latte'], ['a large latte']],
    ['a smoothie, correction, two smoothies', ['a smoothie', 'two smoothies'], ['2 smoothie']],
  ])('corrects: %s', (line, raws, want) => {
    expect(run(line, raws)).toEqual(want);
  });

  test.each([
    ['a coffee, oh wait, also a muffin', ['a coffee', 'also a muffin']],
    ['a coffee, oh wait, also a muffin', ['a coffee', 'a muffin']],
    ['a burger, oh wait and fries', ['a burger', 'fries']],
    ['eggs, oh wait, i forgot the toast', ['eggs', 'toast']],
    ['oatmeal, i meant to say with berries', ['oatmeal', 'berries']],
    ['a salad, correction: plus a soda', ['a salad', 'a soda']],
    ['two eggs, correction, and toast', ['two eggs', 'toast']],
    ['a sandwich, oh wait i mean a wrap', ['a sandwich', 'a wrap']],
    ['pizza, i meant pasta', ['pizza', 'pasta']],
    ['i had two eggs, no i mean toast and eggs', ['two eggs', 'toast and eggs']],
  ])('unchanged: %s', (line, raws) => {
    expect(run(line, raws)).toEqual(raws);
  });
});
