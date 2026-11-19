/**
 * s461 DOZEN: rewriteDozenCount() in ingredient-line.ts. `dozen` after a stated quantity multiplies it by 12.
 *
 * parseQuantityTokens() reads `dozen` as 12 only where it opens the line (`a dozen eggs`). After a quantity the word stayed
 * in the name, so `half dozen wings` parsed as 0.5 of `dozen wings`, `1 doz eggs` as 1 of `doz eggs` (live: Eggs Benedict
 * 300 g), `dos docenas de huevos` as 2 of `docenas de huevos` (100 g). Each target must now parse EXACTLY (deep-equal, whole
 * ParsedIngredient) as its digit twin. The controls pin origin/master's output, recorded off master before the edit
 * (s461 pd-dozen `scripts/gentest.ts`): a leading dozen, the Spanish article forms, a dozen and a half, the one token
 * `half-dozen`, a dozen word with no food after it, and the fraction lines of the HH and QTY rows stay as they were.
 */

import { parseIngredientLine } from '../ingredient-line';
import { foldTrailingQuantityClauses } from '../../nlp/trailing-quantity-fold';
import { canonicalizeSegLine } from '../../nlp/seg-line-key';

const TARGETS: Array<[string, string]> = [
  ['half dozen wings', '6 wings'],
  ['Half dozen wings', '6 wings'],
  ['1 doz eggs', '12 eggs'],
  ['2 doz eggs', '24 eggs'],
  ['1 dozen eggs', '12 eggs'],
  ['one dozen eggs', '12 eggs'],
  ['half a dozen eggs', '6 eggs'],
  ['a half dozen eggs', '6 eggs'],
  ['about half a dozen eggs', 'about 6 eggs'],
  ['1/2 dozen eggs', '6 eggs'],
  ['0.5 dozen eggs', '6 eggs'],
  ['quarter dozen eggs', '3 eggs'],
  ['one and a half dozen eggs', '18 eggs'],
  ['1 1/2 dozen eggs', '18 eggs'],
  ['2 dozen cookies', '24 cookies'],
  ['two dozen cookies', '24 cookies'],
  ['2-3 dozen cookies', '30 cookies'],
  ['3 dozen wings', '36 wings'],
  ['a couple dozen wings', '24 wings'],
  ['3 dozens of eggs', '36 eggs'],
  ['half a dozen of eggs', '6 eggs'],
  ['half dozen donuts', '6 donuts'],
  ['half a dozen oysters', '6 oysters'],
  ['half dozen krispy kreme donuts', '6 krispy kreme donuts'],
  ['half dozen chicken wings', '6 chicken wings'],
  ['2 dozen large eggs', '24 large eggs'],
  ['half dozen slices of bacon', '6 slices of bacon'],
  ['2 dozen eggs x2', '48 eggs'],
  ['dos docenas de huevos', '24 huevos'],
  ['2 docenas de huevos', '24 huevos'],
  ['1 docena de huevos', '12 huevos'],
  ['2 docenas de tacos', '24 tacos'],
];

