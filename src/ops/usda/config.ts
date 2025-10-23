export type UsdaSaturationFilters = {
  // FDC fields to include
  includeDataTypes: Array<'SR Legacy'|'Survey (FNDDS)'|'Branded'|'SR Legacy Foundation'|'Foundation'>;
  // Substring rules applied to description/foodCategory fields
  excludeIfNameHas: string[];
  excludeIfCategoryHas: string[];
  // Hard calorie plausibility (kcal/100 g)
  kcalMin: number; // e.g., 0
  kcalMax: number; // e.g., 1200
};

export const DEFAULT_SATURATION_FILTERS: UsdaSaturationFilters = {
  includeDataTypes: ['SR Legacy','Survey (FNDDS)','Foundation'],
  excludeIfNameHas: [
    'infant','baby','toddler','supplement','formula','shake mix','restaurant','fast food',
    'branded','brand','capsule','tablet','gummy','energy drink','sports drink'
  ],
  excludeIfCategoryHas: [
    'Baby','Infant','Restaurant','Supplements','Formula','Dietary supplement'
  ],
  kcalMin: 0,
  kcalMax: 1200,
};
