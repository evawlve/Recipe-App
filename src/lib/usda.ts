/**
 * USDA FoodData Central API integration
 * Handles searching and normalizing food data from the FDC API
 */

import { FoodSource } from '@prisma/client';
import { RawFood, toPer100g, validatePer100g, DEBUG } from './nutrition/normalize';
import { extractCategoryHint } from './nutrition/serving';

/**
 * Filter foods for ingredient-only queries (e.g., "corn starch")
 */
function filterIngredientOnly(foods: FDCSearchResult[], ingredient: string): FDCSearchResult[] {
  const ingredientLower = ingredient.toLowerCase();
  
  // Define scoring patterns
  const mustMatch = [/^corn\s*starch$/, /^cornstarch$/];
  const goodHints = [/^corn\s*starch/, /\bcornstarch\b/];
  const badHints = [/bread|rolls?|crackers?|cookies?|cand(y|ies)|jelly|gumdrop|rice flour|tapioca|potato starch|sorghum|whole grain/i];
  
  const scoredFoods = foods.map(food => {
    const name = `${food.brandName || ''} ${food.description}`.toLowerCase().trim();
    let score = 0;
    
    // Must match patterns (exact ingredient)
    if (mustMatch.some(pattern => pattern.test(name))) {
      score += 100;
    } else if (goodHints.some(pattern => pattern.test(name))) {
      score += 50;
    }
    
    // Bad hints (processed foods, not pure ingredient)
    if (badHints.some(pattern => pattern.test(name))) {
      score -= 60;
    }
    
    return { food, score };
  });
  
  // Filter out negative scores and sort by score
  const filtered = scoredFoods
    .filter(item => item.score >= 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10) // Keep top 10
    .map(item => item.food);
  
  if (DEBUG) {
    console.log(`🔍 Ingredient filtering: ${foods.length} → ${filtered.length} results`);
    scoredFoods
      .filter(item => item.score >= 0)
      .slice(0, 5)
      .forEach(item => {
        console.log(`  📊 Score ${item.score}: ${item.food.description}`);
      });
  }
  
  return filtered;
}

export interface FDCFood {
  name: string;
  brand?: string;
  per100g: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG: number;
    sugarG: number;
  };
  fdcId: string;
  source: FoodSource;
}

export interface FDCSearchResult {
  fdcId: number;
  description: string;
  brandOwner?: string;
  brandName?: string;
  dataType: string;
  foodNutrients?: Array<{
    nutrientId: number;
    nutrientName: string;
    value: number;
  }>;
  servingSize?: number;
  servingSizeUnit?: string;
}

export interface FDCSearchResponse {
  foods: FDCSearchResult[];
  totalHits: number;
  currentPage: number;
  totalPages: number;
}

/**
 * Search foods using USDA FoodData Central API with Branded-first strategy
 */
export async function searchFoods(query: string): Promise<FDCFood[]> {
  const apiKey = process.env.FDC_API_KEY;
  
  if (!apiKey) {
    console.warn('FDC_API_KEY not found, skipping USDA search');
    return [];
  }

  try {
    // Step 1: Try Branded foods first
    console.log(`🔍 Searching USDA Branded foods for: "${query}"`);
    const brandedFoods = await searchFDCFoods(query, 'Branded', apiKey);
    
    if (brandedFoods.length >= 10) {
      console.log(`📊 Found ${brandedFoods.length} Branded foods, returning top 10`);
      return brandedFoods.slice(0, 10);
    }
    
    // Step 2: If < 10 Branded results, add Foundation/SR Legacy
    console.log(`🔍 Only ${brandedFoods.length} Branded results, searching Foundation/SR Legacy`);
    const foundationFoods = await searchFDCFoods(query, 'Foundation,SR%20Legacy', apiKey);
    
    // Combine and deduplicate results
    const allFoods = [...brandedFoods];
    const seenFdcIds = new Set(brandedFoods.map(f => f.fdcId));
    
    for (const food of foundationFoods) {
      if (!seenFdcIds.has(food.fdcId)) {
        allFoods.push(food);
        seenFdcIds.add(food.fdcId);
      }
    }
    
    console.log(`📊 Final combined results: ${allFoods.length} (${brandedFoods.length} Branded + ${allFoods.length - brandedFoods.length} Foundation/SR)`);
    
    // If no results for corn starch, add generic fallback
    if (query.toLowerCase().includes('corn starch') && allFoods.length === 0) {
      const genericCornStarch: FDCFood = {
        name: 'Corn Starch (generic)',
        brand: undefined,
        source: 'MANUAL',
        fdcId: 'generic-corn-starch',
        per100g: {
          calories: 381,
          proteinG: 0.3,
          carbsG: 91.3,
          fatG: 0.1,
          fiberG: 0,
          sugarG: 0
        }
      };
      allFoods.unshift(genericCornStarch); // Add to beginning
      console.log(`🔧 Added generic corn starch fallback`);
    }
    
    return allFoods.slice(0, 10);
  } catch (error) {
    console.error('Error searching FDC foods:', error);
    return [];
  }
}

