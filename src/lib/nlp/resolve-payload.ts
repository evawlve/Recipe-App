import { prisma } from '../db';
import { deriveServingOptions } from '../units/servings';
import { extractCacheNutrients, buildServingOptionsForCacheFood } from '../mapping/cache-search';

export function getServingType(label: string): 'weight' | 'volume' | 'count' {
  const normalized = label.toLowerCase().trim();
  
  // Volume units
  if (/\b(cup|cups|tbsp|tablespoon|tablespoons|tsp|teaspoon|teaspoons|ml|milliliter|milliliters|fl\s*oz|floz|fluid\s*oz|pint|pints|quart|quarts|gal|gallon|gallons|liter|liters|l)\b/i.test(normalized)) {
    return 'volume';
  }
  
  // Weight units
  if (/\b(g|gram|grams|kg|kilogram|kilograms|oz|ounce|ounces|lb|lbs|pound|pounds)\b/i.test(normalized)) {
    return 'weight';
  }
  
  // Everything else is a count unit
  return 'count';
}

/** Per-100g block as resolveFoodDetails returns it. */
export interface ResolvedNutritionPer100g {
  kcal100: number;
  protein100: number;
  carbs100: number;
  fat100: number;
  fiber100: number;
  sugar100: number;
  sodium100: number;
}

/**
 * True when a resolved per-100g block carries no nutrition at all.
 *
 * resolveFoodDetails starts from an all-zero literal and overwrites it only if
 * the food row is found AND that row has nutrients, so all-zero is how this
 * module spells "unknown" — it cannot distinguish that from a genuine zero.
 */
export function isDegenerateNutrition(n: ResolvedNutritionPer100g): boolean {
  return n.kcal100 === 0 && n.protein100 === 0 && n.carbs100 === 0 && n.fat100 === 0;
}

/**
 * True when the per-100g block cannot be reconciled with what the line bills.
 *
 * The client rescales a portion as `per100g x grams`, so the response carries
 * the calorie count twice and the two must agree. They come apart when grams is
 * not a real weight: a serving billed from its OWN macros (FatSecret's
 * "1 serving" restaurant rows) reports grams as an energy-density estimate, so
 * a tall flat white bills its true 170 kcal beside a kcal100 that implies 42.
 *
 * Compared on calories alone — it is the figure the split actually corrupts,
 * and the one every client path reads. The tolerance is deliberately loose:
 * ordinary rounding through `toFixed(1)` and per-100g storage drifts by a few
 * tenths, and re-deriving in that case would be churn. Both an absolute and a
 * relative floor must be cleared, so small totals (a 5 kcal black coffee)
 * cannot trip it on rounding alone.
 */
export function isPer100gInconsistentWithBilled(
  n: ResolvedNutritionPer100g,
  billed: { grams: number; kcal: number },
): boolean {
  if (!(billed.grams > 0)) return false;
  if (!(billed.kcal > 0)) return false;
  const implied = (n.kcal100 ?? 0) * (billed.grams / 100);
  const diff = Math.abs(implied - billed.kcal);
  return diff > 5 && diff > billed.kcal * 0.1;
}

/**
 * Per-100g values implied by a line's own billed macros.
 *
 * Used when the food row can't supply nutrition. The mapper is authoritative
 * for the line — it billed these macros off the candidate that actually won —
 * whereas resolveFoodDetails re-reads the food row, and the two disagree
 * whenever the row isn't there yet.
 *
 * That gap is routine, not exotic: fatsecret hits are written by a background
 * task (persistFatSecretHits), so the FIRST-EVER sighting of a fatsecret food
 * resolves against a row that does not exist or is still empty. Measured on
 * the box: a cold "kohlrabi fritters" returned a correct serving value of 53.5
 * kcal alongside kcal100 = 0; the very next identical request returned 357.
 * Since the mobile client rescales portions by multiplying kcal100
 * (api-contract §4), the user could log a food correctly and then zero it out
 * just by nudging the portion control.
 *
 * per100g * grams == the billed macros by construction, so a portion change
 * stays exactly consistent with what was shown even when `grams` is itself an
 * estimate (fatsecret restaurant items with no metric serving, where grams
 * comes from an energy-density guess). The absolute weight may be approximate;
 * the ratio is not.
 *
 * Returns null when there is nothing to derive from.
 */
