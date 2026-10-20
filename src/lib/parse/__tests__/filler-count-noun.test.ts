/**
 * C70 cloud-38 D10: a filler adjective (good|full|solid|generous|scant) before a COUNT-NOUN measure is dropped like one before a
 * listed unit. Targets are deep-equal (whole parse) to their plain twin; controls are deep-equal to their master (6aab460f) output,
 * hard-coded. `big` stays out of the adjective set (`a big slice of cake` is a known gap, pinned as-is).
 */

import { parseIngredientLine } from '../ingredient-line';

test('G11 qualifier: `a good slice of cake` parses like `a slice of cake`', () => {
  const twin = parseIngredientLine('a slice of cake')!;
  const p = parseIngredientLine('a good slice of cake')!;
  expect([p.name, p.unit]).toEqual([twin.name, twin.unit]);
});

test.each([
  ['a good slice of cake', 'a slice of cake'],
  ['a generous scoop of ice cream', 'a scoop of ice cream'],
  ['a full bowl of soup', 'a bowl of soup'],
  ['about a good slice of pizza', 'about a slice of pizza'],
])('target `%s` parses exactly like `%s`', (line, twin) => {
  const p = parseIngredientLine(line);
  expect(p).not.toBeNull();
  expect(p).toEqual(parseIngredientLine(twin));
});

const base = { qty: 1, multiplier: 1, notes: null };
test.each([
  ['a good bit of cheese', { ...base, unit: null, rawUnit: null, name: 'a good bit of cheese', unitHint: null }],
  ['a big slice of cake', { ...base, unit: null, rawUnit: null, name: 'a big of cake', unitHint: 'slice' }],
  ['a full english', { ...base, unit: null, rawUnit: null, name: 'a full english', unitHint: null }],
  ['a good pound of pasta', { ...base, unit: 'lb', rawUnit: 'pound', name: 'pasta', unitHint: null }],
  ['a solid gold bar', { ...base, unit: null, rawUnit: null, name: 'a solid gold bar', unitHint: null }],
  ['a good slice', { ...base, unit: null, rawUnit: null, name: 'a good', unitHint: 'slice' }],
])('control `%s` is unchanged from master', (line, expected) => {
  expect(parseIngredientLine(line)).toEqual(expected);
});

test('#537 twin: `a good pound of pasta` still parses like `a pound of pasta`', () => {
  expect(parseIngredientLine('a good pound of pasta')).toEqual(parseIngredientLine('a pound of pasta'));
});
