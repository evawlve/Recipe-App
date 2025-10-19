export type Per100 = {
  kcal100: number; protein100: number; carbs100: number; fat100: number;
  fiber100?: number | null; sugar100?: number | null;
};

export function perServingFrom100(p: Per100, grams: number) {
  const f = grams / 100;
  return {
    calories: p.kcal100 * f,
    protein:  p.protein100 * f,
    carbs:    p.carbs100 * f,
    fat:      p.fat100 * f,
    fiber:    (p.fiber100 ?? 0) * f,
    sugar:    (p.sugar100 ?? 0) * f,
  };
}
