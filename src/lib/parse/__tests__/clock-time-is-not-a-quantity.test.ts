/**
 * A clock time is a TIMESTAMP, not a count and not part of the food (s453, 2026-11-08).
 *
 * `11am snack: string cheese` is short enough that `singleItemFromText()` (parse route) answers it alone,
 * and `parseIngredientLine()` split `11am` into `11` + `am`, read 11 as the quantity and kept `am snack:
 * string cheese` as the name -> 11 string cheeses (known since s179, 2026-10-16; re-measured by s453
 * BUILD-CLOCK R2). `6:30 oatmeal` read 6 (parseFloat stops at the colon); `2 eggs at 7am` kept the right
 * count but named the food `at 7 am`. The mapper calls the same function (`preflightIngredientLine()`),
 * so the name is also the retrieval query and the cache key.
 *
 * The contract pinned here: a line carrying a clock time parses EXACTLY as the same line without it.
 * Every "master:" comment is origin/master ea8c01b2's own output, measured by calling the shipped
 * function from jest on 2026-11-08.
 */
import { parseIngredientLine } from '../ingredient-line';

const shape = (line: string) => {
  const p = parseIngredientLine(line);
  return p && { qty: p.qty, multiplier: p.multiplier, unit: p.unit, name: p.name };
};

// [line with a clock time, the same line without it]
const members: Array<[string, string]> = [
  ['11am snack: string cheese', 'snack: string cheese'], // master: qty 11, name "am snack: string cheese"
  ['7pm dinner: rice', 'dinner: rice'], // master: qty 7, name "pm dinner: rice"
  ['5am protein shake', 'protein shake'], // master: qty 5, name "am protein shake"
  ['10PM cereal', 'cereal'], // master: qty 10, name "pm cereal"
  ['6:30 oatmeal', 'oatmeal'], // master: qty 6, name "oatmeal"
  ['12:30 lunch sandwich', 'lunch sandwich'], // master: qty 12, name "lunch sandwich"
  ['at 6:30 oatmeal', 'oatmeal'], // master: qty 1, name "at 6:30 oatmeal"
  ['breakfast 8am eggs', 'breakfast eggs'], // master: qty 1, name "breakfast 8 am eggs"
  ['8 a.m. eggs', 'eggs'], // master: qty 8, name "a.m. eggs"
  ['11 am snack string cheese', 'snack string cheese'], // master: qty 11, name "am snack string cheese"
  ['7 p.m. pizza', 'pizza'], // master: qty 7, name "p.m. pizza"
  ['2 eggs at 7am', '2 eggs'], // master: qty 2, name "at 7 am"
  ['oatmeal @ 7:30am', 'oatmeal'],
  ['7pm 2 slices pizza', '2 slices pizza'], // the real count after the time is still read
];

describe('a clock time is not a quantity', () => {
  it.each(members)('%s parses as %s', (withTime, without) => {
    expect(shape(withTime)).toEqual(shape(without));
  });

  it('the member line bills ONE string cheese', () => {
    expect(parseIngredientLine('11am snack: string cheese')?.qty).toBe(1);
  });
});

// CONTROLS: master's own outputs, unchanged.
// [line, qty, unit, name]
const controls: Array<[string, number, string | null, string]> = [
  ['11 almonds', 11, null, 'almonds'],
  ['2 eggs', 2, 'egg', 'eggs'],
  ['1.5 cups rice', 1.5, 'cup', 'rice'],
  ['3pcs nuggets', 3, null, 'pcs nuggets'],
  ['24 oz coffee', 24, 'oz', 'coffee'],
  ['1 cup 2% milk', 1, 'cup', '2% milk'],
  ['85/15 ground beef', 1, null, '85/15 ground beef'],
  ['1:1 ratio', 1, null, 'ratio'], // a one-digit "minute" is not a clock time
  ['2 amaretti cookies', 2, null, 'amaretti cookies'], // `am` must be a whole token
  ['2 amish rolls', 2, null, 'amish rolls'],
  ['3 pmole', 3, null, 'pmole'],
  ['2 apples', 2, null, 'apples'],
  ['2 ham slices', 2, null, 'ham'],
  ['1 spam musubi', 1, null, 'spam musubi'],
  ['camembert', 1, null, 'camembert'],
  ['5 hour energy', 1, null, '5 hour energy'],
  ['7up', 1, null, '7up'],
  ['at least 2 eggs', 2, 'egg', 'eggs'],
  // A line that is ONLY a time keeps master's parse: stripping would leave no food at all.
  ['2pm', 2, null, 'pm'],
  ['2 pm', 2, null, 'pm'],
];

