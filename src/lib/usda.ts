/**
 * USDA FoodData Central API integration
 * Handles searching and normalizing food data from the FDC API
 */

import { FoodSource } from '@prisma/client';
import { RawFood, toPer100g, extractCategoryHint, validatePer100g } from './nutrition/normalize';

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
    
    for (const food of data.foods) {
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
    const categoryHint = extractCategoryHint(name, brand);
    
    // Create RawFood object for normalizer
    const rawFood: RawFood = {
      name,
      brand,
      energyKcal: nutrients.calories,
      energyKj: nutrients.energyKj,
      proteinG: nutrients.proteinG,
      carbsG: nutrients.carbsG,
      fatG: nutrients.fatG,
      fiberG: nutrients.fiberG,
      sugarG: nutrients.sugarG,
      servingSize: food.servingSize,
      servingSizeUnit: food.servingSizeUnit,
      gramWeight: getServingSizeInGrams(food),
      categoryHint
    };
    
    // Use robust normalizer
    const per100g = toPer100g(rawFood);
    if (!per100g) {
      console.log(`❌ Skipped: ${name} - no gram weight or normalization failed`);
      return null;
    }
    
    // Validate the result
    const validation = validatePer100g(per100g);
    if (!validation.valid) {
      console.log(`❌ Skipped: ${name} - ${validation.reason}`);
      return null;
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
