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
  labelNutrients?: {
    calories?: { value?: number | null };
    fat?: { value?: number | null };
    carbohydrates?: { value?: number | null };
    protein?: { value?: number | null };
    fiber?: { value?: number | null };
    sugars?: { value?: number | null };
  };
  foodPortions?: Array<{
    gramWeight?: number | null;
    modifier?: string | null;
    portionDescription?: string | null;
    measureUnit?: { name?: string | null } | null;
  }>;
  householdServingFullText?: string | null;
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
    const nutrients = extractNutrients(food);

    // Clean up name and brand
    const name = cleanFoodName(food.description);
    const brand = food.brandOwner || food.brandName || undefined;

    // Extract category hint for density calculations
    const categoryHint = extractCategoryHint(name, brand);

    const servingSize = coerceToNumber(food.servingSize);
    const servingSizeUnit = food.servingSizeUnit || undefined;
    const gramWeight = resolveGramWeight(food, categoryHint);

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
      servingSize: servingSize ?? undefined,
      servingSizeUnit,
      gramWeight: gramWeight ?? undefined,
      categoryHint,
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
 * Extract nutrition values from an FDC search result
 */
function extractNutrients(food: FDCSearchResult) {
  const nutrients: {
    calories?: number;
    energyKj?: number;
    proteinG?: number;
    carbsG?: number;
    fatG?: number;
    fiberG?: number;
    sugarG?: number;
  } = {};

  const label = food.labelNutrients;
  if (label) {
    if (label.calories?.value != null) nutrients.calories = label.calories.value;
    if (label.protein?.value != null) nutrients.proteinG = label.protein.value;
    if (label.carbohydrates?.value != null) nutrients.carbsG = label.carbohydrates.value;
    if (label.fat?.value != null) nutrients.fatG = label.fat.value;
    if (label.fiber?.value != null) nutrients.fiberG = label.fiber.value;
    if (label.sugars?.value != null) nutrients.sugarG = label.sugars.value;
  }

  for (const fn of food.foodNutrients || []) {
    const nutrientId = fn.nutrientId;
    const amount = fn.value ?? null;
    if (amount == null) continue;

    switch (nutrientId) {
      case 1008: // Energy (kcal)
        if (nutrients.calories == null) nutrients.calories = amount;
        break;
      case 1062: // Energy (kJ)
        if (nutrients.energyKj == null) nutrients.energyKj = amount;
        break;
      case 1003: // Protein (g)
        if (nutrients.proteinG == null) nutrients.proteinG = amount;
        break;
      case 1005: // Carbohydrate, by difference (g)
        if (nutrients.carbsG == null) nutrients.carbsG = amount;
        break;
      case 1004: // Total lipid (fat) (g)
        if (nutrients.fatG == null) nutrients.fatG = amount;
        break;
      case 1079: // Fiber, total dietary (g)
        if (nutrients.fiberG == null) nutrients.fiberG = amount;
        break;
      case 2000: // Sugars, total including NLEA (g)
        if (nutrients.sugarG == null) nutrients.sugarG = amount;
        break;
    }
  }

  return nutrients;
}

function coerceToNumber(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveGramWeight(food: FDCSearchResult, categoryHint?: string | null): number | null {
  const portionGram = pickPortionGramWeight(food);
  if (portionGram != null && portionGram > 0) {
    if (Math.abs(portionGram - 100) <= 0.5) return 100;
    return portionGram;
  }

  const textGram = extractGramWeightFromText(food.householdServingFullText);
  if (textGram != null && textGram > 0) {
    if (Math.abs(textGram - 100) <= 0.5) return 100;
    return textGram;
  }

  const servingSize = coerceToNumber(food.servingSize);
  if (!servingSize || servingSize <= 0) return null;

  const unit = (food.servingSizeUnit || '').toLowerCase().trim();
  if (!unit) return null;

  if (['g', 'gram', 'grams'].includes(unit)) {
    if (Math.abs(servingSize - 100) <= 0.5) return 100;
    return servingSize;
  }

  // let the density table handle household measures based on category hints
  if (['ml', 'milliliter', 'milliliters'].includes(unit)) {
    const hint = (categoryHint || '').toLowerCase();
    if (
      hint.includes('liquid') ||
      hint.includes('water') ||
      hint.includes('milk') ||
      hint.includes('broth') ||
      hint.includes('stock') ||
      hint.includes('juice')
    ) {
      return servingSize;
    }
  }

  return null;
}

function pickPortionGramWeight(food: FDCSearchResult): number | null {
  if (!food.foodPortions || food.foodPortions.length === 0) return null;

  let best: { gram: number; score: number } | null = null;

  for (const portion of food.foodPortions) {
    const gram = coerceToNumber(portion.gramWeight);
    if (!gram || gram <= 0) continue;

    const modifier = (portion.modifier || '').toLowerCase();
    const description = (portion.portionDescription || '').toLowerCase();
    const measureName = (portion.measureUnit?.name || '').toLowerCase();

    let score = 1;
    if (Math.abs(gram - 100) <= 0.5) score += 5;
    if (modifier.includes('100 g') || description.includes('100 g')) score += 5;
    if (measureName === 'g' || measureName === 'gram' || measureName === 'grams') score += 4;
    if (modifier.includes('serving') || description.includes('serving')) score += 2;
    if (modifier.includes('tbsp') || description.includes('tbsp')) score += 1;

    if (!best || score > best.score) {
      best = { gram, score };
    }
  }

  return best?.gram ?? null;
}

function extractGramWeightFromText(text?: string | null): number | null {
  if (!text) return null;
  const match = text.match(/([\d.]+)\s*g/i);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) && value > 0 ? value : null;
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
