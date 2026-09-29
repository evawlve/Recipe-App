/**
 * A spoken fraction of a measure: normalizeFractionalMeasure() in ingredient-line.ts.
 *
 * "half a cup of rice", "a half cup of egg whites" and "one half cup of milk" lost
 * their unit: parseQuantityTokens() read `half`, and the stray article (or the
 * leading `a`/`one`) then hid the unit, so the name "a cup of milk" reached the
 * cache key and resolved a different record (a 50 g Milk; Cream (Half & Half) for
 * the egg whites). Each spoken form must now parse EXACTLY as its numeric form.
 *
 * Census at the fix (Lane A S61, 8,312 distinct MappingEventLog raw lines): 19
 * lines move, all of them these shapes, and nothing else does.
 * Owner: mobile sync-docs/reports/2026-09-28_lane-a-s61-half-a-cup-reads-its-unit.md, ROW 2.
 */

import { parseIngredientLine } from '../ingredient-line';

function parsed(line: string) {
  const p = parseIngredientLine(line);
  expect(p).not.toBeNull();
  return { qty: p!.qty, unit: p!.unit ?? null, name: p!.name };
}

describe('spoken fraction + measure parses as its numeric form', () => {
  test.each([
    ['half a cup of rice', '1/2 cup of rice'],
    ['half a cup of milk', '1/2 cup of milk'],
    ['half a cup of egg whites', '1/2 cup of egg whites'],
    ['a half cup of egg whites', '1/2 cup of egg whites'],
    ['one half cup of milk', '1/2 cup of milk'],
    ['a half a cup of yogurt', '1/2 cup of yogurt'],
    ['a quarter cup of mushrooms', '1/4 cup of mushrooms'],
    ['half a tablespoon of butter', '1/2 tablespoon of butter'],
    ['half a scoop of rice', '1/2 scoop of rice'],
    ['half an ounce of cheese', '1/2 ounce of cheese'],
    ['maybe half a cup of rice', '1/2 cup of rice'],
    // dictation capitalises the first word; wordFractions is case-sensitive
    ['Half a cup of raw spinach', '1/2 cup of raw spinach'],
    ['Half a serving of panda express chow mein', '1/2 serving of panda express chow mein'],
  ])('%s  ==  %s', (spoken, numeric) => {
    expect(parsed(spoken)).toEqual(parsed(numeric));
  });
});

describe('controls: a size word or a non-measure after the article is untouched', () => {
  test.each([
    ['half a banana', { qty: 0.5, unit: null, name: 'a banana' }],
    ['half an avocado', { qty: 0.5, unit: null, name: 'an avocado' }],
    ['half a medium onion', { qty: 0.5, unit: null, name: 'a onion' }],
    ['half a bagel', { qty: 0.5, unit: null, name: 'a bagel' }],
    ['a third of a large pizza', { qty: 1, unit: null, name: 'a third of a pizza' }],
  ])('%s', (line, expected) => {
    expect(parsed(line)).toEqual(expected);
  });

  test('"a cup and a half" is the same-unit continuation, not this rule', () => {
    expect(parsed('a cup and a half of teriyaki chicken')).toEqual({ qty: 1.5, unit: 'cup', name: 'teriyaki chicken' });
  });

  // Values identical to master (21203f56): `and` is not a measure, so the rule
  // never fires. (Bare "half and half" -> 0.5 "and half" is a pre-existing shape
  // this rule does not own.)
  test.each([
    ['a half and half creamer', { qty: 1, unit: null, name: 'a half and half creamer' }],
    ['one half and half', { qty: 1, unit: null, name: 'and half' }],
    ['a quarter pounder with cheese', { qty: 1, unit: null, name: 'a quarter pounder with cheese' }],
  ])('%s is unchanged from master', (line, expected) => {
    expect(parsed(line)).toEqual(expected);
  });

  test('"half a pound of ground beef" reads the mass unit', () => {
    expect(parsed('half a pound of ground beef')).toEqual({ qty: 0.5, unit: 'lb', name: 'ground beef' });
  });
});
