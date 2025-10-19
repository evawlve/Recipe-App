/**
 * Scaling utilities for nutrition data
 */

export interface Per100g {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sugarG: number;
}

/**
 * Scale per-100g nutrition data to a specific gram amount
 */
export function scalePer100g(per100: Per100g, grams: number): Per100g {
  const f = grams / 100;
  return {
    calories: Math.round(per100.calories * f),
    proteinG: +(per100.proteinG * f).toFixed(1),
    carbsG: +(per100.carbsG * f).toFixed(1),
    fatG: +(per100.fatG * f).toFixed(1),
    fiberG: +(per100.fiberG * f).toFixed(1),
    sugarG: +(per100.sugarG * f).toFixed(1),
  };
}
