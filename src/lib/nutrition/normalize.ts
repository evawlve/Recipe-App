/**
 * Robust nutrition normalizer for USDA/brand foods
 * Converts per-serving data to per-100g with proper density calculations
 */

export type RawFood = {
  name: string;
  brand?: string | null;
  // raw fields from providers
  energyKcal?: number | null; // per serving
  energyKj?: number | null;   // per serving
  proteinG?: number | null;   // per serving
  carbsG?: number | null;
  fatG?: number | null;
  fiberG?: number | null;
  sugarG?: number | null;

  servingSize?: number | null;          // numeric
  servingSizeUnit?: string | null;      // "g","ml","tsp","tbsp","cup","scoop", etc.
  gramWeight?: number | null;           // preferred if provided (per serving)

  // optional: provider metadata to help density lookup
  categoryHint?: string | null; // "oil","liquid","flour"...
};

export type Per100g = {
  calories: number; proteinG: number; carbsG: number; fatG: number; fiberG: number; sugarG: number;
};

export function kjToKcal(kj: number): number {
  return Math.round(kj / 4.184);
}

const DENSITY = {
  tsp: { oil: 4.5, water: 5 },
  tbsp: { oil: 13.6, water: 15 },
  cup: { oil: 216, water: 240, flour: 120, sugar: 200, rice: 185, oats: 90 },
};

// choose grams from serving info
export function servingToGrams(raw: RawFood): number | null {
  if (raw.gramWeight && raw.gramWeight > 0) return raw.gramWeight;
  const unit = (raw.servingSizeUnit || "").toLowerCase().trim();
  const n = raw.servingSize ?? null;
  if (!n || n <= 0) return null;

  if (unit === "g" || unit === "gram" || unit === "grams") return n;

  const isLiquid = (raw.categoryHint || "").toLowerCase().includes("liquid") ||
    (raw.categoryHint || "").toLowerCase().includes("water") ||
    (raw.categoryHint || "").toLowerCase().includes("milk") ||
    (raw.categoryHint || "").toLowerCase().includes("broth") ||
    (raw.categoryHint || "").toLowerCase().includes("stock") ||
    (raw.categoryHint || "").toLowerCase().includes("juice");

  if ((unit === "ml" || unit === "milliliter" || unit === "milliliters") && isLiquid) return n; // water-like default

  // household measures via density table
  const cat = (raw.categoryHint || "").toLowerCase();
  function pick(table:any): number | null {
    if (!table) return null;
    if (cat.includes("oil") || cat.includes("olive oil")) return table.oil ?? null;
    if (cat.includes("water") || cat.includes("milk") || cat.includes("liquid")) return table.water ?? null;
    if (cat.includes("flour")) return table.flour ?? null;
    if (cat.includes("sugar")) return table.sugar ?? null;
    if (cat.includes("rice")) return table.rice ?? null;
    if (cat.includes("oat")) return table.oats ?? null;
    return null;
  }

  const normalizeUnit = (value: string) => {
    if (["tsp", "teaspoon", "teaspoons"].includes(value)) return "tsp";
    if (["tbsp", "tablespoon", "tablespoons"].includes(value)) return "tbsp";
    if (["cup", "cups"].includes(value)) return "cup";
    return value;
  };

  const normalizedUnit = normalizeUnit(unit);

  if (normalizedUnit === "tsp") {
    const g = pick(DENSITY.tsp);
    return g ? n * g : null;
  }
  if (normalizedUnit === "tbsp") {
    const g = pick(DENSITY.tbsp);
    return g ? n * g : null;
  }
  if (normalizedUnit === "cup") {
    const g = pick(DENSITY.cup);
    return g ? n * g : null;
  }

  // unknown unit => no guess
  return null;
}

