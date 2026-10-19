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
  test('the fixture is the cut it claims to be: 240 cases, 107 firing', () => {
    expect(CASES).toHaveLength(240);
    expect(CASES.filter(c => c.dropped.length > 0)).toHaveLength(107);
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

describe('a new clause ends the part list (S202 cloud-35 F1)', () => {
  const run = (line: string, raws: string[]) => {
    const items = raws.map(r => ({ rawText: r, normalizedForm: r.replace(/^(a|an|the) /, '') }));
    return dropDishParts(canonicalizeSegLine(line), items).items.map(x => x.rawText);
  };
  const f1Line = 'homemade breakfast burrito with eggs and cheese, then for dinner salmon with spinach';
  const f1Items = ['homemade breakfast burrito', 'eggs', 'cheese', 'salmon', 'spinach'];

  test.each([
    [f1Line, f1Items, ['homemade breakfast burrito', 'salmon', 'spinach']],
    [
      'a homemade burrito with chicken and rice, and later steak with rice and beans',
      ['a homemade burrito', 'chicken', 'rice', 'steak', 'rice', 'beans'],
      ['a homemade burrito', 'steak', 'rice', 'beans'],
    ],
    [
      'a homemade pizza with pepperoni, and for lunch tuna with crackers',
      ['a homemade pizza', 'pepperoni', 'tuna', 'crackers'],
      ['a homemade pizza', 'tuna', 'crackers'],
    ],
    [
      'homemade breakfast burrito with eggs and cheese. then for dinner salmon with spinach',
      f1Items,
      ['homemade breakfast burrito', 'salmon', 'spinach'],
    ],
  ])('restored: %s', (line, raws, want) => {
    expect(run(line, raws)).toEqual(want);
  });

  test.each([
    // F2: a trailing meal tag covers the whole line (Needs Diego), so base behaviour is kept.
    [
      'a homemade pizza with pepperoni, and bacon and eggs for breakfast',
      ['a homemade pizza', 'pepperoni', 'bacon', 'eggs'],
      ['a homemade pizza'],
    ],
    // Words AFTER an item never count.
    [
      'a homemade burrito with eggs, cheese and salsa for breakfast',
      ['a homemade burrito', 'eggs', 'cheese', 'salsa'],
      ['a homemade burrito'],
    ],
    // `had` is not a clause word (refute M1).
    [
      'a homemade burrito with what i had left: rice and beans',
      ['a homemade burrito', 'rice', 'beans'],
      ['a homemade burrito'],
    ],
    // A clause word after from/since/over is provenance, not a new clause.
    [
      'a homemade burrito with chicken from dinner, rice and beans',
      ['a homemade burrito', 'chicken', 'rice', 'beans'],
      ['a homemade burrito'],
    ],
  ])('kept as base: %s', (line, raws, want) => {
    expect(run(line, raws)).toEqual(want);
  });
});
