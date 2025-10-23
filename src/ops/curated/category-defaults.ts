export type Defaults = {
  densityGml?: number; // g/ml
  units?: Array<{ label: string; grams: number }>;
};

export const CATEGORY_DEFAULTS: Record<string, Defaults> = {
  oil: { densityGml: 0.91, units: [{ label: '1 tbsp', grams: 13.6 }, { label: '1 tsp', grams: 4.5 }] },
  flour: { densityGml: 0.53, units: [{ label: '1 cup', grams: 120 }, { label: '1 tbsp', grams: 8 }] },
  starch: { densityGml: 0.6, units: [{ label: '1 tbsp', grams: 8 }] },
  liquid: { densityGml: 1.0, units: [{ label: '1 cup', grams: 240 }, { label: '1 tbsp', grams: 15 }] },
  oats: { densityGml: 0.4, units: [{ label: '1 cup', grams: 90 }] },
  rice_uncooked: { densityGml: 0.85, units: [{ label: '1 cup', grams: 185 }] },
  sugar: { densityGml: 0.85, units: [{ label: '1 tbsp', grams: 12.5 }, { label: '1 tsp', grams: 4.2 }] },
  whey: { densityGml: 0.5, units: [{ label: '1 scoop', grams: 32 }] },
  meat: { densityGml: 1.0, units: [{ label: '1 cup, diced', grams: 140 }] },
  veg: { densityGml: 1.0 },
  fruit: { densityGml: 1.0 },
  grain: { densityGml: 0.7, units: [{ label: '1 cup', grams: 185 }, { label: '1 tbsp', grams: 12 }] },
  legume: { densityGml: 1.0, units: [{ label: '1 cup', grams: 240 }, { label: '1 tbsp', grams: 15 }] },
  nut_butter: { densityGml: 1.0, units: [{ label: '1 tbsp', grams: 16 }, { label: '1 tsp', grams: 5 }] },
};