const CONTROLS: Array<[string, unknown]> = [
  ["a dozen eggs", {"qty":12,"multiplier":1,"unit":"egg","rawUnit":"eggs","name":"eggs","notes":null,"unitHint":null}],
  ["dozen eggs", {"qty":12,"multiplier":1,"unit":"egg","rawUnit":"eggs","name":"eggs","notes":null,"unitHint":null}],
  ["A dozen eggs", {"qty":12,"multiplier":1,"unit":"egg","rawUnit":"eggs","name":"eggs","notes":null,"unitHint":null}],
  ["a dozen oatmeal cookies", {"qty":12,"multiplier":1,"unit":null,"rawUnit":null,"name":"oatmeal cookies","notes":null,"unitHint":null}],
  ["dozen oatmeal cookies", {"qty":12,"multiplier":1,"unit":null,"rawUnit":null,"name":"oatmeal cookies","notes":null,"unitHint":null}],
  ["a dozen oysters", {"qty":12,"multiplier":1,"unit":null,"rawUnit":null,"name":"oysters","notes":null,"unitHint":null}],
  ["a dozen totino's pizza rolls", {"qty":12,"multiplier":1,"unit":null,"rawUnit":null,"name":"totino's pizza rolls","notes":null,"unitHint":null}],
  ["about a dozen almonds", {"qty":12,"multiplier":1,"unit":null,"rawUnit":null,"name":"almonds","notes":null,"unitHint":null}],
  ["dozen eggs x2", {"qty":24,"multiplier":1,"unit":"egg","rawUnit":"eggs","name":"eggs","notes":null,"unitHint":null}],
  ["dozen cousins black beans", {"qty":12,"multiplier":1,"unit":null,"rawUnit":null,"name":"cousins black beans","notes":null,"unitHint":null}],
  ["wings by the dozen", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"wings by the dozen","notes":null,"unitHint":null}],
  ["una docena de huevos", {"qty":12,"multiplier":1,"unit":null,"rawUnit":null,"name":"huevos","notes":null,"unitHint":null}],
  ["media docena de huevos", {"qty":6,"multiplier":1,"unit":null,"rawUnit":null,"name":"huevos","notes":null,"unitHint":null}],
  ["docena de huevos", {"qty":12,"multiplier":1,"unit":null,"rawUnit":null,"name":"huevos","notes":null,"unitHint":null}],
  ["a baker's dozen donuts", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"a baker's dozen donuts","notes":null,"unitHint":null}],
  ["dozens of cookies", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"dozens of cookies","notes":null,"unitHint":null}],
  ["a dozen and a half eggs", {"qty":12,"multiplier":1,"unit":null,"rawUnit":null,"name":"and a half eggs","notes":null,"unitHint":null}],
  ["una docena y media de huevos", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"una docena y media de huevos","notes":null,"unitHint":null}],
  ["half-dozen eggs", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"half-dozen eggs","notes":null,"unitHint":null}],
  ["a box of a dozen donuts", {"qty":1,"multiplier":1,"unit":"box","rawUnit":"box","name":"a dozen donuts","notes":null,"unitHint":null}],
  ["a carton of a dozen eggs", {"qty":1,"multiplier":1,"unit":"carton","rawUnit":"carton","name":"a dozen eggs","notes":null,"unitHint":null}],
  ["half dozen", {"qty":0.5,"multiplier":1,"unit":null,"rawUnit":null,"name":"dozen","notes":null,"unitHint":null}],
  ["2 dozen", {"qty":2,"multiplier":1,"unit":null,"rawUnit":null,"name":"dozen","notes":null,"unitHint":null}],
  ["two dozen", {"qty":2,"multiplier":1,"unit":null,"rawUnit":null,"name":"dozen","notes":null,"unitHint":null}],
  ["half and half", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"half and half","notes":null,"unitHint":null}],
  ["2 half and half", {"qty":2,"multiplier":1,"unit":null,"rawUnit":null,"name":"half and half","notes":null,"unitHint":null}],
  ["half a pizza", {"qty":0.5,"multiplier":1,"unit":null,"rawUnit":null,"name":"a pizza","notes":null,"unitHint":null}],
  ["half a cup of milk", {"qty":0.5,"multiplier":1,"unit":"cup","rawUnit":"cup","name":"milk","notes":null,"unitHint":null}],
  ["half an avocado", {"qty":0.5,"multiplier":1,"unit":null,"rawUnit":null,"name":"an avocado","notes":null,"unitHint":null}],
  ["a quarter of a pie", {"qty":0.25,"multiplier":1,"unit":null,"rawUnit":null,"name":"pie","notes":null,"unitHint":null}],   // s463 WORD-FRACTION-COUNT-NOUN
  ["12 wings", {"qty":12,"multiplier":1,"unit":null,"rawUnit":null,"name":"wings","notes":null,"unitHint":null}],
  ["6 eggs", {"qty":6,"multiplier":1,"unit":"egg","rawUnit":"eggs","name":"eggs","notes":null,"unitHint":null}],
  ["doce huevos", {"qty":12,"multiplier":1,"unit":null,"rawUnit":null,"name":"huevos","notes":null,"unitHint":null}],
  ["dos huevos", {"qty":2,"multiplier":1,"unit":null,"rawUnit":null,"name":"huevos","notes":null,"unitHint":null}],
  ["tres tazas de arroz", {"qty":3,"multiplier":1,"unit":"cup","rawUnit":"tazas","name":"arroz","notes":null,"unitHint":null}],
  ["dos equis", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"dos equis","notes":null,"unitHint":null}],
  ["half a banana", {"qty":0.5,"multiplier":1,"unit":null,"rawUnit":null,"name":"a banana","notes":null,"unitHint":null}],
];

describe('a dozen word after a quantity multiplies it (s461 DOZEN)', () => {
  it.each(TARGETS)('%s parses exactly as %s', (line, twin) => {
    const t = parseIngredientLine(twin);
    expect(t).not.toBeNull();
    expect(parseIngredientLine(line)).toEqual(t);
  });

  it.each(CONTROLS)('control %s keeps its parse', (line, expected) => {
    expect(parseIngredientLine(line)).toEqual(expected);
  });
});

describe('the stock fold reads the multiplied count (trailing-quantity-fold.ts replaceStock())', () => {
  const fold = (line: string, stock: string, nf: string) =>
    foldTrailingQuantityClauses(canonicalizeSegLine(line), [{ rawText: stock, normalizedForm: nf, brand: '' }]);
  it.each([
    ['2 dozen eggs, ate 20', '2 dozen eggs', 'eggs', ['20 eggs'], ['stock']],
    ['a couple dozen wings, ate 10', 'a couple dozen wings', 'wings', ['10 wings'], ['stock']],
    ['half dozen eggs, ate 2', 'half dozen eggs', 'eggs', ['2 eggs'], ['stock']],
    ['a carton of a dozen eggs, ate 2', 'a carton of a dozen eggs', 'eggs', ['2 eggs'], ['stock']],
    ['half dozen eggs, ate 8', 'half dozen eggs', 'eggs', ['half dozen eggs'], []],
    ['6 eggs, ate 8', '6 eggs', 'eggs', ['6 eggs'], []],
    // rf-dozen: the parser's count is the stock when its unit is not the food's head (`large`, `slices`): over it declines
    ['2 dozen large eggs, ate 20', '2 dozen large eggs', 'eggs', ['20 eggs'], ['stock']],
    ['2 dozen large eggs, ate 30', '2 dozen large eggs', 'eggs', ['2 dozen large eggs'], []],
    ['2 dozen slices of bacon, ate 30', '2 dozen slices of bacon', 'bacon', ['2 dozen slices of bacon'], []],
  ])('%s', (line, stock, nf, rawTexts, kinds) => {
    const out = fold(line, stock, nf);
    expect(out.items.map((i) => i.rawText)).toEqual(rawTexts);
    expect(out.folds.map((f) => f.kind)).toEqual(kinds);
  });
});
