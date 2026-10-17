/**
 * dish-part-drop - S192 row 4 (seat C69 S202 row 2). Every case of the r5 fixture
 * (fixtures/dish-part-drop-r5.json, a copy of snapshots/s202/row2/r5/expected-r5.json: 240 cases, 106 firing)
 * is run through the shipped function; `src` names where the input came from.
 */

import { dropDishParts } from '../dish-part-drop';
import { canonicalizeSegLine } from '../seg-line-key';
import fixture from './fixtures/dish-part-drop-r5.json';

type It = { rawText: string; normalizedForm?: string; brand?: string };
interface Case {
  src: string;
  line: string;
  input: It[];
  expectRawTexts: string[];
  dropped: string[];
}
const CASES = fixture as Case[];

describe('dropDishParts - r5 fixture', () => {
  test('the fixture is the cut it claims to be: 240 cases, 106 firing', () => {
    expect(CASES).toHaveLength(240);
    expect(CASES.filter(c => c.dropped.length > 0)).toHaveLength(106);
  });

  test.each(CASES.map((c, i) => [`${c.src} #${i}: ${c.line}`, c] as const))('%s', (_name, c) => {
    const r = dropDishParts(canonicalizeSegLine(c.line), c.input);
    expect(r.items.map(x => x.rawText)).toEqual(c.expectRawTexts);
    expect(r.drops.map(d => d.rawText)).toEqual(c.dropped);
  });
});

describe('dropDishParts - contract', () => {
  const line = 'a burrito bowl i made with brown rice, black beans, chicken and salsa';
  const mk = (): It[] => ['burrito bowl', 'brown rice', 'black beans', 'chicken', 'salsa'].map(r => ({ rawText: r, normalizedForm: r, brand: '' }));

  test('never mutates its input, and reports ORIGINAL indexes and the dish', () => {
    const input = mk();
    const snapshot = JSON.parse(JSON.stringify(input));
    const r = dropDishParts(canonicalizeSegLine(line), input);
    expect(input).toEqual(snapshot);
    expect(r.items).not.toBe(input);
    expect(r.drops).toEqual([
      { index: 1, rawText: 'brown rice', dish: 'burrito bowl' },
      { index: 2, rawText: 'black beans', dish: 'burrito bowl' },
      { index: 3, rawText: 'chicken', dish: 'burrito bowl' },
      { index: 4, rawText: 'salsa', dish: 'burrito bowl' },
    ]);
  });

  test('fewer than two items: unchanged', () => {
    const one = [mk()[0]];
    const r = dropDishParts(canonicalizeSegLine(line), one);
    expect(r.items).toEqual(one);
    expect(r.drops).toEqual([]);
    expect(dropDishParts(canonicalizeSegLine(line), []).items).toEqual([]);
  });

  test('a line with no trigger: unchanged', () => {
    const input = mk();
    const r = dropDishParts('a burrito bowl, brown rice, black beans, chicken and salsa', input);
    expect(r.items).toEqual(input);
    expect(r.drops).toEqual([]);
  });
});