/**
 * Search FDC foods with specific data types
 */
async function searchFDCFoods(query: string, dataType: string, apiKey: string): Promise<FDCFood[]> {
  try {
    const response = await fetch(
      `https://api.nal.usda.gov/fdc/v1/foods/search?api_key=${apiKey}&query=${encodeURIComponent(query)}&dataType=${dataType}&pageSize=20`,
      {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
        },
      }
    );

    if (!response.ok) {
      console.error('FDC API error:', response.status, response.statusText);
      return [];
    }

    const data: FDCSearchResponse = await response.json();
    
    if (!data.foods || data.foods.length === 0) {
      return [];
    }

    // Normalize and filter foods
    const normalizedFoods: FDCFood[] = [];
    
    console.log(`🔍 Processing ${data.foods.length} FDC foods (${dataType}) for query: "${query}"`);
    
    // Apply ingredient-only filtering for specific queries
    let filteredFoods = data.foods;
    if (query.toLowerCase().includes('corn starch') || query.toLowerCase().includes('cornstarch')) {
      filteredFoods = filterIngredientOnly(data.foods, 'corn starch');
      console.log(`🔍 Filtered to ${filteredFoods.length} ingredient-only results for corn starch`);
    }
    
    for (const food of filteredFoods) {
      const normalized = await normalizeFDCFood(food);
      if (normalized) {
        normalizedFoods.push(normalized);
        console.log(`✅ Normalized: ${normalized.name} (${normalized.brand || 'No brand'}) - ${normalized.source}`);
      } else {
        console.log(`❌ Skipped: ${food.description} - failed normalization`);
      }
    }

    console.log(`📊 Normalized ${dataType} foods: ${normalizedFoods.length}`);
    return normalizedFoods;
  } catch (error) {
    console.error(`Error searching FDC ${dataType} foods:`, error);
    return [];
  }
}

/**
 * Normalize FDC food data to per-100g nutrition values using robust normalizer
 */
