/**
 * s459 AL-b2: two shapes #688 (`shot` / `jigger` as count units in normalizeUnitToken()) read wrong, fixed in
 * ingredient-line.ts:
 *  (1) countIsShotModifier(): an integer count >= 2, a SINGULAR `shot`, then a word that is not `of` is ONE drink of
 *      that size (`2 shot latte` = a 2-shot latte). The count is not consumed: qty 1, the count stays in the name, as
 *      the article twin `a 2 shot latte` already parsed. #688 read 2 shots (60 g) of latte.
 *  (2) rewriteShotGlassOf(): `shot glass(es) of X` collapses to its twin `shot(s) of X`.
 * The controls pin master's output at 171c5172 (deploy 38), read off master before the edit. The 8 organic lines #688
 * fixed (`a shot of tequila` etc.) are pinned to their digit twins in shot-unit.test.ts, which this change leaves green.
 */

import { parseIngredientLine } from '../ingredient-line';

const one = (name: string) =>
  ({ qty: 1, multiplier: 1, unit: null, rawUnit: null, name, notes: null, unitHint: null });

describe('(1) N shot <drink> is one drink of that size', () => {
  it.each([
    ['2 shot latte', '2 shot latte'],
    ['3 shot americano', '3 shot americano'],
    ['two shot latte', 'two shot latte'],
    ['4 shot venti latte', '4 shot venti latte'],
    ['2 shot latte with oat milk', '2 shot latte with oat milk'],
    ['2 shot vodka', '2 shot vodka'], // KNOWN COST (0 organic): the sloppy singular reads one drink
  ])('%s', (line, name) => {
    expect(parseIngredientLine(line)).toEqual(one(name));
  });

  it.each([
    ['2shot latte', '2 shot latte'],
    ['about 2 shot latte', '2 shot latte'],
  ])('%s parses exactly as %s', (line, twin) => {
    expect(parseIngredientLine(line)).toEqual(parseIngredientLine(twin));
  });
});

describe('(2) a shot glass of X is a shot of X', () => {
  it.each([
    ['a shot glass of whiskey', 'a shot of whiskey'],
    ['1 shot glass of vodka', '1 shot of vodka'],
    ['2 shot glasses of tequila', '2 shots of tequila'],
  ])('%s parses exactly as %s', (line, twin) => {
    const t = parseIngredientLine(twin);
    expect(t).toMatchObject({ unit: 'shot' });
    expect(parseIngredientLine(line)).toEqual(t);
  });
});

const CONTROLS: Array<[string, unknown]> = [
  ['2 shots vodka', { qty: 2, multiplier: 1, unit: 'shot', rawUnit: 'shots', name: 'vodka', notes: null, unitHint: null }],
  ['2 shot of vodka', { qty: 2, multiplier: 1, unit: 'shot', rawUnit: 'shot', name: 'vodka', notes: null, unitHint: null }],
  ['2 shots of vodka', { qty: 2, multiplier: 1, unit: 'shot', rawUnit: 'shots', name: 'vodka', notes: null, unitHint: null }],
  ['2 shot', { qty: 2, multiplier: 1, unit: 'shot', rawUnit: 'shot', name: 'shot', notes: null, unitHint: null }],
  ['1 shot gin', { qty: 1, multiplier: 1, unit: 'shot', rawUnit: 'shot', name: 'gin', notes: null, unitHint: null }],
  ['1.5 shot vodka', { qty: 1.5, multiplier: 1, unit: 'shot', rawUnit: 'shot', name: 'vodka', notes: null, unitHint: null }],
  ['2-3 shot latte', { qty: 2.5, multiplier: 1, unit: 'shot', rawUnit: 'shot', name: 'latte', notes: null, unitHint: null }],
  ['2 jigger gin', { qty: 2, multiplier: 1, unit: 'jigger', rawUnit: 'jigger', name: 'gin', notes: null, unitHint: null }],
  ['a 2 shot latte', one('a 2 shot latte')],
  ['latte with 2 shots', one('latte with 2 shots')],
  ['a double shot latte', one('a double shot latte')],
  ['whiskey in a shot glass', one('whiskey in a shot glass')],
  // KNOWN COST (0 organic): a bare shot glass still reads unit `shot`, name `glass`.
  ['shot glass', { qty: 1, multiplier: 1, unit: 'shot', rawUnit: 'shot', name: 'glass', notes: null, unitHint: null }],
  ['a shot glass', { qty: 1, multiplier: 1, unit: 'shot', rawUnit: 'shot', name: 'glass', notes: null, unitHint: null }],
  ['a shot glass full of vodka', { qty: 1, multiplier: 1, unit: 'shot', rawUnit: 'shot', name: 'glass full of vodka', notes: null, unitHint: null }],
  // A partitive or the vessel after `shot` keeps the measure (SHOT_NOT_MODIFIED); the Spanish `de` row owns the name.
  ['2 shot de tequila', { qty: 2, multiplier: 1, unit: 'shot', rawUnit: 'shot', name: 'de tequila', notes: null, unitHint: null }],
  ['dos shot de tequila', { qty: 2, multiplier: 1, unit: 'shot', rawUnit: 'shot', name: 'de tequila', notes: null, unitHint: null }],
  ['2 shot glasses', { qty: 2, multiplier: 1, unit: 'shot', rawUnit: 'shot', name: 'glasses', notes: null, unitHint: null }],
  ['2 shot glasses tequila', { qty: 2, multiplier: 1, unit: 'shot', rawUnit: 'shot', name: 'glasses tequila', notes: null, unitHint: null }],
];

// KNOWN COSTS (0 organic): resolveCountTag() (count-tag.ts) rewrites the line BEFORE the guard, so the drink-size count is
// read as a count it is not: `2x shot latte` loses its `x`, and a trailing tag multiplies the SIZE (`2 shot latte x2` -> one
// `4 shot latte`, not two 2-shot lattes). Pinned so a count-tag change that fixes them shows up here.
describe('count-tag interactions (known costs, pinned)', () => {
  it.each([
    ['2x shot latte', one('2 shot latte')],
    ['2 shot latte x2', one('4 shot latte')],
  ])('%s', (line, expected) => {
    expect(parseIngredientLine(line)).toEqual(expected);
  });
});

describe('the pour keeps its unit (master output at 171c5172 pinned)', () => {
  it.each(CONTROLS)('%s', (line, expected) => {
    expect(parseIngredientLine(line)).toEqual(expected);
  });
});
