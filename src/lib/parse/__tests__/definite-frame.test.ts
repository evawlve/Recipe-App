/**
 * C70 definite-frame row: a line-start `(the|my|our)? (last|remaining|other|final)` before a COUNT is dropped, so the line parses as
 * its un-framed twin (`the last 2 slices of pizza` used to bill qty 1 / name `the last 2 of pizza` and resolve to another food).
 * Controls are the master outputs, read before the edit and hard-coded.
 */

import { parseIngredientLine } from '../ingredient-line';

describe('definite frame before a count', () => {
  const twins: Array<[string, string]> = [
    ['the last 2 slices of pizza', '2 slices of pizza'],
    ['the remaining 3 cookies', '3 cookies'],
    ['my last two tacos', 'two tacos'],
    ['last 2 cookies', '2 cookies'],
    ['The other 2 eggs', '2 eggs'],
  ];
  it.each(twins)('%s parses like %s', (framed, twin) => {
    const a = parseIngredientLine(framed);
    expect(a).not.toBeNull();
    expect(a).toEqual(parseIngredientLine(twin));
  });

  const unchanged = { qty: 1, multiplier: 1, unit: null, rawUnit: null, notes: null, unitHint: null };
  const controls: Array<[string, string]> = [
    ['the last tradition machacado', 'the last tradition machacado'],
    ['the other half', 'the other half'],
    ['leftover pizza', 'leftover pizza'],
    ["last night's pizza", "last night's pizza"],
    ['the last of the pizza', 'the last of the pizza'],
    ['the last 2', 'the last 2'],
    ['the remaining', 'the remaining'],
  ];
  it.each(controls)('control %s is unchanged', (line, name) => {
    expect(parseIngredientLine(line)).toEqual({ ...unchanged, name });
  });

  it('#537 control: just over a pound of shrimp is unchanged', () => {
    expect(parseIngredientLine('just over a pound of shrimp')).toEqual({
      qty: 1, multiplier: 1, unit: 'lb', rawUnit: 'pound', name: 'shrimp', notes: null, unitHint: null,
    });
  });
});
