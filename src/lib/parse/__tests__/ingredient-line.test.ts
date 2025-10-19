import { parseIngredientLine } from '../ingredient-line';

test('1 half protein bar', () => {
  const p = parseIngredientLine('1 half protein bar')!;
  expect(p.qty).toBeCloseTo(1);
  expect(p.multiplier).toBeCloseTo(0.5);
  expect(p.unit).toBe('bar');
  expect(p.name).toBe('protein bar');
});

test('½ scoop whey', () => {
  const p = parseIngredientLine('½ scoop whey')!;
  expect(p.qty).toBeCloseTo(0.5);
  expect(p.unit).toBe('scoop');
  expect(p.name).toBe('whey');
});

test('1 and 1/2 cups oats', () => {
  const p = parseIngredientLine('1 and 1/2 cups oats')!;
  expect(p.qty).toBeCloseTo(1.5);
  expect(p.unit).toBe('cup');
  expect(p.name).toBe('oats');
});

test('1 1/2 cups oats', () => {
  const p = parseIngredientLine('1 1/2 cups oats')!;
  expect(p.qty).toBeCloseTo(1.5);
  expect(p.unit).toBe('cup');
  expect(p.name).toBe('oats');
});

test('2 tbsp olive oil', () => {
  const p = parseIngredientLine('2 tbsp olive oil')!;
  expect(p.qty).toBeCloseTo(2);
  expect(p.multiplier).toBeCloseTo(1);
  expect(p.unit).toBe('tbsp');
  expect(p.name).toBe('olive oil');
});

test('1 cup flour', () => {
  const p = parseIngredientLine('1 cup flour')!;
  expect(p.qty).toBeCloseTo(1);
  expect(p.unit).toBe('cup');
  expect(p.name).toBe('flour');
});

test('half cup milk', () => {
  const p = parseIngredientLine('half cup milk')!;
  expect(p.qty).toBeCloseTo(0.5);
  expect(p.multiplier).toBeCloseTo(1);
  expect(p.unit).toBe('cup');
  expect(p.name).toBe('milk');
});

test('1 piece bread', () => {
  const p = parseIngredientLine('1 piece bread')!;
  expect(p.qty).toBeCloseTo(1);
  expect(p.unit).toBe('piece');
  expect(p.name).toBe('bread');
});

test('2 eggs', () => {
  const p = parseIngredientLine('2 eggs')!;
  expect(p.qty).toBeCloseTo(2);
  expect(p.unit).toBe('egg');
  expect(p.name).toBe('eggs');
});

test('unknown unit falls back to rawUnit', () => {
  const p = parseIngredientLine('1 smaccamoo protein bar')!;
  expect(p.rawUnit).toBe('smaccamoo');
  expect(p.unit).toBeNull();
  expect(p.name).toBe('protein bar');
});

test('empty string returns null', () => {
  const p = parseIngredientLine('');
  expect(p).toBeNull();
});

test('whitespace only returns null', () => {
  const p = parseIngredientLine('   ');
  expect(p).toBeNull();
});

test('no quantity returns null', () => {
  const p = parseIngredientLine('protein bar');
  expect(p).toBeNull();
});
