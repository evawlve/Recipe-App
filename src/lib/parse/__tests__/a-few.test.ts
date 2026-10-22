/**
 * C70 shorthand ROW 2: `a few` / `few` is a COUNT word of 3, the `a couple` = 2 family.
 * It is NOT the gram table the 2026-08-17 prose report section 6.5 declines (that ban
 * covers a bit of / a splash of / a drizzle of / some); the grams still come from the
 * record's per-unit serving. Controls are hard-coded from master (read before the edit).
 */
import { parseIngredientLine } from '../ingredient-line';

const p = (line: string) => parseIngredientLine(line);

describe('a few = 3, twin of the digit form', () => {
  const twins: Array<[string, string]> = [
    ['a few slices of muenster', '3 slices of muenster'],
    ['a few slices of muenster cheese', '3 slices of muenster cheese'],
    ['a few chicken tenders', '3 chicken tenders'],
    ['a few blueberries', '3 blueberries'],
    ['a few strawberries', '3 strawberries'],
    ['few spoonfuls of chocolate ice cream', '3 spoonfuls of chocolate ice cream'],
    ['few eggs', '3 eggs'],
    // refute R2-F3: the definite-frame and hedge strips now fire because the parser reads `few`
    ['the last few cookies', 'the last 3 cookies'],
    ['like a few chips', 'like 3 chips'],
    ['1 cup and a few tbsp milk', '1 cup and 3 tbsp milk'],
    ['a few oz of steak', '3 oz of steak'],
    ['a few bites of pizza', '3 bites of pizza'],
  ];
  test.each(twins)('%s ≡ %s', (target, twin) => {
    expect(p(target)).not.toBeNull();
    expect(p(target)).toEqual(p(twin));
  });

  test('a few ≡ a couple (both null)', () => {
    expect(p('a few')).toBeNull();
    expect(p('a couple')).toBeNull();
  });

  test('a few of the cookies ≡ a couple of the cookies with qty 3', () => {
    expect(p('a few of the cookies')).toEqual({ ...p('a couple of the cookies'), qty: 3 });
  });
});

describe('explicit values', () => {
  test('a few slices of muenster', () => {
    expect(p('a few slices of muenster')).toEqual({
      qty: 3, multiplier: 1, unit: 'slice', rawUnit: 'slices', name: 'muenster', notes: null, unitHint: null,
    });
  });
  test('a few milk (ungrammatical, population 0)', () => {
    expect(p('a few milk')).toMatchObject({ qty: 3, name: 'milk' });
  });
  test('few and far between (junk in, junk out)', () => {
    expect(p('few and far between')).toMatchObject({ qty: 3, name: 'and far between' });
  });
  test('bare few is null', () => {
    expect(p('few')).toBeNull();
  });
  test('a few more cookies', () => {
    expect(p('a few more cookies')).toMatchObject({ qty: 3, name: 'more cookies' });
  });
  test('named interim: an unknown unit string (sips) routes to the AI estimator until #578', () => {
    expect(p('a few sips of a chocolate milkshake')).toEqual({
      qty: 3, multiplier: 1, unit: 'sips', rawUnit: 'sips', name: 'a chocolate milkshake', notes: null, unitHint: null,
    });
  });
  test('maybe a few spoonfuls is a food-less fragment; the hedge strip leaves the name spoonfuls', () => {
    expect(p('maybe a few spoonfuls')).toMatchObject({ qty: 3, name: 'spoonfuls' });
  });
});

describe('controls: unchanged from master', () => {
  const unchanged = (name: string) => ({
    qty: 1, multiplier: 1, unit: null, rawUnit: null, name, notes: null, unitHint: null,
  });
  test.each([
    'several cookies',
    'some cookies',
    'a fewer',
    'the few',
    'about time seasoning',
    'quite a few cookies',
    'just a few chips',
    'a few-calorie snack',
  ])('%s', (line) => {
    expect(p(line)).toEqual(unchanged(line));
  });

  test('a couple slices of muenster', () => {
    expect(p('a couple slices of muenster')).toEqual({
      qty: 2, multiplier: 1, unit: 'slice', rawUnit: 'slices', name: 'muenster', notes: null, unitHint: null,
    });
  });
  test('a dozen eggs', () => {
    expect(p('a dozen eggs')).toEqual({
      qty: 12, multiplier: 1, unit: 'egg', rawUnit: 'eggs', name: 'eggs', notes: null, unitHint: null,
    });
  });
});