export function sanitizePer100g(n: Per100g): { n: Per100g; sanitized: boolean } {
  const clamp = (x:number, lo:number, hi:number) => Math.max(lo, Math.min(hi, x));
  let { calories, proteinG, carbsG, fatG, fiberG, sugarG } = n;

  proteinG = clamp(proteinG || 0, 0, 100);
  carbsG   = clamp(carbsG   || 0, 0, 100);
  fatG     = clamp(fatG     || 0, 0, 100);
  fiberG   = clamp(fiberG   || 0, 0, 100);
  sugarG   = clamp(sugarG   || 0, 0, 100);

  if (fiberG > carbsG) fiberG = carbsG;

  calories = clamp(calories || 0, 0, 900);

  const kcalFromMacros = 4*proteinG + 4*carbsG + 9*fatG;
  const delta = Math.abs(kcalFromMacros - calories) / Math.max(1, calories);
  let sanitized = false;

  if (delta > 0.15) {
    // adjust carbs to reconcile energy (keep P/F stable)
    const targetCarbs = clamp((calories - (4*proteinG + 9*fatG)) / 4, 0, 100);
    carbsG = targetCarbs;
    if (fiberG > carbsG) fiberG = carbsG;
    sanitized = true;
  }

  return { n: { calories, proteinG, carbsG, fatG, fiberG, sugarG }, sanitized };
}

// core: normalize per serving -> per 100g
export function toPer100g(raw: RawFood): Per100g | null {
  // pick kcal
  let kcal = raw.energyKcal ?? null;
  if (kcal == null && raw.energyKj != null) kcal = kjToKcal(raw.energyKj);
  if (kcal == null && raw.proteinG == null && raw.carbsG == null && raw.fatG == null) return null;

  const grams = servingToGrams(raw);
  // if we already have per 100g (grams == 100 or provider flagged), fast-path:
  if (grams && Math.abs(grams - 100) < 0.5) {
    const out: Per100g = {
      calories: kcal ?? (4*(raw.proteinG||0) + 4*(raw.carbsG||0) + 9*(raw.fatG||0)),
      proteinG: raw.proteinG || 0,
      carbsG:   raw.carbsG   || 0,
      fatG:     raw.fatG     || 0,
      fiberG:   raw.fiberG   || 0,
      sugarG:   raw.sugarG   || 0,
    };
    return sanitizePer100g(out).n;
  }

  if (!grams || grams <= 0) return null; // cannot normalize safely

  const scale = 100 / grams;
  const out: Per100g = {
    calories: Math.round((kcal ?? (4*(raw.proteinG||0)+4*(raw.carbsG||0)+9*(raw.fatG||0))) * scale),
    proteinG: (raw.proteinG || 0) * scale,
    carbsG:   (raw.carbsG   || 0) * scale,
    fatG:     (raw.fatG     || 0) * scale,
    fiberG:   (raw.fiberG   || 0) * scale,
    sugarG:   (raw.sugarG   || 0) * scale,
  };
  return sanitizePer100g(out).n;
}

/**
 * Extract category hint from food name/description
 */
export function extractCategoryHint(name: string, brand?: string): string | null {
  const text = `${name} ${brand || ''}`.toLowerCase();
  
  if (/oil|olive oil|canola|avocado oil|vegetable oil/i.test(text)) return "oil";
  if (/milk|water|broth|stock|juice/i.test(text)) return "liquid";
  if (/flour|almond flour|coconut flour/i.test(text)) return "flour";
  if (/sugar|granulated sugar|brown sugar/i.test(text)) return "sugar";
  if (/rice|white rice|brown rice/i.test(text)) return "rice";
  if (/oat|rolled oats|steel cut oats/i.test(text)) return "oats";
  
  return null;
}

/**
 * Validate per-100g values for sanity
 */
export function validatePer100g(per100g: Per100g): { valid: boolean; reason?: string } {
  // Oil sanity check
  if (per100g.fatG > 90) {
    if (per100g.calories < 800 || per100g.calories > 900) {
      return { valid: false, reason: "Oil calories out of range" };
    }
  }
  
  // General sanity
  if (per100g.calories > 900) {
    return { valid: false, reason: "Calories too high (>900 per 100g)" };
  }
  
  if (per100g.proteinG + per100g.carbsG + per100g.fatG > 100) {
    return { valid: false, reason: "Macros sum > 100g" };
  }
  
  return { valid: true };
}