async function normalizeFDCFood(food: FDCSearchResult): Promise<FDCFood | null> {
  try {
    // Extract nutrition data
    const nutrients = extractNutrients(food.foodNutrients || []);
    
    // Clean up name and brand
    const name = cleanFoodName(food.description);
    const brand = food.brandOwner || food.brandName || undefined;
    
    // Extract category hint for density calculations
    let categoryHint = extractCategoryHint(name, brand);
    
    // Ensure starch/flour detection
    if (!categoryHint && (name.toLowerCase().includes('starch') || name.toLowerCase().includes('flour'))) {
      categoryHint = 'flour';
    }
    
    // Specific corn starch detection
    if (name.toLowerCase().includes('corn starch') || name.toLowerCase().includes('cornstarch')) {
      categoryHint = 'flour';
    }
    
    // Robust per-100g detection
    const isPer100g = 
      food.dataType === "SR Legacy" || food.dataType === "Foundation" ||
      // Branded sometimes exposes "servingSizeUnit" = "g" and "servingSize" = 100
      (food.servingSizeUnit?.toLowerCase() === "g" && Math.abs((food.servingSize || 0) - 100) <= 0.5) ||
      // Check if description mentions per 100g
      food.description?.match(/per\s*100\s*g/i);
    
    let gramWeight: number | null = null;
    let rawNutrients = nutrients;
    
    if (isPer100g) {
      // Use nutrient amounts AS IS, and mark gramWeight = 100 for the normalizer
      gramWeight = 100;
      if (DEBUG) {
        console.log(`📊 [USDA] Already per-100g: ${name} (${food.dataType})`);
      }
    } else {
      // Branded: use labelNutrients + servingSize(+Unit) or household gramWeight
      gramWeight = getServingSizeInGrams(food);
      if (DEBUG) {
        if (gramWeight && gramWeight > 0) {
          console.log(`📊 [USDA] Per serving: ${name} (${gramWeight}g per serving)`);
        } else {
          console.log(`❌ [USDA] SKIP: no gram weight for ${name}`);
          return null;
        }
      }
    }
    
    // Create RawFood object for normalizer
    const rawFood: RawFood = {
      name,
      brand,
      energyKcal: rawNutrients.calories,
      energyKj: rawNutrients.energyKj,
      proteinG: rawNutrients.proteinG,
      carbsG: rawNutrients.carbsG,
      fatG: rawNutrients.fatG,
      fiberG: rawNutrients.fiberG,
      sugarG: rawNutrients.sugarG,
      servingSize: food.servingSize,
      servingSizeUnit: food.servingSizeUnit,
      gramWeight,
      categoryHint
    };
    
    // Use robust normalizer
    const per100g = toPer100g(rawFood);
    if (!per100g) {
      if (DEBUG) {
        console.log(`❌ [USDA] Skipped: ${name} - no gram weight or normalization failed`);
      }
      return null;
    }
    
    // Filter out zero-calorie rows
    const allZero = (!per100g.calories || per100g.calories === 0) && per100g.proteinG === 0 && per100g.carbsG === 0 && per100g.fatG === 0;
    if (allZero) {
      if (DEBUG) {
        console.log(`❌ [USDA] SKIP zero-cal row: ${name}`);
      }
      return null;
    }
    
    // Oil sanity check
    if (per100g.fatG >= 99 && (per100g.calories < 860 || per100g.calories > 900)) {
      per100g.calories = Math.round(9 * per100g.fatG);
      // reconcile carbs so 4P+4C+9F ~= calories
      per100g.carbsG = Math.max(0, Math.min(100, (per100g.calories - (4 * per100g.proteinG + 9 * per100g.fatG)) / 4));
      per100g.fiberG = Math.min(per100g.fiberG, per100g.carbsG);
      if (DEBUG) {
        console.log(`🔧 [USDA] Oil sanity applied: ${per100g.calories} kcal from ${per100g.fatG}g fat`);
      }
    }
    
    // Starch sanity check
    if (categoryHint?.toLowerCase().includes('starch') || name.toLowerCase().includes('starch')) {
      // Starch should be mostly carbs with minimal fat/protein
      if (per100g.carbsG < 80 && per100g.fatG > 5) {
        // Likely misnormalized - adjust to realistic starch values
        per100g.carbsG = Math.max(80, Math.min(100, per100g.carbsG + per100g.fatG));
        per100g.fatG = Math.min(2, per100g.fatG);
        per100g.proteinG = Math.min(5, per100g.proteinG);
        // Recalculate calories from adjusted macros
        per100g.calories = Math.round(4 * per100g.proteinG + 4 * per100g.carbsG + 9 * per100g.fatG);
        if (DEBUG) {
          console.log(`🔧 [USDA] Starch sanity applied: ${per100g.calories} kcal, ${per100g.carbsG}g carbs, ${per100g.fatG}g fat`);
        }
      }
    }
    
    // Server-side safety checks
    // For flour/starch, reject implausible values
    if (categoryHint?.toLowerCase().includes('flour') || categoryHint?.toLowerCase().includes('starch')) {
      if (per100g.calories > 600 || per100g.carbsG > 120) {
        if (DEBUG) {
          console.log(`❌ [USDA] SKIP flour/starch: implausible values (${per100g.calories} kcal, ${per100g.carbsG}g carbs)`);
        }
        return null;
      }
    }
    
    // For oils, ensure proper calorie range
    if (per100g.fatG >= 99) {
      if (per100g.calories < 860 || per100g.calories > 900) {
        per100g.calories = Math.round(9 * per100g.fatG);
        per100g.calories = Math.max(860, Math.min(900, per100g.calories));
        if (DEBUG) {
          console.log(`🔧 [USDA] Oil calories corrected: ${per100g.calories} kcal from ${per100g.fatG}g fat`);
        }
      }
    }
    
    // Validate the result
    const validation = validatePer100g(per100g);
    if (!validation.valid) {
      if (DEBUG) {
        console.log(`❌ [USDA] Skipped: ${name} - ${validation.reason}`);
      }
      return null;
    }
    
    if (DEBUG) {
      console.log(`✅ [USDA] Successfully normalized: ${name} (${brand || 'No brand'})`);
    }

    // Determine source
    let source: FoodSource;
    switch (food.dataType) {
      case 'Branded':
        source = 'FDC_BRANDED' as FoodSource;
        break;
      case 'Foundation':
        source = 'FDC_FOUNDATION' as FoodSource;
        break;
      case 'SR Legacy':
        source = 'FDC_SR_LEGACY' as FoodSource;
        break;
      default:
        source = 'FDC_FOUNDATION' as FoodSource;
    }

    return {
      name,
      brand,
      per100g,
      fdcId: food.fdcId.toString(),
      source,
    };
  } catch (error) {
    console.error('Error normalizing FDC food:', error, food);
    return null;
  }
}

