import { convertMass, convertVolume, gramsFromVolume } from './unit-graph';

test('mass conversion g<->oz', () => {
  expect(convertMass(28.349523125, 'g', 'oz')).toBeCloseTo(1, 6);
  expect(convertMass(1, 'oz', 'g')).toBeCloseTo(28.349523125, 6);
});

test('volume conversion cup<->ml', () => {
  expect(convertVolume(1, 'cup', 'ml')).toBeCloseTo(240, 6);
  expect(convertVolume(3, 'tsp', 'tbsp')).toBeCloseTo(1, 6);
});

test('grams from volume with density', () => {
  // oil ~ 0.91 g/ml, 1 tbsp ~ 13.6 g
  expect(gramsFromVolume(1, 'tbsp', 0.91)).toBeGreaterThan(13);
  expect(gramsFromVolume(1, 'tbsp', 0.91)).toBeLessThan(14.5);
});