export function per100gFromBilledMacros(billed: {
  grams: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}): Pick<ResolvedNutritionPer100g, 'kcal100' | 'protein100' | 'carbs100' | 'fat100'> | null {
  if (!(billed.grams > 0)) return null;
  if (!(billed.kcal > 0) && !(billed.protein > 0) && !(billed.carbs > 0) && !(billed.fat > 0)) {
    return null;
  }
  const factor = 100 / billed.grams;
  const round2 = (v: number) => Math.round(v * factor * 100) / 100;
  return {
    kcal100: round2(billed.kcal),
    protein100: round2(billed.protein),
    carbs100: round2(billed.carbs),
    fat100: round2(billed.fat),
  };
}

export async function resolveFoodDetails(foodId: string, matchedServingDescription?: string | null) {
  let name = '';
  let brandName: string | null = null;
  // NOT 'fatsecret'. Each of the four branches below assigns `source` only INSIDE its
  // `if (record found)` guard, so every unresolvable foodId — `water_default` (the
  // zero-calorie fast path, which matches no prefix and is not an AiGeneratedFood row), a
  // stale `fdc_` id, a purged `off_` barcode — kept this initializer and shipped
  // `source: 'fatsecret'`, putting FatSecret's licensed Web Badge on data they never
  // supplied while an attribution audit with them is open. An unidentified record must make
  // no provider claim; 'ai_estimated' is the only non-badging value in the contract union
  // (api-contract.md:506) and the only one the food_log_items CHECK accepts
  // (001_mobile_schema.sql:164), so it is the safe floor rather than a claim of AI origin.
  let source = 'ai_estimated';
  let nutritionPer100g = {
    kcal100: 0,
    protein100: 0,
    carbs100: 0,
    fat100: 0,
    fiber100: 0,
    sugar100: 0,
    sodium100: 0,
  };
  let rawServingOptions: Array<{ label: string; grams: number }> = [];

  if (foodId.startsWith('fdc_')) {
    const fdcId = parseInt(foodId.replace('fdc_', ''), 10);
    const fdcFood = await prisma.fdcFood.findUnique({
      where: { fdcId },
      include: { servings: true }
    });
    if (fdcFood) {
      name = fdcFood.description;
      brandName = fdcFood.brandName ?? null;
      source = 'fdc';
      const nutrients = (fdcFood.nutrientsPer100g as any) || {};
      nutritionPer100g = {
        kcal100: nutrients.calories ?? nutrients.kcal ?? nutrients.energy ?? 0,
        protein100: nutrients.protein ?? 0,
        carbs100: nutrients.carbs ?? nutrients.carbohydrate ?? 0,
        fat100: nutrients.fat ?? nutrients.totalFat ?? 0,
        fiber100: nutrients.fiber ?? 0,
        sugar100: nutrients.sugar ?? 0,
        sodium100: nutrients.sodium ?? 0,
      };
      
      const units = fdcFood.servings.map(s => ({
        label: s.description,
        grams: s.grams
      }));
      rawServingOptions = deriveServingOptions({
        units,
        densityGml: null,
        categoryId: null
      });
    }
  } else if (foodId.startsWith('off_')) {
    const barcode = foodId.replace('off_', '');
    const offFood = await prisma.offFood.findUnique({
      where: { barcode },
      include: { servings: true }
    });
    if (offFood) {
      name = offFood.name;
      brandName = offFood.brandName ?? null;
      source = 'openfoodfacts';
      const nutrients = (offFood.nutrientsPer100g as any) || {};
      nutritionPer100g = {
        kcal100: nutrients.kcal ?? nutrients.calories ?? nutrients.energy ?? 0,
        protein100: nutrients.protein ?? 0,
        carbs100: nutrients.carbs ?? nutrients.carbohydrate ?? 0,
        fat100: nutrients.fat ?? 0,
        fiber100: nutrients.fiber ?? 0,
        sugar100: nutrients.sugar ?? nutrients.sugars ?? 0,
        sodium100: nutrients.sodium ?? 0,
      };

      const parseIntServingGrams = offFood.servingGrams ? Number(offFood.servingGrams) : null;
      const units = offFood.servings.map(s => ({
        label: s.description,
        grams: s.grams
      }));
      if (parseIntServingGrams && !units.some(u => u.label.toLowerCase().includes('serving'))) {
        units.push({
          label: offFood.servingSize || '1 serving',
          grams: parseIntServingGrams
        });
      }

      rawServingOptions = deriveServingOptions({
        units,
        densityGml: null,
        categoryId: null
      });
    }
  } else if (foodId.startsWith('fs_')) {
    const fsId = foodId.replace('fs_', '');
    const fsFood = await prisma.fatSecretFood.findUnique({
      where: { fsId },
      include: { servings: true }
    });
    if (fsFood) {
      name = fsFood.name;
      brandName = fsFood.brandName ?? null;
      source = 'fatsecret';
      const nutrients = (fsFood.nutrientsPer100g as any) || {};
      nutritionPer100g = {
        kcal100: nutrients.calories ?? nutrients.kcal ?? 0,
        protein100: nutrients.protein ?? 0,
        carbs100: nutrients.carbs ?? nutrients.carbohydrate ?? 0,
        fat100: nutrients.fat ?? 0,
        fiber100: nutrients.fiber ?? 0,
        sugar100: nutrients.sugars ?? nutrients.sugar ?? 0,
        sodium100: nutrients.sodium ?? 0,
      };

      const units = fsFood.servings
        .filter(s => s.grams != null && s.grams > 0)
        .map(s => ({
          label: s.description,
          grams: s.grams as number
        }));
      rawServingOptions = deriveServingOptions({
        units,
        densityGml: null,
        categoryId: null
      });
    }
  } else {
    // AI generated food details lookup
    const aiFood = await prisma.aiGeneratedFood.findUnique({
      where: { id: foodId },
      include: { servings: true }
    });
    if (aiFood) {
      name = aiFood.displayName;
      brandName = null;
      source = 'ai_estimated';
      nutritionPer100g = {
        kcal100: aiFood.caloriesPer100g,
        protein100: aiFood.proteinPer100g,
        carbs100: aiFood.carbsPer100g,
        fat100: aiFood.fatPer100g,
        fiber100: aiFood.fiberPer100g ?? 0,
        sugar100: aiFood.sugarPer100g ?? 0,
        sodium100: aiFood.sodiumMgPer100g ?? 0,
      };
      
      const units = aiFood.servings.map(s => ({
        label: s.label,
        grams: s.grams
      }));
      rawServingOptions = deriveServingOptions({
        units,
        densityGml: null,
        categoryId: null
      });
    }
  }

  // Convert raw serving options to rich serving options
  let hasDefault = false;
  const servingOptions = rawServingOptions.map((o) => {
    const isMatched = matchedServingDescription && o.label.toLowerCase().trim() === matchedServingDescription.toLowerCase().trim();
    if (isMatched) hasDefault = true;
    return {
      label: o.label,
      grams: o.grams,
      type: getServingType(o.label),
      isDefault: !!isMatched,
    };
  });

  // Fallback to first serving option if no default was matched
  if (!hasDefault && servingOptions.length > 0) {
    servingOptions[0].isDefault = true;
  }

  return {
    name,
    brandName,
    source: source as 'fatsecret' | 'fdc' | 'openfoodfacts' | 'ai_estimated',
    nutritionPer100g,
    servingOptions,
  };
}
