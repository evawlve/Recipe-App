/**
 * Count tags: resolveCountTag() in count-tag.ts (header owns the mechanism and the guards).
 *
 * TARGETS deep-equal their numeric twin's WHOLE parse. CONTROLS pin the master parse, hard-coded
 * from master 081a3aef BEFORE the edit (the design's 13 controls, the refute's 12 regression lines
 * and the collision set). FN_CONTROLS pin resolveCountTag(line) === line: function-level, so they
 * stay valid whichever sibling parse PR lands first. KNOWN MISSES are pinned as unchanged.
 */

import { parseIngredientLine } from '../ingredient-line';
import { resolveCountTag } from '../count-tag';

const TARGETS: Array<[string, string]> = [
  ['toast x2', '2 toast'],
  ['avo toast x2', '2 avo toast'],
  ['hb egg x2', '2 hb egg'],
  ['choc chip cookie x3', '3 choc chip cookie'],
  ['turkey burger x2', '2 turkey burger'],
  ['expresso x2', '2 expresso'],
  ['toast ×2', '2 toast'],
  ['chicken (x2 thighs)', '2 chicken thighs'],
  ['eggs (x2)', '2 eggs'],
  ['toast x2 w/ butter', '2 toast w/ butter'],
  ['2x string cheese', '2 string cheese'],
  ['2x scrambled eggs', '2 scrambled eggs'],
  ['3x chocolate bar', '3 chocolate bar'],
  ['PB banana toast x1', '1 PB banana toast'],
  // A leading DIGIT count plus a trailing tag multiplies (2026-10-25; `3 eggs x2` and `2 wings x2` were pinned
  // as master parses before: qty 3 name `x2`, qty 2 name `wings x2`).
  ['3 eggs x2', '6 eggs'],
  ['2 wings x2', '4 wings'],
  ['2 eggs x2', '4 eggs'],
  ['1 banana x3', '3 banana'],
  ['3 cookies x 2', '6 cookies'],
  ['2 eggs ×2', '4 eggs'],
];

