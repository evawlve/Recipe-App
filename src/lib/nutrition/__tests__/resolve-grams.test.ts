import { resolveGramsFromParsed } from '../resolve-grams';

const servingOptions = [
  { label: '1 bar', grams: 50 },
  { label: '1 scoop', grams: 32 },
  { label: '1 cup', grams: 120 },
];

test('half bar uses count serving', () => {
  const parsed = { qty: 1, multiplier: 0.5, unit: 'bar', rawUnit: null, name: 'protein bar' };
  const g = resolveGramsFromParsed(parsed as any, servingOptions);
  expect(g).toBeCloseTo(25);
});

test('2 scoops uses count serving', () => {
  const parsed = { qty: 2, multiplier: 1, unit: 'scoop', rawUnit: null, name: 'whey' };
  const g = resolveGramsFromParsed(parsed as any, servingOptions);
  expect(g).toBeCloseTo(64);
});

test('1.5 cups uses count serving', () => {
  const parsed = { qty: 1.5, multiplier: 1, unit: 'cup', rawUnit: null, name: 'flour' };
  const g = resolveGramsFromParsed(parsed as any, servingOptions);
  expect(g).toBeCloseTo(180);
});

test('fallback to first serving when count unknown', () => {
  const parsed = { qty: 2, multiplier: 1, unit: null, rawUnit: 'thing', name: 'protein bar' };
  const g = resolveGramsFromParsed(parsed as any, servingOptions);
  expect(g).toBeCloseTo(100); // 2 * 50 (first serving)
});

test('fallback to first serving when unit not found', () => {
  const parsed = { qty: 1, multiplier: 1, unit: 'slice', rawUnit: null, name: 'bread' };
  const g = resolveGramsFromParsed(parsed as any, servingOptions);
  expect(g).toBeCloseTo(50); // 1 * 50 (first serving)
});

test('returns null when no serving options', () => {
  const parsed = { qty: 1, multiplier: 1, unit: 'bar', rawUnit: null, name: 'protein bar' };
  const g = resolveGramsFromParsed(parsed as any, []);
  expect(g).toBeNull();
});

test('returns null when parsed is null', () => {
  const g = resolveGramsFromParsed(null as any, servingOptions);
  expect(g).toBeNull();
});

test('handles case insensitive matching', () => {
  const parsed = { qty: 1, multiplier: 1, unit: 'BAR', rawUnit: null, name: 'protein bar' };
  const g = resolveGramsFromParsed(parsed as any, servingOptions);
  expect(g).toBeCloseTo(50);
});

test('handles partial matches in serving labels', () => {
  const parsed = { qty: 1, multiplier: 1, unit: 'scoop', rawUnit: null, name: 'whey' };
  const g = resolveGramsFromParsed(parsed as any, [{ label: '1 scoop whey', grams: 32 }]);
  expect(g).toBeCloseTo(32);
});
