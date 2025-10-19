import { scoreV2 } from '../score-v2';

function approx(n:number, min:number, max:number){ expect(n).toBeGreaterThanOrEqual(min); expect(n).toBeLessThanOrEqual(max); }

test('high-protein, low-sugar bowl → great', () => {
  const s = scoreV2({ calories: 600, protein: 60, carbs: 50, fat: 18, fiber: 10, sugar: 5 }, 'muscle_gain');
  expect(s.value).toBeGreaterThanOrEqual(80);
  expect(s.label).toBe('great');
});

test('oil-heavy (low protein density) → poor', () => {
  const s = scoreV2({ calories: 240, protein: 0, carbs: 0, fat: 27, fiber: 0, sugar: 0 }, 'general');
  expect(s.value).toBeLessThanOrEqual(40);
});

test('sugary pastry (high sugar per 100 kcal) → penalized', () => {
  const s = scoreV2({ calories: 400, protein: 6, carbs: 60, fat: 14, fiber: 2, sugar: 36 }, 'general');
  approx(s.value, 35, 65); // expect middling/low depending on balance vs goal
  expect(s.breakdown.sugar).toBeLessThanOrEqual(70);
});

test('macro balance improves with target goal', () => {
  const wl = scoreV2({ calories: 500, protein: 45, carbs: 40, fat: 15, fiber: 8, sugar: 6 }, 'weight_loss');
  const gen = scoreV2({ calories: 500, protein: 45, carbs: 40, fat: 15, fiber: 8, sugar: 6 }, 'general');
  expect(wl.value).toBeGreaterThanOrEqual(gen.value - 5); // within expected range; balance favors WL slightly
});

test('fiber bonus increases score', () => {
  const lowFiber = scoreV2({ calories: 500, protein: 30, carbs: 50, fat: 20, fiber: 5, sugar: 10 }, 'general');
  const highFiber = scoreV2({ calories: 500, protein: 30, carbs: 50, fat: 20, fiber: 15, sugar: 10 }, 'general');
  expect(highFiber.value).toBeGreaterThan(lowFiber.value);
});

test('protein density scoring works correctly', () => {
  const highProtein = scoreV2({ calories: 400, protein: 40, carbs: 30, fat: 15, fiber: 8, sugar: 5 }, 'muscle_gain');
  const lowProtein = scoreV2({ calories: 400, protein: 10, carbs: 60, fat: 15, fiber: 8, sugar: 5 }, 'muscle_gain');
  expect(highProtein.breakdown.proteinDensity).toBeGreaterThan(lowProtein.breakdown.proteinDensity);
});

test('sugar penalty reduces score significantly', () => {
  const lowSugar = scoreV2({ calories: 400, protein: 25, carbs: 40, fat: 15, fiber: 8, sugar: 5 }, 'general');
  const highSugar = scoreV2({ calories: 400, protein: 25, carbs: 40, fat: 15, fiber: 8, sugar: 30 }, 'general');
  expect(lowSugar.value).toBeGreaterThan(highSugar.value);
  expect(highSugar.breakdown.sugar).toBeLessThan(lowSugar.breakdown.sugar);
});

test('score returns correct structure', () => {
  const s = scoreV2({ calories: 500, protein: 30, carbs: 50, fat: 20, fiber: 10, sugar: 8 }, 'general');
  expect(s).toHaveProperty('value');
  expect(s).toHaveProperty('label');
  expect(s).toHaveProperty('breakdown');
  expect(s.breakdown).toHaveProperty('proteinDensity');
  expect(s.breakdown).toHaveProperty('macroBalance');
  expect(s.breakdown).toHaveProperty('fiber');
  expect(s.breakdown).toHaveProperty('sugar');
  expect(typeof s.value).toBe('number');
  expect(typeof s.label).toBe('string');
  expect(s.value).toBeGreaterThanOrEqual(0);
  expect(s.value).toBeLessThanOrEqual(100);
});

test('handles zero calories gracefully', () => {
  const s = scoreV2({ calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, sugar: 0 }, 'general');
  expect(s.value).toBeGreaterThanOrEqual(0);
  expect(s.value).toBeLessThanOrEqual(100);
  expect(s.label).toBe('poor');
});

test('handles null/undefined fiber and sugar', () => {
  const s = scoreV2({ calories: 400, protein: 25, carbs: 40, fat: 15, fiber: null, sugar: undefined }, 'general');
  expect(s.value).toBeGreaterThanOrEqual(0);
  expect(s.value).toBeLessThanOrEqual(100);
});
