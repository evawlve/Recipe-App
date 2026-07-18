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

export async function resolveFoodDetails(foodId: string, matchedServingDescription?: string | null) {
  let name = '';
  let brandName: string | null = null;
  let source = 'fatsecret';
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
