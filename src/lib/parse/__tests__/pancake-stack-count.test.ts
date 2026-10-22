/**
 * "a stack of <count> pancakes": rewriteStackOfPancakes() in ingredient-line.ts.
 *
 * A STATED count wins over the stack default: the `(a|one) [size] stack of` prefix is
 * dropped and the count stays. `a stack of three buttermilk pancakes` was pinned as an
 * out-of-scope control by pancake-stack.test.ts (#549); that pin moved here as a target.
 * Each target must parse EXACTLY (deep-equal, whole ParsedIngredient) as its twin.
 */

import { parseIngredientLine } from '../ingredient-line';

const TARGETS: Array<[string, string]> = [
  ['a stack of three buttermilk pancakes', 'three buttermilk pancakes'],
  ['a stack of 4 pancakes', '4 pancakes'],
  ['a short stack of two pancakes', 'two pancakes'],
  ['a full stack of 6 blueberry pancakes', '6 blueberry pancakes'],
];

const UNTOUCHED: Array<[string, unknown]> = [
  ['a stack of three waffles', { qty: 1, multiplier: 1, unit: null, rawUnit: null, name: 'a stack of three waffles', notes: null, unitHint: null }],
  ['a stack of three pancakes with syrup', { qty: 1, multiplier: 1, unit: null, rawUnit: null, name: 'a stack of three pancakes with syrup', notes: null, unitHint: null }],
  ['a stack of papers', { qty: 1, multiplier: 1, unit: null, rawUnit: null, name: 'a stack of papers', notes: null, unitHint: null }],
];

describe('stack of N pancakes keeps the stated count', () => {
  it.each(TARGETS)('%s parses exactly as %s', (line, twin) => {
    const t = parseIngredientLine(twin);
    expect(t).not.toBeNull();
    expect(parseIngredientLine(line)).toEqual(t);
  });

  it('a bare stack is still 3 (#549)', () => {
    expect(parseIngredientLine('a stack of pancakes')).toEqual(parseIngredientLine('3 pancakes'));
  });

  it.each(UNTOUCHED)('%s is untouched (master output)', (line, master) => {
    expect(parseIngredientLine(line)).toEqual(master);
  });
});