describe('controls are unchanged', () => {
  it.each(controls)('%s -> qty %s unit %s name %s', (line, qty, unit, name) => {
    expect(shape(line)).toEqual({ qty, multiplier: 1, unit, name });
  });
});

// s453 refute r1 (independent lens on PR #648). Members: a time followed by `:` / a dash, a two-word prefix, a time range,
// a leading-zero time. Every "master:" is ea8c01b2's own output, measured 2026-11-08.
const refuteMembers: Array<[string, string]> = [
  ['7am: 2 eggs', '2 eggs'], // master: qty 7, name "2 eggs"
  ['11am: string cheese', 'string cheese'], // master: qty 11 (the s179 defect in its commonest diary form)
  ['7:30am: oatmeal', 'oatmeal'], // master: qty 7
  ['6:00 AM: 2 eggs', '2 eggs'], // master: qty 6, name "AM: 2 eggs"
  ['7 a.m.: eggs', 'eggs'], // master: qty 7, name "a.m.: eggs"
  ['2 slices pizza at around 9pm', '2 slices pizza'], // master: name "pizza at around 9 pm"
  ['7am – 2 eggs', '2 eggs'], // master: qty 7, name "am – 2 eggs"
  ['07:30 2 eggs', '2 eggs'], // master: qty 7
  ['11am-1pm snacks', 'snacks'], // master: qty 6
  ['00:30 snack', 'snack'], // master: qty 0
  ['7pm 鸡蛋', '鸡蛋'], // master: qty 7, name "pm 鸡蛋" (the letter check is Unicode)
];

describe('refute r1: more clock-time shapes parse as their time-free twin', () => {
  it.each(refuteMembers)('%s parses as %s', (withTime, without) => {
    expect(shape(withTime)).toEqual(shape(without));
  });
});

// CONTROLS that must equal master: the ARCO brand am/pm, ratios, a triple colon, number-led names, a prefix with no time.
// Several of master's outputs here are themselves wrong (`7-eleven hot dog` qty 7, `24 hour fitness shake` qty 24) - out of
// scope; they are pinned only as UNCHANGED by the clock-time strip, never as correct.
const refuteControls: Array<[string, ReturnType<typeof shape>]> = [
  ['2 am/pm hot dogs', { qty: 2, multiplier: 1, unit: null, name: 'am/pm hot dogs' }],
  ['2 AM/PM burritos', { qty: 2, multiplier: 1, unit: null, name: 'AM/PM burritos' }],
  ['2 am-pm taquitos', { qty: 2, multiplier: 1, unit: null, name: 'am-pm taquitos' }],
  ['1 am pm hot dog', { qty: 1, multiplier: 1, unit: null, name: 'am pm hot dog' }],
  ['2 ampm hot dogs', { qty: 2, multiplier: 1, unit: null, name: 'ampm hot dogs' }],
  ['2:1 rice water', { qty: 2, multiplier: 1, unit: null, name: 'rice water' }],
  ['3:2', null],
  ['1 bag 5:1 trail mix', { qty: 1, multiplier: 1, unit: 'bag', name: '5:1 trail mix' }],
  ['10:30:45 bar', { qty: 10, multiplier: 1, unit: 'bar', name: 'bar' }],
  ['24:00 snack', { qty: 24, multiplier: 1, unit: null, name: 'snack' }],
  ['7-eleven hot dog', { qty: 7, multiplier: 1, unit: null, name: 'hot dog' }],
  ['24 hour fitness shake', { qty: 24, multiplier: 1, unit: null, name: 'hour fitness shake' }],
  ['at 7 eggs', { qty: 1, multiplier: 1, unit: null, name: 'at 7 eggs' }],
  ['eggs @ 2', { qty: 1, multiplier: 1, unit: null, name: 'eggs @ 2' }],
];

describe('refute r1: controls equal master', () => {
  it.each(refuteControls)('%s', (line, expected) => {
    expect(shape(line)).toEqual(expected);
  });
});
