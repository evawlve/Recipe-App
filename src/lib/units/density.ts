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

// Keyword patterns for inferring category from food name
// Order matters: more specific patterns should come first
const CATEGORY_KEYWORDS: Array<{ category: Category; keywords: string[] }> = [
  // Legumes
  { category: 'legume', keywords: ['lentil', 'chickpea', 'bean', 'pea', 'edamame', 'hummus', 'dal', 'dhal'] },
  // Grains
  { category: 'grain', keywords: ['quinoa', 'barley', 'bulgur', 'farro', 'couscous', 'millet', 'amaranth'] },
  // Rice (separate for different density)
  { category: 'rice', keywords: ['rice', 'risotto'] },
  // Oats
  { category: 'oats', keywords: ['oat', 'oatmeal', 'porridge'] },
  // Flour/Starch
  { category: 'flour', keywords: ['flour', 'cornmeal', 'semolina'] },
  { category: 'starch', keywords: ['starch', 'cornstarch', 'arrowroot', 'tapioca'] },
  // Oils
  { category: 'oil', keywords: ['oil', 'ghee', 'lard', 'shortening'] },
  // Sugar/Sweeteners
  { category: 'sugar', keywords: ['sugar', 'honey', 'syrup', 'molasses', 'agave'] },
  // Dairy
  { category: 'dairy', keywords: ['milk', 'yogurt', 'yoghurt', 'cream', 'buttermilk', 'kefir'] },
  { category: 'cheese', keywords: ['cheese', 'parmesan', 'mozzarella', 'cheddar', 'feta', 'ricotta'] },
  // Proteins
  { category: 'protein', keywords: ['chicken', 'beef', 'pork', 'turkey', 'lamb', 'fish', 'salmon', 'tuna', 'shrimp', 'tofu', 'tempeh'] },
  // Nuts and Seeds
  { category: 'nut', keywords: ['nut', 'almond', 'walnut', 'cashew', 'pecan', 'hazelnut', 'pistachio', 'peanut'] },
  { category: 'seed', keywords: ['seed', 'flax', 'chia', 'sesame', 'sunflower', 'pumpkin seed'] },
  // Produce
  { category: 'vegetable', keywords: ['broccoli', 'spinach', 'carrot', 'celery', 'pepper', 'onion', 'tomato', 'cabbage', 'lettuce', 'kale'] },
  { category: 'fruit', keywords: ['apple', 'banana', 'orange', 'berry', 'strawberry', 'blueberry', 'mango', 'grape'] },
  // Powders
  { category: 'powder', keywords: ['powder', 'whey', 'protein powder', 'cocoa', 'matcha'] },
  // Beverages
  { category: 'beverage', keywords: ['juice', 'coffee', 'tea', 'water', 'soda', 'drink'] },
  // Condiments
  { category: 'condiment', keywords: ['sauce', 'ketchup', 'mustard', 'mayo', 'dressing', 'vinegar', 'soy sauce'] },
];

/**
 * Infer food category from food name using keyword matching.
 * Used when FatSecret doesn't provide category data.
 */
export function inferCategoryFromName(foodName: string): Category | null {
  const lower = foodName.toLowerCase();
  for (const { category, keywords } of CATEGORY_KEYWORDS) {
    if (keywords.some(kw => lower.includes(kw))) {
      return category;
    }
  }
  return null;
}


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

