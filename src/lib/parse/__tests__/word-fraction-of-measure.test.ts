/**
 * s459 QTY-34: a spoken fraction with its own numerator (or a bare fraction word) before a measure --
 * rewriteWordFractionOfMeasure() in ingredient-line.ts.
 *
 * `three quarters of a cup of blueberries` parsed as qty 3 of the unknown unit `quarters` (three berries: 4.5 g, MEL
 * noCache=false 2026-10-18), `a third of a pound of ground beef` kept the whole line as its name, and the Spanish
 * `tres cuartos de taza de leche` read the count 3 of `cuartos de taza de leche` (750 g cold, live build 2026-11-16).
 * Each form must now parse EXACTLY as its digit twin, on every parse field, and the food names that open with a
 * fraction word (`quarter pounder`, `cuarto de libra`, `un cuarto de pollo`, `third street`) must not move.
 * Measurement: s459 pd-qty34 (7 organic members, 51 twins, 55 adversarial lines, the parse replay), carried in the PR body.
 */

import { parseIngredientLine } from '../ingredient-line';

const KEYS = ['qty', 'multiplier', 'unit', 'rawUnit', 'name', 'unitHint', 'qualifiers'] as const;
function core(line: string) {
  const r: any = parseIngredientLine(line);
  expect(r).not.toBeNull();
  return Object.fromEntries(KEYS.map((k) => [k, r[k] ?? null]));
}

describe('a spoken fraction before a measure parses as its digit twin', () => {
  test.each([
    // the organic members (MEL noCache=false)
    ['three quarters of a cup of blueberries', '3/4 cup of blueberries'],
    ['three quarters of a pound of chicken thighs', '3/4 pound of chicken thighs'],
    ['two-thirds cup of greek yogurt', '2/3 cup of greek yogurt'],
    ['a third of a pound of ground beef', '1/3 pound of ground beef'],
    ['a third of a pound of ground turkey', '1/3 pound of ground turkey'],
    ['a third of a serving of chow mein', '1/3 serving of chow mein'],
    ['a third of a serving of panda express kung pao chicken', '1/3 serving of panda express kung pao chicken'],
    // the shape family
    ['two thirds of a cup of rice', '2/3 cup of rice'],
    ['three fourths of a cup of milk', '3/4 cup of milk'],
    ['two quarters of a cup of milk', '2/4 cup of milk'],
    ['one third of a cup of rice', '1/3 cup of rice'],
    ['a quarter of a cup of oats', '1/4 cup of oats'],
    ['quarter of a cup of milk', '1/4 cup of milk'],
    ['half of a cup of rice', '1/2 cup of rice'],
    ['a half of a gallon of milk', '1/2 gallon of milk'],
    ['three quarters of an ounce of almonds', '3/4 ounce of almonds'],
    ['three quarters of a tablespoon of honey', '3/4 tablespoon of honey'],
    ['a quarter of a can of tuna', '1/4 can of tuna'],
    ['half of a stick of butter', '1/2 stick of butter'],
    ['three quarters cup of blueberries', '3/4 cup of blueberries'],
    ['two thirds cup of milk', '2/3 cup of milk'],
    ['three-quarters cup of oats', '3/4 cup of oats'],
    ['one-third cup of milk', '1/3 cup of milk'],
    ['three-fourths of a cup of milk', '3/4 cup of milk'],
    ['Three quarters of a cup of blueberries', '3/4 cup of blueberries'],
    ['about three quarters of a cup of milk', 'about 3/4 cup of milk'],
    ['maybe a third of a cup of rice', 'maybe 1/3 cup of rice'],
    ['three quarters of a cup of half and half', '3/4 cup of half and half'],
    // dictation drops the plural; singular and plural are not policed
    ['three quarter of a cup of milk', '3/4 cup of milk'],
    ['three quarter cup of milk', '3/4 cup of milk'],
    // Spanish: `de` + a SPANISH_UNIT_TOKENS word + `de` + the food
    ['tres cuartos de taza de leche', '3/4 taza de leche'],
    ['un cuarto de taza de avena', '1/4 taza de avena'],
    ['cuarto de taza de avena', '1/4 taza de avena'],
    ['un tercio de taza de arroz', '1/3 taza de arroz'],
    ['dos tercios de taza de arroz', '2/3 taza de arroz'],
    ['un cuarto de cucharadita de sal', '1/4 cucharadita de sal'],
    ['un tercio de lata de atun', '1/3 lata de atun'],
    ['tres cuarto de taza de leche', '3/4 taza de leche'],
    ['two halves of a cup of milk', '2/2 cup of milk'],
  ])('%s  ==  %s', (spoken, twin) => {
    expect(core(spoken)).toEqual(core(twin));
  });

  test('the measured line bills three quarters of a cup, not three berries', () => {
    expect(core('three quarters of a cup of blueberries')).toMatchObject({ qty: 0.75, multiplier: 1, unit: 'cup', name: 'blueberries' });
  });
});

