/**
 * Unit normalization and conversion utilities
 */

/**
 * Normalize unit strings to standard forms
 */
export function normalizeUnit(u: string): "g"|"kg"|"mg"|"ml"|"tsp"|"tbsp"|"cup"|"oz"|"lb"|"scoop"|string {
  const unit = u.toLowerCase().trim();
  
  // Map synonyms to standard forms
  const synonyms: Record<string, string> = {
    "teaspoon": "tsp",
    "teaspoons": "tsp", 
    "tablespoon": "tbsp",
    "tablespoons": "tbsp",
    "tbs": "tbsp",
    "cups": "cup",
    "ounce": "oz",
    "ounces": "oz",
    "pound": "lb",
    "pounds": "lb",
    "gram": "g",
    "grams": "g",
    "milliliter": "ml",
    "millilitre": "ml",
    "milliliters": "ml",
    "millilitres": "ml"
  };
  
  return synonyms[unit] || unit;
}

/**
 * Convert quantity and unit to grams (for weight units only)
 * Returns null for volume units that need density
 */
export function toGramsByUnit(qty: number, unit: string): number | null {
  const normalized = normalizeUnit(unit);
  
  switch (normalized) {
    case "g":
      return qty;
    case "kg":
      return qty * 1000;
    case "mg":
      return qty / 1000;
    case "oz":
      return qty * 28.3495;
    case "lb":
      return qty * 453.592;
    case "ml":
      return qty; // water-like default
    default:
      return null; // Volume units (tsp/tbsp/cup/scoop) need density
  }
}