/** Master parses (081a3aef), unchanged by the edit. */
const CONTROLS: Array<[string, unknown]> = [
  ["2 x 200g chicken", {"qty":2,"multiplier":200,"unit":"g","rawUnit":"g","name":"chicken","notes":null,"unitHint":null}],
  ["2x200g chicken", {"qty":2,"multiplier":200,"unit":"g","rawUnit":"g","name":"chicken","notes":null,"unitHint":null}],
  ["2 x 15 oz cans tomatoes", {"qty":30,"multiplier":1,"unit":"oz","rawUnit":"oz","name":"tomatoes","notes":null,"unitHint":null}],
  ["5x5 workout bar", {"qty":5,"multiplier":5,"unit":null,"rawUnit":null,"name":"workout bar","notes":null,"unitHint":null}],
  ["ihop 2 x 2 x 2", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"ihop 2 x 2 x 2","notes":null,"unitHint":null}],
  ["chicken x 12 oz", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"chicken x 12 oz","notes":null,"unitHint":null}],
  ["x2 eggs", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"x2 eggs","notes":null,"unitHint":null}],
  ["eggs (2)", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"eggs 2","notes":null,"unitHint":null}],
  ["xbox", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"xbox","notes":null,"unitHint":null}],
  ["oj 12oz", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"oj 12 oz","notes":null,"unitHint":null}],
  ["toast x0", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"toast x0","notes":null,"unitHint":null}],
  ["2 eggs", {"qty":2,"multiplier":1,"unit":"egg","rawUnit":"eggs","name":"eggs","notes":null,"unitHint":null}],
  ["⅓ bagel x2", {"qty":0.3333333333333333,"multiplier":1,"unit":null,"rawUnit":null,"name":"bagel x2","notes":null,"unitHint":null}],
  ["⅛ pizza x2", {"qty":0.125,"multiplier":1,"unit":null,"rawUnit":null,"name":"pizza x2","notes":null,"unitHint":null}],
  ["couple eggs x2", {"qty":2,"multiplier":1,"unit":"egg","rawUnit":"eggs","name":"x2","notes":null,"unitHint":null}],
  ["dozen eggs x2", {"qty":12,"multiplier":1,"unit":"egg","rawUnit":"eggs","name":"x2","notes":null,"unitHint":null}],
  ["third bagel x2", {"qty":0.3333333333333333,"multiplier":1,"unit":null,"rawUnit":null,"name":"bagel x2","notes":null,"unitHint":null}],
  ["quarter bagel x2", {"qty":0.25,"multiplier":1,"unit":null,"rawUnit":null,"name":"bagel x2","notes":null,"unitHint":null}],
  ["quarter pounder x2", {"qty":0.25,"multiplier":1,"unit":null,"rawUnit":null,"name":"pounder x2","notes":null,"unitHint":null}],
  ["about 2 eggs x2", {"qty":2,"multiplier":1,"unit":"egg","rawUnit":"eggs","name":"x2","notes":null,"unitHint":null}],
  ["the last 2 slices of pizza x2", {"qty":2,"multiplier":1,"unit":"slice","rawUnit":"slices","name":"pizza x2","notes":null,"unitHint":null}],
  ["the last 2 slices x2", {"qty":2,"multiplier":1,"unit":"slice","rawUnit":"slices","name":"x2","notes":null,"unitHint":null}],
  ["9x13 pan", {"qty":9,"multiplier":13,"unit":null,"rawUnit":null,"name":"pan","notes":null,"unitHint":null}],
  ["9 x 13 pan", {"qty":9,"multiplier":13,"unit":null,"rawUnit":null,"name":"pan","notes":null,"unitHint":null}],
  ["2 x 4", null],
  ["2x4", null],
  ["x2 cups", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"x2 cups","notes":null,"unitHint":null}],
  ["2xl shirt", {"qty":2,"multiplier":1,"unit":null,"rawUnit":null,"name":"shirt","notes":null,"qualifiers":["xl"],"unitHint":null}],
  ["xo sauce", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"xo sauce","notes":null,"unitHint":null}],
  ["x2o water", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"x2o water","notes":null,"unitHint":null}],
  ["a bagel x2", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"a bagel x2","notes":null,"unitHint":null}],
  ["a short stack x2", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"a stack x2","notes":null,"qualifiers":["short"],"unitHint":null}],
  ["toast x2 cups", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"toast x2 cups","notes":null,"unitHint":null}],
  ["chicken x2 12 oz", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"chicken x2 12 oz","notes":null,"unitHint":null}],
  ["eggs x2 and toast x2", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"eggs x2 and toast x2","notes":null,"unitHint":null}],
  ["toast x2.5", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"toast x2.5","notes":null,"unitHint":null}],
  ["toast x100", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"toast x100","notes":null,"unitHint":null}],
  ["eggs (2x)", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"eggs 2 x","notes":null,"unitHint":null}],
  ["red bull 2x", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"red bull 2 x","notes":null,"unitHint":null}],
  // Master parses (94279f86) beside the 2026-10-25 leading-count branch, unchanged by it.
  ["2 eggs x2.5", {"qty":2,"multiplier":1,"unit":"egg","rawUnit":"eggs","name":"x2.5","notes":null,"unitHint":null}],
  ["strong x2 energy drink", {"qty":2,"multiplier":1,"unit":null,"rawUnit":null,"name":"strong energy drink","notes":null,"unitHint":null}],
  ["eggs x2", {"qty":2,"multiplier":1,"unit":"egg","rawUnit":"eggs","name":"eggs","notes":null,"unitHint":null}],
  ["x2 energy drink", {"qty":1,"multiplier":1,"unit":null,"rawUnit":null,"name":"x2 energy drink","notes":null,"unitHint":null}],
];

/**
 * KNOWN MISS (deploy-3 integration, 2026-10-20): a HEDGED leading quantity plus a tag. The tag declines
 * (guard a/b/c) and the parse is the owner's, so the stray `x<N>` stays in the name. With #572 (approximator
 * before a bare count) merged these parsed like plain `2 wings x2` did then; since 2026-10-25 a DIGIT-led
 * count multiplies (TARGETS), and only the hedge/article-led lines below stay in this class.
 */
const LEADING_QTY_TAG_CLASS: Array<[string, unknown]> = [
  ["at least 2 wings x2", {"qty":2,"multiplier":1,"unit":null,"rawUnit":null,"name":"wings x2","notes":null,"unitHint":null}],
  ["upwards of 3 beers x2", {"qty":3,"multiplier":1,"unit":null,"rawUnit":null,"name":"beers x2","notes":null,"unitHint":null}],
  ["at least a dozen wings x2", {"qty":12,"multiplier":1,"unit":null,"rawUnit":null,"name":"wings x2","notes":null,"unitHint":null}],
  ["about 3 wings x2", {"qty":3,"multiplier":1,"unit":null,"rawUnit":null,"name":"wings x2","notes":null,"unitHint":null}],
];

/** Guard (g): N is a pack size, not a count of the food. */
const PACK_SIZE_DECLINES: string[] = ["coke x12 pack", "water (x24 case)", "coke (x12 pack)", "la croix x8 pk"];