describe('food names that open with a fraction word do not move', () => {
  // Each line keeps the parse it had before this rule; the fields pinned are the ones the rule would change.
  test.each<[string, string]>([
    ['quarter pounder with cheese', 'quarter pounder with cheese'],   // s461 QP-LEAD (fraction-word-name.test.ts)
    ['a quarter pounder with cheese', 'a quarter pounder with cheese'],
    ['double quarter pounder with cheese', 'double quarter pounder with cheese'],
    ['mcdonalds quarter pounder', 'mcdonalds quarter pounder'],
    ['quarter-pounder with cheese', 'quarter-pounder with cheese'],
    ['a quarter of a quarter pounder', 'a quarter of a quarter pounder'],
    ['third street bagel', 'third street bagel'],   // s461 QP-LEAD
    ['chicken quarters', 'chicken quarters'],
    ['quarters of an orange', 'quarters of an orange'],
    ['cuarto de libra', 'cuarto de libra'],
    ['cuarto de libra con queso', 'cuarto de libra con queso'],
    ['un cuarto de libra con queso', 'un cuarto de libra con queso'],
    ['un cuarto de pollo', 'un cuarto de pollo'],
    ['un cuarto de pollo del rancho', 'un cuarto de pollo del rancho'],
    ['un cuarto de taza con queso', 'un cuarto de taza con queso'],
    ['cuartos de pollo', 'cuartos de pollo'],
    ['half and half', 'half and half'],
  ])('%s keeps the name %s', (line, name) => {
    expect(core(line)).toMatchObject({ unit: null, name });
  });
});

describe('a bare fraction word before a bare measure is not rewritten (ordinals)', () => {
  // `fourth slice of pizza` is "my fourth slice" far more often than a quarter of one (cold, deploy 42: 74 g today; a rewrite
  // would bill 1/4 slice, 25 g). A numerator (`a fourth cup`, `three fourths cup`) or `of a` still rewrites.
  test.each(['fourth slice of pizza', 'fourth serving of pasta', 'fourth bowl of cereal', 'fourth piece of chicken'])('%s', (line) => {
    expect(core(line)).toMatchObject({ qty: 1, multiplier: 1, unit: null });
  });
  test('a numerator or `of a` still rewrites', () => {
    expect(core('a fourth cup of sugar')).toEqual(core('1/4 cup of sugar'));
    expect(core('fourth of a cup of sugar')).toEqual(core('1/4 cup of sugar'));
  });
});

describe('KNOWN GAP, not this row: a fraction of a FOOD keeps its parse', () => {
  // The rule needs a measure after `of a`; `three quarters of a banana` still reads 3 of the unknown unit `quarters`.
  test.each<[string, number, string | null, string]>([
    ['three quarters of a banana', 3, 'quarters', 'a banana'],
    ['three quarters of a medium banana', 3, 'quarters', 'a banana'],
    ['a quarter of a pizza', 1, null, 'a quarter of a pizza'],
    ['a third of a large pizza', 1, null, 'a third of a pizza'],
    ['two halves of a bagel', 2, 'halves', 'a bagel'],
  ])('%s', (line, qty, unit, name) => {
    expect(core(line)).toMatchObject({ qty, unit, name });
  });
});
