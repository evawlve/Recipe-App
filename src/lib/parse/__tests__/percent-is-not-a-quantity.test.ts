/**
 * A leading percentage or leanness ratio is a MODIFIER, not a count (2026-08-24).
 *
 * parseQuantityTokens() read `2%` as 2 and `85/15` as the fraction 85/15, so
 * `2% milk` parsed as qty 2 (every one of its 90 MappingEventLog events billed
 * 500 g / 226 kcal -- two label servings of a2 "Milk"), `93% lean ground turkey`
 * as qty 93 (10,416 g on the live box), and `85/15 ground beef` as qty 5.67.
 * Every "master:" comment is master's own output, measured with tsx against
 * 81cf589 on 2026-08-24; the controls are asserted at those same outputs so the
 * guard is proven inert on real quantities, fractions, ranges and word numbers.
 */
import { parseQuantityTokens, isPercentOrLeannessRatioToken } from '../quantity';
import { parseIngredientLine } from '../ingredient-line';

describe('isPercentOrLeannessRatioToken', () => {
  it.each(['2%', '0%', '93%', '100%', '2.5%', '85/15', '80/20', '90/10', '93/7', '96/4', '50/50'])('%s is a modifier', (t) => {
    expect(isPercentOrLeannessRatioToken(t)).toBe(true);
  });
  it.each(['2', '1/2', '3/4', '1/4', '2-3', '½', '12', '2.5', '25/75', '1/3', 'two'])('%s is not', (t) => {
    // 25/75 sums to 100 but is asserted as a ratio below at parse level; here the
    // token predicate is what matters: a real fraction never sums to 100.
    expect(isPercentOrLeannessRatioToken(t)).toBe(t === '25/75');
  });
});

describe('parseQuantityTokens refuses a percentage or a leanness ratio', () => {
  it.each([['2%'], ['93%'], ['85/15'], ['93/7']])('%s -> null', (t) => {
    expect(parseQuantityTokens([t, 'milk'])).toBeNull(); // master: qty 2 / 93 / 5.67 / 13.29
  });
  it('still reads real fractions and ranges', () => {
    expect(parseQuantityTokens(['1/2', 'cup'])).toEqual({ qty: 0.5, consumed: 1 });
    expect(parseQuantityTokens(['2-3', 'eggs'])?.qty).toBe(2.5);
    expect(parseQuantityTokens(['1', '1/2', 'cups'])).toEqual({ qty: 1.5, consumed: 2 });
  });
});

// [line, qty, unit, name]
const changed: Array<[string, number, string | null, string]> = [
  ['2% milk', 1, null, '2% milk'], // master: qty 2, name "milk"
  ['1% milk', 1, null, '1% milk'], // master: qty 1, name "milk" (right number by accident)
  ['93% lean ground turkey', 1, null, '93% lean ground turkey'], // master: qty 93
  ['85% lean ground beef', 1, null, '85% lean ground beef'], // master: qty 85
  ['100% orange juice', 1, null, '100% orange juice'], // master: qty 100
  ['0% greek yogurt', 1, null, '0% greek yogurt'], // master: qty 0
  ['2% cottage cheese', 1, null, '2% cottage cheese'], // master: qty 2
  ['70% dark chocolate', 1, null, '70% dark chocolate'], // master: qty 70
  ['85/15 ground beef', 1, null, '85/15 ground beef'], // master: qty 5.666..., name "ground beef"
  ['93/7 ground turkey', 1, null, '93/7 ground turkey'], // master: qty 13.28...
  ['25/75 mix', 1, null, '25/75 mix'], // master: qty 0.333...
  // `whole` is consumed by the parser on BOTH sides (master: qty 100, unit "whole",
  // name "wheat bread"); that is a separate, pre-existing residual -- the guard
  // only stops `100%` from being the count.
  ['100% whole wheat bread', 1, null, '100% wheat bread'],
];

const unchanged: Array<[string, number, string | null, string]> = [
  ['2 cups 2% milk', 2, 'cup', '2% milk'],
  ['1 cup 2% milk', 1, 'cup', '2% milk'],
  ['8 oz 2% milk', 8, 'oz', '2% milk'],
  ['1 glass of 2% milk', 1, 'glass', '2% milk'],
  ['2 eggs', 2, 'egg', 'eggs'],
  ['1/2 cup rice', 0.5, 'cup', 'rice'],
  ['3/4 cup oats', 0.75, 'cup', 'oats'],
  ['1/4 cup oats', 0.25, 'cup', 'oats'],
  ['1 1/2 cups flour', 1.5, 'cup', 'flour'],
  ['2-3 eggs', 2.5, 'egg', 'eggs'],
  ['a dozen eggs', 12, 'egg', 'eggs'],
  ['20 almonds', 20, null, 'almonds'],
  ['1 knob of butter', 1, 'knob', 'butter'],
  ['2 slices whole wheat bread', 2, 'slice', 'wheat bread'],
];

describe('parseIngredientLine: the percentage stays in the name and the count is 1', () => {
  it.each(changed)('%s', (line, qty, unit, name) => {
    const p = parseIngredientLine(line);
    expect([p.qty, p.unit, p.name]).toEqual([qty, unit, name]);
  });
});

describe('parseIngredientLine: real quantities are master-identical', () => {
  it.each(unchanged)('%s', (line, qty, unit, name) => {
    const p = parseIngredientLine(line);
    expect([p.qty, p.unit, p.name]).toEqual([qty, unit, name]);
  });
});
