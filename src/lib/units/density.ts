export type Category =
  | 'oil' | 'flour' | 'starch' | 'whey' | 'sugar' | 'rice' | 'oats' | 'liquid' | 'powder' 
  | 'dairy' | 'cheese' | 'protein' | 'vegetable' | 'fruit' | 'nut' | 'seed' | 'grain' 
  | 'legume' | 'condiment' | 'beverage' | 'unknown';

// Expanded category density defaults (g/ml)
// These are reasonable estimates for common food categories
const CATEGORY_DENSITY_GML: Record<string, number> = {
  // Original categories
  oil: 0.91,
  flour: 0.53,
  starch: 0.80,
  whey: 0.50,
  sugar: 0.85,
  rice: 0.85,
  oats: 0.36,
  liquid: 1.00,
  powder: 0.55,
  
  // New categories (common food categories)
  dairy: 1.03,        // Milk, yogurt (slightly denser than water)
  cheese: 1.10,       // Most cheeses
  protein: 1.05,      // Cooked meats, fish
  vegetable: 0.95,    // Most vegetables
  fruit: 0.95,        // Most fruits
  nut: 0.55,          // Nuts (similar to powder)
  seed: 0.60,         // Seeds
  grain: 0.80,        // Cooked grains
  legume: 0.90,       // Cooked beans, lentils
  condiment: 1.10,    // Sauces, condiments
  beverage: 1.00,     // Most beverages (water-based)
  
  // Fallback
  unknown: 1.00,
};

export type DensitySource = 
  | { type: 'known'; value: number }           // Food has explicit densityGml
  | { type: 'calculated'; value: number }      // Calculated from FoodUnits
  | { type: 'category'; value: number; category: string }  // Category-based default
  | { type: 'fallback'; value: number };       // Generic fallback (1.0 g/ml)

export function categoryDensity(categoryId?: string | null): number | undefined {
  if (!categoryId) return undefined;
  // Try exact match first, then case-insensitive
  return CATEGORY_DENSITY_GML[categoryId] ?? 
         CATEGORY_DENSITY_GML[categoryId.toLowerCase()];
}

/**
 * Resolve density with metadata about source (for user alerts)
 */
export function resolveDensityWithSource(
  foodDensity?: number | null,
  categoryId?: string | null,
  calculatedFromUnits?: number | null
): DensitySource {
  // 1. Known density (explicitly set)
  if (foodDensity != null && foodDensity > 0) {
    return { type: 'known', value: foodDensity };
  }
  
  // 2. Calculated from FoodUnits
  if (calculatedFromUnits != null && calculatedFromUnits > 0) {
    return { type: 'calculated', value: calculatedFromUnits };
  }
  
  // 3. Category-based default
  const catDensity = categoryDensity(categoryId);
  if (catDensity != null) {
    return { type: 'category', value: catDensity, category: categoryId || 'unknown' };
  }
  
  // 4. Generic fallback
  return { type: 'fallback', value: 1.0 };
}

/**
 * Get density value (backward compatible)
 */
export function resolveDensityGml(
  foodDensity?: number | null, 
  categoryId?: string | null,
  calculatedFromUnits?: number | null
) {
  const source = resolveDensityWithSource(foodDensity, categoryId, calculatedFromUnits);
  return source.value;
}

/**
 * Get user-friendly message about density source
 */
export function getDensityMessage(densitySource: DensitySource): string | null {
  switch (densitySource.type) {
    case 'known':
      return null; // No message needed - we have accurate density
    case 'calculated':
      return 'Volume conversion calculated from serving size data';
    case 'category':
      return `Volume conversion estimated based on ${densitySource.category} category`;
    case 'fallback':
      return 'Volume conversion using generic estimate (may be inaccurate)';
    default:
      return null;
  }
}

