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

// S1.1: Fractions attached to numbers
test('2½ cups flour', () => {
  const p = parseIngredientLine('2½ cups flour')!;
  expect(p.qty).toBeCloseTo(2.5);
  expect(p.unit).toBe('cup');
  expect(p.name).toBe('flour');
});

test('½ cup oats', () => {
  const p = parseIngredientLine('½ cup oats')!;
  expect(p.qty).toBeCloseTo(0.5);
  expect(p.unit).toBe('cup');
  expect(p.name).toBe('oats');
});

test('1 ½ cup milk', () => {
  const p = parseIngredientLine('1 ½ cup milk')!;
  expect(p.qty).toBeCloseTo(1.5);
  expect(p.unit).toBe('cup');
  expect(p.name).toBe('milk');
});

// S1.1: Ranges
test('2-3 large eggs', () => {
  const p = parseIngredientLine('2-3 large eggs')!;
  expect(p.qty).toBeCloseTo(2.5);
  // Note: "large" qualifier extraction will be handled in S1.2
  expect(p.name).toContain('eggs');
});

test('2–3 cups flour', () => {
  const p = parseIngredientLine('2–3 cups flour')!;
  expect(p.qty).toBeCloseTo(2.5);
  expect(p.unit).toBe('cup');
  expect(p.name).toBe('flour');
});

test('2 to 3 tbsp olive oil', () => {
  const p = parseIngredientLine('2 to 3 tbsp olive oil')!;
  expect(p.qty).toBeCloseTo(2.5);
  expect(p.unit).toBe('tbsp');
  expect(p.name).toBe('olive oil');
});

// S1.1: Combined fractions with ranges
test('1½-2 tsp vanilla extract', () => {
  const p = parseIngredientLine('1½-2 tsp vanilla extract')!;
  expect(p.qty).toBeCloseTo(1.75);
  expect(p.unit).toBe('tsp');
  expect(p.name).toBe('vanilla extract');
});

test('¼ tsp salt', () => {
  const p = parseIngredientLine('¼ tsp salt')!;
  expect(p.qty).toBeCloseTo(0.25);
  expect(p.unit).toBe('tsp');
  expect(p.name).toBe('salt');
});