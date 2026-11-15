/**
 * s459 AL-b: `shot` / `jigger` are COUNT units in normalizeUnitToken() (unit.ts).
 *
 * Before: `a shot of tequila` kept its article (leadingArticlePrecedesUnit() only fires on a known unit) and parsed as
 * qty 1, unit null, name "a shot of tequila"; the digit line `1 shot of gin` already read unit `shot` through the
 * unknown-unit partitive path (gated on an explicit quantity). Each target must now parse EXACTLY (deep-equal, whole
 * ParsedIngredient) as its digit twin. The controls pin master's output at 7b7dbf60 (parse/ unchanged through 4404e17d), read off master before the edit:
 * a trailing `shot` (`espresso shot`, `a jello shot`, `a flu shot`) and `double`/`triple`/`extra` before it
 * stay untouched (rewriteDoublePortion()'s PORTION_NOUNS still has no `shot`).
 */

import { parseIngredientLine } from '../ingredient-line';
import { normalizeUnitToken } from '../unit';

const TARGETS: Array<[string, string]> = [
  ['a shot of tequila', '1 shot of tequila'],
  ['a shot of espresso', '1 shot of espresso'],
  ['a shot of cinnamon whiskey', '1 shot of cinnamon whiskey'],
  ['A shot of mezcal', '1 shot of mezcal'],
  ['about a shot of whiskey', 'about 1 shot of whiskey'],
  ['shot of espresso', '1 shot of espresso'],
  ['a jigger of gin', '1 jigger of gin'],
  ['a half shot of espresso', '0.5 shot of espresso'],
  ['half a shot of vodka', '0.5 shot of vodka'],
];

describe('shot / jigger as count units', () => {
  it.each(TARGETS)('%s parses exactly as %s', (line, twin) => {
    const t = parseIngredientLine(twin);
    expect(t).not.toBeNull();
    expect(t!.unit === 'shot' || t!.unit === 'jigger').toBe(true);
    expect(parseIngredientLine(line)).toEqual(t);
  });

  it('the unit token normalizes, singular and plural', () => {
    expect(normalizeUnitToken('shot')).toEqual({ kind: 'count', unit: 'shot' });
    expect(normalizeUnitToken('Shots')).toEqual({ kind: 'count', unit: 'shot' });
    expect(normalizeUnitToken('jiggers')).toEqual({ kind: 'count', unit: 'jigger' });
    expect(normalizeUnitToken('double')).toEqual({ kind: 'unknown', raw: 'double' });
  });

  it('a digit line keeps its quantity and now reads the singular unit', () => {
    const p = parseIngredientLine('two shots of vodka');
    expect(p).toMatchObject({ qty: 2, multiplier: 1, unit: 'shot', name: 'vodka' });
    expect(parseIngredientLine('2 shots whiskey')).toMatchObject({ qty: 2, unit: 'shot', name: 'whiskey' });
  });
});

const CONTROLS: Array<[string, unknown]> = [
  ["a double shot of espresso",{"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"a double shot of espresso","notes":null,"unitHint":null}],
  ["a triple shot of espresso",{"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"a triple shot of espresso","notes":null,"unitHint":null}],
  ["a double shot latte",{"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"a double shot latte","notes":null,"unitHint":null}],
  ["an extra shot",{"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"an extra shot","notes":null,"unitHint":null}],
  ["an extra shot of espresso",{"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"an extra shot of espresso","notes":null,"unitHint":null}],
  ["espresso shot",{"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"espresso shot","notes":null,"unitHint":null}],
  ["tequila shot",{"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"tequila shot","notes":null,"unitHint":null}],
  ["a jello shot",{"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"a jello shot","notes":null,"unitHint":null}],
  ["a wheatgrass shot",{"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"a wheatgrass shot","notes":null,"unitHint":null}],
  ["a ginger shot",{"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"a ginger shot","notes":null,"unitHint":null}],
  ["a b12 shot",{"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"a b12 shot","notes":null,"unitHint":null}],
  ["a flu shot",{"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"a flu shot","notes":null,"unitHint":null}],
  ["starbucks doubleshot espresso",{"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"starbucks doubleshot espresso","notes":null,"unitHint":null}],
  ["starbucks triple shot energy",{"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"starbucks triple shot energy","notes":null,"unitHint":null}],
  ["5 hour energy shot",{"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"5 hour energy shot","notes":null,"unitHint":null}],
  ["a latte with an extra shot",{"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"a latte with an extra shot","notes":null,"unitHint":null}],
  ["jello shots",{"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"jello shots","notes":null,"unitHint":null}],
  ["2 jello shots",{"qty":2,"multiplier":1,"unit":null,"rawUnit":null,"name":"jello shots","notes":null,"unitHint":null}],
  ["2 espresso shots",{"qty":2,"multiplier":1,"unit":null,"rawUnit":null,"name":"espresso shots","notes":null,"unitHint":null}],
  ["a 2 shot latte",{"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"a 2 shot latte","notes":null,"unitHint":null}],
  ["latte with 2 shots",{"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"latte with 2 shots","notes":null,"unitHint":null}],
  ["a protein shot",{"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"a protein shot","notes":null,"unitHint":null}],
  ["an energy shot",{"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"an energy shot","notes":null,"unitHint":null}],
];

describe('shot as part of a product name is untouched (master output pinned)', () => {
  it.each(CONTROLS)('%s', (line, expected) => {
    expect(parseIngredientLine(line)).toEqual(expected);
  });
});

// Spanish article lines stay untouched: `un`/`una` are not leading articles here, and `shot` is deliberately NOT in
// SPANISH_UNIT_TOKENS (that set also feeds spanish-detect.ts's markers, so adding an English word would mark English lines).
const SPANISH_CONTROLS: Array<[string, unknown]> = [
  ["un shot de tequila",{"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"un shot de tequila","notes":null,"unitHint":null}],
  ["un caballito de tequila",{"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"un caballito de tequila","notes":null,"unitHint":null}],
];

describe('Spanish article lines are untouched (master output pinned)', () => {
  it.each(SPANISH_CONTROLS)('%s', (line, expected) => {
    expect(parseIngredientLine(line)).toEqual(expected);
  });
});
