import { parseIngredientLine } from '../ingredient-line';
import { resolveGramsAdapter } from '../../nutrition/amount-grams-adapter';

// Mock logger to avoid console output in tests
jest.mock('../../logger', () => ({
  logger: {
    info: jest.fn()
  }
}));

test('end-to-end: parse weird ingredient and resolve grams', () => {
  // Parse a complex ingredient line
  const parsed = parseIngredientLine('1 half protein bar');
  expect(parsed).not.toBeNull();
  expect(parsed!.qty).toBeCloseTo(1);
  expect(parsed!.multiplier).toBeCloseTo(0.5);
  expect(parsed!.unit).toBe('bar');
  expect(parsed!.name).toBe('protein bar');

  // Resolve grams using serving options
  const servingOptions = [
    { label: '1 bar', grams: 50 },
    { label: '1 scoop', grams: 32 }
  ];

  const grams = resolveGramsAdapter({
    parsed,
    servingOptions
  });

  expect(grams).toBeCloseTo(25); // 1 * 0.5 * 50
});

test('end-to-end: parse fraction and resolve with density', () => {
  // Parse a volume-based ingredient
  const parsed = parseIngredientLine('½ cup olive oil');
  expect(parsed).not.toBeNull();
  expect(parsed!.qty).toBeCloseTo(0.5);
  expect(parsed!.unit).toBe('cup');
  expect(parsed!.name).toBe('olive oil');

  // Resolve grams using density
  const grams = resolveGramsAdapter({
    parsed,
    densityGml: 0.91 // olive oil density
  });

  expect(grams).toBeGreaterThan(100); // 0.5 cup * 240ml * 0.91 g/ml
  expect(grams).toBeLessThan(120);
});

test('end-to-end: parse mixed number and resolve', () => {
  // Parse a mixed number
  const parsed = parseIngredientLine('1 1/2 cups flour');
  expect(parsed).not.toBeNull();
  expect(parsed!.qty).toBeCloseTo(1.5);
  expect(parsed!.unit).toBe('cup');
  expect(parsed!.name).toBe('flour');

  // Resolve grams using density
  const grams = resolveGramsAdapter({
    parsed,
    densityGml: 0.53 // flour density
  });

  expect(grams).toBeGreaterThan(180); // 1.5 cup * 240ml * 0.53 g/ml
  expect(grams).toBeLessThan(200);
});

test('end-to-end: parse unicode fraction', () => {
  // Parse unicode fraction
  const parsed = parseIngredientLine('⅓ scoop whey');
  expect(parsed).not.toBeNull();
  expect(parsed!.qty).toBeCloseTo(1/3, 5);
  expect(parsed!.unit).toBe('scoop');
  expect(parsed!.name).toBe('whey');

  // Resolve grams using serving options
  const servingOptions = [
    { label: '1 scoop', grams: 32 }
  ];

  const grams = resolveGramsAdapter({
    parsed,
    servingOptions
  });

  expect(grams).toBeCloseTo(32/3, 5); // (1/3) * 32
});

test('end-to-end: fallback when no match found', () => {
  // Parse an ingredient with unknown unit (now part of name)
  const parsed = parseIngredientLine('1 mystery protein bar');
  expect(parsed).not.toBeNull();
  expect(parsed!.qty).toBeCloseTo(1);
  expect(parsed!.unit).toBeNull();
  expect(parsed!.rawUnit).toBeNull();
  expect(parsed!.name).toBe('mystery protein bar');

  // Resolve grams using fallback serving option
  const servingOptions = [
    { label: '1 bar', grams: 50 }
  ];

  const grams = resolveGramsAdapter({
    parsed,
    servingOptions
  });

  expect(grams).toBeCloseTo(50); // Falls back to first serving option
});
