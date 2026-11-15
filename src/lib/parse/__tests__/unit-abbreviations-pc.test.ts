/**
 * s459 QW: `pc` / `pcs` after an explicit count is the `piece` unit, exactly as its spelled-out twin.
 * Acceptance is TWIN EQUIVALENCE (see unit-abbreviations.test.ts), not the grams the twin serves.
 */
import { parseIngredientLine } from '../ingredient-line';

const pick = (line: string) => {
  const p = parseIngredientLine(line);
  return p && { qty: p.qty, multiplier: p.multiplier, unit: p.unit, rawUnit: p.rawUnit, name: p.name, unitHint: p.unitHint };
};
const core = (line: string) => {
  const p = pick(line);
  return p && { qty: p.qty, unit: p.unit, name: p.name };
};

describe('`N pc|pcs <food>` parses as `N piece <food>`', () => {
  const twins: Array<[string, string, { qty: number; unit: string; name: string }]> = [
    ['10 pc chicken mcnuggets', '10 piece chicken mcnuggets', { qty: 10, unit: 'piece', name: 'chicken mcnuggets' }],
    ['3 pcs fried chicken', '3 piece fried chicken', { qty: 3, unit: 'piece', name: 'fried chicken' }],
    ['8pc wings', '8 piece wings', { qty: 8, unit: 'piece', name: 'wings' }],
    ['6 PC nuggets', '6 piece nuggets', { qty: 6, unit: 'piece', name: 'nuggets' }],
    ['4 pc. chicken tenders', '4 piece chicken tenders', { qty: 4, unit: 'piece', name: 'chicken tenders' }],
    ['20 pcs. sushi', '20 pieces sushi', { qty: 20, unit: 'piece', name: 'sushi' }],
    ['about 10 pc nuggets', 'about 10 piece nuggets', { qty: 10, unit: 'piece', name: 'nuggets' }],
    ['two pc chicken', 'two piece chicken', { qty: 2, unit: 'piece', name: 'chicken' }],
  ];
  test.each(twins)('%s', (abbrev, twin, expected) => {
    expect(core(abbrev)).toEqual(core(twin));
    expect(core(abbrev)).toMatchObject(expected);
  });
});

describe('controls: no explicit count, no follower, or not at the unit slot', () => {
  const unchanged: Array<[string, { qty: number; unit: string | null; name: string }]> = [
    ['popeys 3 pc tenders spicy', { qty: 1, unit: null, name: 'popeys 3 pc tenders spicy' }],
    ['chicken nuggets 10 pc', { qty: 1, unit: null, name: 'chicken nuggets 10 pc' }],
    ['10 pc', { qty: 10, unit: null, name: 'pc' }],
    ['pc chicken burger', { qty: 1, unit: null, name: 'pc chicken burger' }],
  ];
  test.each(unchanged)('%s', (line, expected) => {
    expect(core(line)).toEqual(expected);
  });
});

describe('the quantity words the s459 battery flagged already parse (pins, no change)', () => {
  test.each([
    ['a couple tablespoons of ranch', { qty: 2, unit: 'tbsp', name: 'ranch' }],
    ['a couple of slices of bacon', { qty: 2, unit: 'slice', name: 'bacon' }],
    ['couple cookies', { qty: 2, unit: null, name: 'cookies' }],
    ['half a cantaloupe', { qty: 0.5, unit: null, name: 'a cantaloupe' }],
    ['half of a sandwich', { qty: 0.5, unit: null, name: 'of a sandwich' }],
  ])('%s', (line, expected) => {
    expect(core(line)).toEqual(expected);
  });
});
