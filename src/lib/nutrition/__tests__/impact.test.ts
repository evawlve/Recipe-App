import { computeImpactPreview } from '../impact';

const base = { calories: 480, protein: 40, carbs: 40, fat: 16, fiber: 6, sugar: 8 };

test('whey scoop improves score', () => {
  const per100 = { kcal100: 380, protein100: 85, carbs100: 5, fat100: 2 };
  const r = computeImpactPreview({ currentTotals: base, foodPer100: per100 as any, servingGrams: 32, goal: 'muscle_gain' as any });
  expect(r.deltas.protein).toBeGreaterThan(25);
  expect(typeof r.deltaScore).toBe('number');
});

test('sugary add reduces score', () => {
  const per100 = { kcal100: 400, protein100: 3, carbs100: 90, fat100: 3, sugar100: 60 };
  const r = computeImpactPreview({ currentTotals: base, foodPer100: per100 as any, servingGrams: 50, goal: 'general' as any });
  expect(r.deltaScore).toBeLessThanOrEqual(0);
});

test('perServing calculation is correct', () => {
  const per100 = { kcal100: 200, protein100: 20, carbs100: 30, fat100: 5, fiber100: 10, sugar100: 15 };
  const r = computeImpactPreview({ currentTotals: base, foodPer100: per100 as any, servingGrams: 50, goal: 'general' as any });
  
  // 50g serving should be half of per100 values
  expect(r.perServing.calories).toBe(100); // 200 * 0.5
  expect(r.perServing.protein).toBe(10);   // 20 * 0.5
  expect(r.perServing.carbs).toBe(15);     // 30 * 0.5
  expect(r.perServing.fat).toBe(2.5);      // 5 * 0.5
  expect(r.perServing.fiber).toBe(5);      // 10 * 0.5
  expect(r.perServing.sugar).toBe(7.5);    // 15 * 0.5
});

test('nextTotals includes current + additions', () => {
  const per100 = { kcal100: 100, protein100: 10, carbs100: 15, fat100: 2 };
  const r = computeImpactPreview({ currentTotals: base, foodPer100: per100 as any, servingGrams: 100, goal: 'general' as any });
  
  expect(r.nextTotals.calories).toBe(base.calories + 100);
  expect(r.nextTotals.protein).toBe(base.protein + 10);
  expect(r.nextTotals.carbs).toBe(base.carbs + 15);
  expect(r.nextTotals.fat).toBe(base.fat + 2);
});

test('deltaScore reflects score change', () => {
  const per100 = { kcal100: 200, protein100: 30, carbs100: 10, fat100: 5, fiber100: 8, sugar100: 2 };
  const r = computeImpactPreview({ currentTotals: base, foodPer100: per100 as any, servingGrams: 100, goal: 'muscle_gain' as any });
  
  expect(r.prevScore).toBeGreaterThanOrEqual(0);
  expect(r.prevScore).toBeLessThanOrEqual(100);
  expect(r.nextScore).toBeGreaterThanOrEqual(0);
  expect(r.nextScore).toBeLessThanOrEqual(100);
  expect(r.deltaScore).toBe(r.nextScore - r.prevScore);
});

test('handles null/undefined fiber and sugar in currentTotals', () => {
  const currentTotals = { calories: 300, protein: 20, carbs: 30, fat: 10 }; // no fiber/sugar
  const per100 = { kcal100: 100, protein100: 10, carbs100: 15, fat100: 2, fiber100: 5, sugar100: 3 };
  const r = computeImpactPreview({ currentTotals, foodPer100: per100 as any, servingGrams: 50, goal: 'general' as any });
  
  expect(r.nextTotals.fiber).toBe(2.5); // 5 * 0.5
  expect(r.nextTotals.sugar).toBe(1.5); // 3 * 0.5
});

test('handles null/undefined fiber and sugar in foodPer100', () => {
  const per100 = { kcal100: 200, protein100: 20, carbs100: 30, fat100: 5 }; // no fiber/sugar
  const r = computeImpactPreview({ currentTotals: base, foodPer100: per100 as any, servingGrams: 100, goal: 'general' as any });
  
  expect(r.perServing.fiber).toBe(0);
  expect(r.perServing.sugar).toBe(0);
  expect(r.nextTotals.fiber).toBe(base.fiber);
  expect(r.nextTotals.sugar).toBe(base.sugar);
});
