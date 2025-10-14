import { prisma } from '../db';
import { FoodSource } from '@prisma/client';
import { servingToGrams, extractCategoryHint } from './normalize';

export interface NutritionTotals {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sugarG: number;
}

export interface NutritionScore {
  score: number;
  breakdown: {
    proteinScore: number;
    carbScore: number;
    fatScore: number;
    fiberScore: number;
    sugarScore: number;
  };
}

export type NutritionGoal = 'general' | 'weight_loss' | 'muscle_gain' | 'maintenance';

// Unit conversion factors to grams
const UNIT_CONVERSIONS: Record<string, number> = {
  // Weight units
  'g': 1,
  'gram': 1,
  'grams': 1,
  'kg': 1000,
  'kilogram': 1000,
  'kilograms': 1000,
  'lb': 453.592,
  'pound': 453.592,
  'pounds': 453.592,
  'oz': 28.3495,
  'ounce': 28.3495,
  'ounces': 28.3495,
  
  // Volume units (approximate conversions to grams for common ingredients)
  'ml': 1, // assuming 1ml = 1g for most liquids
  'milliliter': 1,
  'milliliters': 1,
  'l': 1000,
  'liter': 1000,
  'liters': 1000,
  'cup': 240, // 1 cup ≈ 240ml ≈ 240g for water
  'cups': 240,
  'tbsp': 15, // 1 tablespoon ≈ 15ml ≈ 15g
  'tablespoon': 15,
  'tablespoons': 15,
  'tsp': 5, // 1 teaspoon ≈ 5ml ≈ 5g
  'teaspoon': 5,
  'teaspoons': 5,
  
  // Count units (approximate weights)
  'piece': 50, // average piece weight
  'pieces': 50,
  'slice': 25, // average slice weight
  'slices': 25,
  'medium': 150, // average medium item
  'large': 200, // average large item
  'small': 100, // average small item
};

/**
 * Convert ingredient quantity to grams based on unit using robust normalizer
 */
export function convertUnit(qty: number, unit: string, ingredientName?: string): number {
  // Create a RawFood object for the normalizer
  const rawFood = {
    name: ingredientName || '',
    brand: null,
    servingSize: qty,
    servingSizeUnit: unit,
    gramWeight: null,
    categoryHint: ingredientName ? extractCategoryHint(ingredientName) : null
  };
  
  // Use the robust normalizer to get grams
  const grams = servingToGrams(rawFood);
  
  if (grams !== null && grams > 0) {
    return grams;
  }
  
  // Fallback to old conversion system for unknown cases
  const normalizedUnit = unit.toLowerCase().trim();
  const conversionFactor = UNIT_CONVERSIONS[normalizedUnit];
  
  if (conversionFactor === undefined) {
    // If unit is unknown, assume it's already in grams
    console.warn(`Unknown unit: ${unit}, assuming grams`);
    return qty;
  }
  
  return qty * conversionFactor;
}

/**
 * Compute nutrition totals for a recipe
 */
export async function computeTotals(recipeId: string): Promise<NutritionTotals> {
  const ingredients = await prisma.ingredient.findMany({
    where: { recipeId },
    include: {
      foodMaps: {
        include: {
          food: true
        }
      }
    }
  });

  let totals: NutritionTotals = {
    calories: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    fiberG: 0,
    sugarG: 0
  };

  for (const ingredient of ingredients) {
    // Convert ingredient quantity to grams using robust normalizer
    const grams = convertUnit(ingredient.qty, ingredient.unit, ingredient.name);
    
    // Find the best food mapping (highest confidence)
    const bestMapping = ingredient.foodMaps
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];
    
    if (bestMapping?.food) {
      const food = bestMapping.food;
      const multiplier = grams / 100; // Convert to per-100g basis
      
      totals.calories += food.calories * multiplier;
      totals.proteinG += food.proteinG * multiplier;
      totals.carbsG += food.carbsG * multiplier;
      totals.fatG += food.fatG * multiplier;
      totals.fiberG += food.fiberG * multiplier;
      totals.sugarG += food.sugarG * multiplier;
    }
  }

  // Round to reasonable precision
  return {
    calories: Math.round(totals.calories),
    proteinG: Math.round(totals.proteinG * 10) / 10,
    carbsG: Math.round(totals.carbsG * 10) / 10,
    fatG: Math.round(totals.fatG * 10) / 10,
    fiberG: Math.round(totals.fiberG * 10) / 10,
    sugarG: Math.round(totals.sugarG * 10) / 10,
  };
}

