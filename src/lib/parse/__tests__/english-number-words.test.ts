/**
 * s456 NW (ASC row 31): English number words 13-99 and "a/N hundred" parse as
 * quantities, so `thirty grams of blackberries` bills like `30 grams of blackberries`.
 */
import { parseIngredientLine } from '../ingredient-line';
import { parseQuantityTokens } from '../quantity';

const PAIRS: Array<[string, string, number]> = [
  ['thirty grams of blackberries', '30 grams of blackberries', 30],
  ['a hundred grams of chicken thigh', '100 grams of chicken thigh', 100],
  ['two hundred grams of cottage cheese', '200 grams of cottage cheese', 200],
  ['twenty skittles', '20 skittles', 20],
  ['twenty five grams of oats', '25 grams of oats', 25],
  ['twenty-five grams of oats', '25 grams of oats', 25],
  ['two hundred and fifty grams of rice', '250 grams of rice', 250],
  ['thirteen almonds', '13 almonds', 13],
  ['Ninety Nine grams of rice', '99 grams of rice', 99],
  ['one hundred twenty ml of milk', '120 ml of milk', 120],
];

describe('English number words 13-99 and hundreds', () => {
  test.each(PAIRS)('%s === %s', (w, d, qty) => {
    expect(parseIngredientLine(w)).toEqual(parseIngredientLine(d));
    expect(parseIngredientLine(w)?.qty).toBe(qty);
  });

  test('controls: twelve unchanged, a brand-led "five guys" stays a name, `and` needs a number', () => {
    const twelve = parseIngredientLine('twelve grams of blackberries');
    expect(twelve?.qty).toBe(12);
    expect(twelve?.unit).toBe('g');
    const guys = parseIngredientLine('five guys little cheeseburger');
    expect(guys?.qty).toBe(1);
    expect(guys?.name).toContain('five guys');
    expect(parseQuantityTokens(['two', 'hundred', 'and', 'zzqx'])).toEqual({ qty: 200, consumed: 2 });
  });
});