/**
 * Extract nutrition values from FDC food nutrients array
 */
function extractNutrients(foodNutrients: Array<{ nutrientId: number; nutrientName: string; value: number }>) {
  const nutrients: {
    calories?: number;
    energyKj?: number;
    proteinG?: number;
    carbsG?: number;
    fatG?: number;
    fiberG?: number;
    sugarG?: number;
  } = {};

  for (const fn of foodNutrients) {
    const nutrientId = fn.nutrientId;
    const amount = fn.value || 0;

    // FDC nutrient IDs (these are the standard ones)
    switch (nutrientId) {
      case 1008: // Energy (kcal)
        nutrients.calories = amount;
        break;
      case 1062: // Energy (kJ)
        nutrients.energyKj = amount;
        break;
      case 1003: // Protein (g)
        nutrients.proteinG = amount;
        break;
      case 1005: // Carbohydrate, by difference (g)
        nutrients.carbsG = amount;
        break;
      case 1004: // Total lipid (fat) (g)
        nutrients.fatG = amount;
        break;
      case 1079: // Fiber, total dietary (g)
        nutrients.fiberG = amount;
        break;
      case 2000: // Sugars, total including NLEA (g)
        nutrients.sugarG = amount;
        break;
    }
  }

  return nutrients;
}

/**
 * Convert serving size to grams
 */
function getServingSizeInGrams(food: FDCSearchResult): number | null {
  const servingSize = food.servingSize;
  const servingSizeUnit = food.servingSizeUnit;

  if (!servingSize || !servingSizeUnit) {
    return null;
  }

  // Convert to grams based on unit
  const unit = servingSizeUnit.toLowerCase();
  const size = parseFloat(servingSize.toString());

  switch (unit) {
    case 'g':
    case 'gram':
    case 'grams':
    case 'grm':
      return size;
    case 'kg':
    case 'kilogram':
    case 'kilograms':
      return size * 1000;
    case 'oz':
    case 'ounce':
    case 'ounces':
      return size * 28.3495;
    case 'lb':
    case 'pound':
    case 'pounds':
      return size * 453.592;
    case 'ml':
    case 'milliliter':
    case 'milliliters':
      // Assume 1ml = 1g for liquids (approximation)
      return size;
    case 'l':
    case 'liter':
    case 'liters':
      return size * 1000;
    case 'cup':
    case 'cups':
      // Assume 1 cup = 240ml = 240g (approximation)
      return size * 240;
    case 'tbsp':
    case 'tablespoon':
    case 'tablespoons':
      return size * 15; // 1 tbsp = 15ml
    case 'tsp':
    case 'teaspoon':
    case 'teaspoons':
      return size * 5; // 1 tsp = 5ml
    default:
      console.warn(`Unknown serving size unit: ${servingSizeUnit}`);
      return null;
  }
}

/**
 * Clean and normalize food name
 */
function cleanFoodName(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ') // Replace multiple spaces with single space
    .replace(/[^\w\s\-&]/g, '') // Remove special characters except word chars, spaces, hyphens, and &
    .substring(0, 100); // Limit length
}
