export type Category =
  | 'oil' | 'flour' | 'starch' | 'whey' | 'sugar' | 'rice' | 'oats' | 'liquid' | 'powder' | 'unknown';

const CATEGORY_DENSITY_GML: Record<Category, number> = {
  oil: 0.91, flour: 0.53, starch: 0.80, whey: 0.50, sugar: 0.85,
  rice: 0.85, oats: 0.36, liquid: 1.00, powder: 0.55, unknown: 1.00,
};

export function categoryDensity(categoryId?: string | null): number | undefined {
  // plug in your categoryId→Category map; for now assume id === key
  return categoryId ? CATEGORY_DENSITY_GML[(categoryId as Category)] : undefined;
}

export function resolveDensityGml(foodDensity?: number | null, categoryId?: string | null) {
  return foodDensity ?? categoryDensity(categoryId) ?? 1.0;
}