/** Guard (g), cloud-40 F4: a drinkware/container word after N would become the head noun; the tag declines. */
const CONTAINER_DECLINES: string[] = ["wine x2 glasses", "beer x2 cans", "water x2 bottles", "coffee x2 mugs", "wine (x2 glasses)"];

/** resolveCountTag(line) must return the line untouched. */
const FN_CONTROLS: string[] = [
  "⅓ bagel x2",
  "⅛ pizza x2",
  "couple eggs x2",
  "dozen eggs x2",
  "third bagel x2",
  "quarter bagel x2",
  "quarter pounder x2",
  "about 2 eggs x2",
  "the last 2 slices of pizza x2",
  "the last 2 slices x2",
  "chicken x2 12 oz",
  "eggs x2 and toast x2",
  "toast x2 cups",
  "toast x2.5",
  "toast x100",
  "eggs (2x)",
  "red bull 2x",
  "9x13 pan",
  "2xl shirt",
  "xo sauce",
  "x2o water",
  "a short stack x2",
  "xbox",
  "x2 cups",
  "a bagel x2",
  // The leading-count branch declines: text after the tag, a mass/volume unit, a non-word after the count.
  "2 toast x2 w/ butter",
  "2 cups rice x2",
  "12 oz steak x2",
  "2 1/2 bagels x2",
  "2 7up x2",
  "2 eggs x0",
  "2 eggs x2.5",
  "2 x 200g chicken",
  "2x200g chicken",
];

describe('count tag reads as a leading count', () => {
  it.each(TARGETS)('%s parses exactly as its twin %s', (target, twin) => {
    const t = parseIngredientLine(target);
    expect(t).not.toBeNull();
    expect(t).toEqual(parseIngredientLine(twin));
  });

  it('a leading digit count times a trailing tag: 2 eggs x2 = 4 eggs, and the tag leaves the name', () => {
    expect(parseIngredientLine('2 eggs x2')).toMatchObject({ qty: 4, multiplier: 1, unit: 'egg', name: 'eggs' });
    expect(resolveCountTag('2 eggs x2')).toBe('4 eggs');
    expect(resolveCountTag('3 cookies x 2')).toBe('6 cookies');
  });

  it('a tag reads the count the name used to carry', () => {
    expect(parseIngredientLine('toast x2')).toMatchObject({ qty: 2, name: 'toast' });
    expect(parseIngredientLine('chicken (x2 thighs)')).toMatchObject({ qty: 2 });
  });

  it.each(CONTROLS)('control %s keeps its master parse', (line, expected) => {
    expect(parseIngredientLine(line)).toEqual(expected);
  });

  it.each(LEADING_QTY_TAG_CLASS)('known miss (leading quantity + tag) %s keeps the owner parse', (line, expected) => {
    expect(parseIngredientLine(line)).toEqual(expected);
    expect(resolveCountTag(line)).toBe(line);
  });

  it.each(PACK_SIZE_DECLINES)('guard (g): %s is a pack size, the tag declines', (line) => {
    expect(resolveCountTag(line)).toBe(line);
  });

  it.each(CONTAINER_DECLINES)('guard (g): %s keeps master\'s parse (the container never becomes the head noun)', (line) => {
    expect(resolveCountTag(line)).toBe(line);
    expect(parseIngredientLine(line)?.name).not.toMatch(/^(?:wine|beer|water|coffee) (?:glasses|cans|bottles|mugs)$/);
  });

  it('a few wings x2 declines at the tag (an article-led line; with #583 it joins the leading-quantity class)', () => {
    expect(resolveCountTag('a few wings x2')).toBe('a few wings x2');
  });

  it.each(FN_CONTROLS)('resolveCountTag declines %s', (line) => {
    expect(resolveCountTag(line)).toBe(line);
  });

  it('collisions: x inside words and dimensions decline', () => {
    for (const line of ['xbox', '9x13 pan', '2 x 4', 'x2 cups', 'xo sauce', '2xl shirt']) {
      expect(resolveCountTag(line)).toBe(line);
    }
  });

  it('accepted: x2 daily counts 2, and 2x protein only drops the stray x', () => {
    expect(parseIngredientLine('toast x2 daily')).toMatchObject({ qty: 2, name: 'toast daily' });
    expect(parseIngredientLine('2x protein')).toMatchObject({ qty: 2, name: 'protein' });
  });

  it('known misses stay unchanged: (2x), trailing 2x, punctuation after the tag', () => {
    for (const line of ['eggs (2x)', 'red bull 2x', 'tacos x3!', 'a bagel x2']) {
      expect(resolveCountTag(line)).toBe(line);
    }
  });
});