/**
 * Calculate health score based on nutrition totals and goal
 */
export function scoreV1(totals: NutritionTotals, goal: NutritionGoal = 'general'): NutritionScore {
  const { calories, proteinG, carbsG, fatG, fiberG, sugarG } = totals;
  
  // Goal-specific scoring weights
  const goalWeights = {
    general: { protein: 0.3, carbs: 0.3, fat: 0.2, fiber: 0.1, sugar: 0.1 },
    weight_loss: { protein: 0.4, carbs: 0.2, fat: 0.2, fiber: 0.15, sugar: 0.05 },
    muscle_gain: { protein: 0.5, carbs: 0.3, fat: 0.15, fiber: 0.05, sugar: 0.0 },
    maintenance: { protein: 0.3, carbs: 0.3, fat: 0.25, fiber: 0.1, sugar: 0.05 }
  };
  
  const weights = goalWeights[goal];
  
  // Protein score (0-100): Higher protein is better
  const proteinScore = Math.min(100, (proteinG / calories * 1000) * 10);
  
  // Carb score (0-100): Moderate carbs are good, too high is bad
  const carbRatio = carbsG / calories * 1000;
  const carbScore = carbRatio < 0.6 ? 100 : Math.max(0, 100 - (carbRatio - 0.6) * 200);
  
  // Fat score (0-100): Moderate fat is good
  const fatRatio = fatG / calories * 1000;
  const fatScore = fatRatio < 0.3 ? 100 : Math.max(0, 100 - (fatRatio - 0.3) * 150);
  
  // Fiber score (0-100): Higher fiber is better
  const fiberScore = Math.min(100, fiberG * 10);
  
  // Sugar score (0-100): Lower sugar is better
  const sugarScore = Math.max(0, 100 - sugarG * 20);
  
  const breakdown = {
    proteinScore: Math.round(proteinScore),
    carbScore: Math.round(carbScore),
    fatScore: Math.round(fatScore),
    fiberScore: Math.round(fiberScore),
    sugarScore: Math.round(sugarScore)
  };
  
  const score = Math.round(
    breakdown.proteinScore * weights.protein +
    breakdown.carbScore * weights.carbs +
    breakdown.fatScore * weights.fat +
    breakdown.fiberScore * weights.fiber +
    breakdown.sugarScore * weights.sugar
  );
  
  return { score, breakdown };
}

/**
 * Compute and save nutrition data for a recipe
 */
export async function computeRecipeNutrition(
  recipeId: string, 
  goal: NutritionGoal = 'general'
): Promise<{ totals: NutritionTotals; score: NutritionScore; unmappedIngredients: string[] }> {
  // Get all ingredients to check for unmapped ones
  const ingredients = await prisma.ingredient.findMany({
    where: { recipeId },
    include: {
      foodMaps: true
    }
  });
  
  const unmappedIngredients = ingredients
    .filter(ing => ing.foodMaps.length === 0)
    .map(ing => ing.name);
  
  // Compute totals
  const totals = await computeTotals(recipeId);
  
  // Calculate health score
  const score = scoreV1(totals, goal);
  
  // Save to database
  await prisma.nutrition.upsert({
    where: { recipeId },
    update: {
      calories: totals.calories,
      proteinG: totals.proteinG,
      carbsG: totals.carbsG,
      fatG: totals.fatG,
      fiberG: totals.fiberG,
      sugarG: totals.sugarG,
      healthScore: score.score,
      goal,
      computedAt: new Date()
    },
    create: {
      recipeId,
      calories: totals.calories,
      proteinG: totals.proteinG,
      carbsG: totals.carbsG,
      fatG: totals.fatG,
      fiberG: totals.fiberG,
      sugarG: totals.sugarG,
      healthScore: score.score,
      goal
    }
  });
  
  return { totals, score, unmappedIngredients };
}

/**
 * Get unmapped ingredients for a recipe
 */
export async function getUnmappedIngredients(recipeId: string): Promise<Array<{ id: string; name: string; qty: number; unit: string }>> {
  const ingredients = await prisma.ingredient.findMany({
    where: { recipeId },
    include: {
      foodMaps: true
    }
  });
  
  return ingredients
    .filter(ing => ing.foodMaps.length === 0)
    .map(ing => ({
      id: ing.id,
      name: ing.name,
      qty: ing.qty,
      unit: ing.unit
    }));
}
