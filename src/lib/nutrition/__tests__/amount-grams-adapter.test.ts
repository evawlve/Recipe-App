import { resolveGramsAdapter } from '../amount-grams-adapter';

// Mock logger to avoid console output in tests
jest.mock('../../logger', () => ({
  logger: {
    info: jest.fn()
  }
}));

test('mass unit goes through existing path', () => {
  const grams = resolveGramsAdapter({
    amount: { qty: 28.349523125, unit: 'g' },
    densityGml: 1.0,
  });
  expect(grams).toBeCloseTo(28.349523125);
});

test('oz to grams conversion', () => {
  const grams = resolveGramsAdapter({
    amount: { qty: 1, unit: 'oz' },
    densityGml: 1.0,
  });
  expect(grams).toBeCloseTo(28.349523125);
});

test('lb to grams conversion', () => {
  const grams = resolveGramsAdapter({
    amount: { qty: 1, unit: 'lb' },
    densityGml: 1.0,
  });
  expect(grams).toBeCloseTo(453.59237);
});

test('volume unit uses density', () => {
  const grams = resolveGramsAdapter({
    amount: { qty: 1, unit: 'tbsp' },
    densityGml: 0.91, // oil
  });
  expect(grams!).toBeGreaterThan(13);
  expect(grams!).toBeLessThan(14.5);
});

test('parsed count unit (half bar)', () => {
  const grams = resolveGramsAdapter({
    parsed: { qty: 1, multiplier: 0.5, unit: 'bar', rawUnit: null, name: 'protein bar' },
    servingOptions: [{ label: '1 bar', grams: 50 }],
  });
  expect(grams).toBeCloseTo(25);
});

test('parsed mass unit (2 oz)', () => {
  const grams = resolveGramsAdapter({
    parsed: { qty: 2, multiplier: 1, unit: 'oz', rawUnit: null, name: 'flour' },
    densityGml: 1.0,
  });
  expect(grams).toBeCloseTo(56.69904625); // 2 * 28.349523125
});

test('parsed volume unit with density', () => {
  const grams = resolveGramsAdapter({
    parsed: { qty: 1, multiplier: 1, unit: 'tbsp', rawUnit: null, name: 'olive oil' },
    densityGml: 0.91,
  });
  expect(grams!).toBeGreaterThan(13);
  expect(grams!).toBeLessThan(14.5);
});

test('returns null when cannot infer', () => {
  const grams = resolveGramsAdapter({
    parsed: { qty: 1, multiplier: 1, unit: null, rawUnit: 'mystery', name: 'x' },
    servingOptions: [],
  });
  expect(grams).toBeNull();
});

test('returns null when no input provided', () => {
  const grams = resolveGramsAdapter({});
  expect(grams).toBeNull();
});

test('parsed with unknown unit falls back to serving options', () => {
  const grams = resolveGramsAdapter({
    parsed: { qty: 1, multiplier: 1, unit: null, rawUnit: 'thing', name: 'protein bar' },
    servingOptions: [{ label: '1 bar', grams: 50 }],
  });
  expect(grams).toBeCloseTo(50);
});

test('parsed with no serving options returns null', () => {
  const grams = resolveGramsAdapter({
    parsed: { qty: 1, multiplier: 1, unit: 'bar', rawUnit: null, name: 'protein bar' },
    servingOptions: [],
  });
  expect(grams).toBeNull();
});

test('amount with volume unit and no density uses default', () => {
  const grams = resolveGramsAdapter({
    amount: { qty: 1, unit: 'tbsp' },
    densityGml: null,
  });
  expect(grams).toBeCloseTo(14.78676478125); // 1 tbsp * 1.0 density
});

test('parsed with count unit but no matching serving option', () => {
  const grams = resolveGramsAdapter({
    parsed: { qty: 1, multiplier: 1, unit: 'slice', rawUnit: null, name: 'bread' },
    servingOptions: [{ label: '1 bar', grams: 50 }], // no slice option
  });
  expect(grams).toBeCloseTo(50); // falls back to first serving
});
