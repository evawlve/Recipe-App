import { prisma } from '../db';
// import { FoodSource } from '@prisma/client'; // Not needed - source is just a string
import { servingToGrams, extractCategoryHint } from './normalize';
import { logger } from '../logger';
import { HEALTH_SCORE_V2, ENABLE_PORTION_V2 } from '../flags';
import { scoreV2 } from './score-v2';
import { resolvePortion, PortionSource } from './portion';

export interface NutritionTotals {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  fiberG: number;
  sugarG: number;
}

export interface NutritionScore {
  value: number;
  label: string;
  breakdown: {
    proteinDensity?: number;
    macroBalance?: number;
    fiber?: number;
    sugar?: number;
    // Legacy v1 breakdown fields
    proteinScore?: number;
    carbScore?: number;
    fatScore?: number;
    fiberScore?: number;
    sugarScore?: number;
  };
}

export interface ProvisionalInfo {
  provisional: boolean;
  provisionalReasons: string[];
}

export interface PortionTraceEntry {
  ingredientId: string;
  ingredientName: string;
  foodId?: string;
  qty: number;
  unit?: string | null;
  grams: number;
  source: PortionSource | 'fallback';
  confidence: number;
  tier: number;
  notes?: string;
}

export interface PortionResolutionStats {
  enabled: boolean;
  totalIngredients: number;
  resolvedCount: number;
  fallbackCount: number;
  avgConfidence: number | null;
  bySource: Record<string, number>;
  sample: PortionTraceEntry[];
}

export interface ComputeTotalsOptions {
  userId?: string;
  enablePortionV2?: boolean;
  recordSamples?: boolean;
}

export type ComputeTotalsResult = NutritionTotals & {
  provisional: ProvisionalInfo;
  lowConfidenceShare: number;
  unmappedCount: number;
  portionStats?: PortionResolutionStats;
};

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
  'scoop': 30, // typical protein powder scoop
  'scoops': 30, // typical protein powder scoop
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
 * Compute nutrition totals for a recipe with provisional tracking
 */
export async function computeTotals(
  recipeId: string,
  options: ComputeTotalsOptions = {}
): Promise<ComputeTotalsResult> {
  const { userId, enablePortionV2, recordSamples = true } = options;
  const usePortionV2 = enablePortionV2 ?? ENABLE_PORTION_V2;

  const foodInclude = usePortionV2
    ? {
        units: true,
        portionOverrides: true,
      }
    : {
        units: true,
      };

  const ingredients = await prisma.ingredient.findMany({
    where: { recipeId },
    include: {
      foodMaps: {
        include: {
          food: {
            include: foodInclude as any
          }
        }
      }
    }
  });

  const ingredientContexts = ingredients.map(ingredient => {
    const bestMapping = ingredient.foodMaps
      .slice()
      .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0];
    return { ingredient, bestMapping };
  });

  let userOverridesMap: Map<string, Array<{ unit: string; grams: number; label: string | null }>> | null = null;
  if (usePortionV2 && userId) {
    const foodIds = Array.from(
      new Set(
        ingredientContexts
          .map(ctx => ctx.bestMapping?.food?.id)
          .filter((id): id is string => Boolean(id))
      )
    );

    if (foodIds.length > 0) {
      const overrides = await prisma.userPortionOverride.findMany({
        where: {
          userId,
          foodId: { in: foodIds }
        }
      });

      userOverridesMap = new Map();
      for (const override of overrides) {
        if (!userOverridesMap.has(override.foodId)) {
          userOverridesMap.set(override.foodId, []);
        }
        userOverridesMap.get(override.foodId)!.push({
          unit: override.unit,
          grams: override.grams,
          label: override.label ?? null
        });
      }
    }
  }

  let totals: NutritionTotals = {
    calories: 0,
    proteinG: 0,
    carbsG: 0,
    fatG: 0,
    fiberG: 0,
    sugarG: 0
  };

  let totalCal = 0;
  let lowConfCal = 0;
  let unmappedCount = 0;

  let portionStats: PortionResolutionStats | undefined;
  let portionConfidenceSum = 0;

  if (usePortionV2) {
    portionStats = {
      enabled: true,
      totalIngredients: 0,
      resolvedCount: 0,
      fallbackCount: 0,
      avgConfidence: null,
      bySource: {},
      sample: []
    };
  }

  const { parseIngredientLine } = await import('../parse/ingredient-line');
  const { deriveServingOptions } = await import('../units/servings');
  const { resolveGramsFromParsed } = await import('./resolve-grams');

  for (const { ingredient, bestMapping } of ingredientContexts) {
    
    if (bestMapping?.food) {
      if (portionStats) {
        portionStats.totalIngredients += 1;
      }
      const food = bestMapping.food;
      
      let grams: number;
      const ingredientLine = ingredient.unit 
        ? `${ingredient.qty} ${ingredient.unit} ${ingredient.name}`
        : `${ingredient.qty} ${ingredient.name}`;
      
      const parsed = parseIngredientLine(ingredientLine);
      let resolution: ReturnType<typeof resolvePortion> | null = null;

      if (usePortionV2 && parsed) {
        // Type assertion needed because Prisma's include creates union types
        const foodUnits = (food as any).units as Array<{ label: string; grams: number }> | undefined;
        const foodPortionOverrides = (food as any).portionOverrides as Array<{ unit: string; grams: number; label: string | null }> | undefined;
        
        resolution = resolvePortion({
          food: {
            id: food.id,
            name: food.name,
            densityGml: food.densityGml ?? undefined,
            categoryId: food.categoryId ?? null,
            units: foodUnits?.map(u => (u ? { label: u.label, grams: u.grams } : null)) ?? [],
            portionOverrides: foodPortionOverrides?.map(o =>
              o
                ? {
                    unit: o.unit,
                    grams: o.grams,
                    label: o.label ?? null
                  }
                : null
            ) ?? []
          },
          parsed,
          userOverrides: userOverridesMap?.get(food.id) ?? null
        });
      }

      if (resolution && resolution.grams !== null && resolution.grams > 0) {
        grams = resolution.grams;
      } else if (parsed) {
        // Type assertion for units (Prisma include creates union types)
        const foodUnits = (food as any).units as Array<{ label: string; grams: number }> | undefined;
        const servingOptions = deriveServingOptions({
          units: foodUnits?.map(u => ({ label: u.label, grams: u.grams })),
          densityGml: food.densityGml ?? undefined,
          categoryId: food.categoryId ?? null,
        });
        
        // Try to resolve using parsed data and serving options
        const resolvedGrams = resolveGramsFromParsed(parsed, servingOptions);
        
        if (resolvedGrams !== null && resolvedGrams > 0) {
          grams = resolvedGrams;
        } else {
          // Fallback to old conversion if resolution fails
          grams = convertUnit(ingredient.qty, ingredient.unit, ingredient.name);
        }
      } else {
        // Fallback if parsing fails
        grams = convertUnit(ingredient.qty, ingredient.unit, ingredient.name);
      }

      if (portionStats) {
        const usedNewResolver = Boolean(
          resolution && resolution.grams !== null && resolution.grams > 0
        );
        const source = usedNewResolver && resolution
          ? resolution.source
          : ('fallback' as PortionSource | 'fallback');
        const confidence = usedNewResolver && resolution ? resolution.confidence : 0;
        portionStats.bySource[source] = (portionStats.bySource[source] || 0) + 1;

        if (usedNewResolver) {
          portionStats.resolvedCount += 1;
          portionConfidenceSum += resolution!.confidence;
        } else {
          portionStats.fallbackCount += 1;
        }

        if (recordSamples && portionStats.sample.length < 5) {
          portionStats.sample.push({
            ingredientId: ingredient.id,
            ingredientName: ingredient.name,
            foodId: food.id,
            qty: ingredient.qty,
            unit: ingredient.unit,
            grams,
            source,
            confidence,
            tier: resolution?.tier ?? 0,
            notes: resolution?.notes
          });
        }
      }
      
      const multiplier = grams / 100; // Convert to per-100g basis
      
      const ingredientCalories = food.kcal100 * multiplier;
      totals.calories += ingredientCalories;
      totals.proteinG += food.protein100 * multiplier;
      totals.carbsG += food.carbs100 * multiplier;
      totals.fatG += food.fat100 * multiplier;
      totals.fiberG += (food.fiber100 || 0) * multiplier;
      totals.sugarG += (food.sugar100 || 0) * multiplier;

      // Track calories for provisional calculation
      totalCal += ingredientCalories;
      
      // Check if this mapping is low confidence or use-once
      const isLowConfidence = (bestMapping.confidence || 0) < 0.5;
      const isUseOnce = bestMapping.useOnce || false;
      
      if (isLowConfidence || isUseOnce) {
        lowConfCal += ingredientCalories;
      }
    } else {
      unmappedCount++;
    }
  }

  // Calculate provisional status
  const lowShare = totalCal > 0 ? lowConfCal / totalCal : 0;
  const provisional = (unmappedCount > 0) || (lowShare >= 0.30);
  
  const provisionalReasons: string[] = [];
  if (unmappedCount > 0) {
    provisionalReasons.push(`${unmappedCount} unmapped ingredient${unmappedCount > 1 ? 's' : ''}`);
  }
  if (lowShare >= 0.30) {
    provisionalReasons.push(`${Math.round(lowShare * 100)}% from low-confidence mappings`);
  }

  if (portionStats) {
    portionStats.avgConfidence = portionStats.resolvedCount > 0
      ? Number((portionConfidenceSum / portionStats.resolvedCount).toFixed(3))
      : null;

    logger.info('portion_resolver.summary', {
      recipeId,
      resolved: portionStats.resolvedCount,
      fallback: portionStats.fallbackCount,
      total: portionStats.totalIngredients,
      avgConfidence: portionStats.avgConfidence,
      bySource: portionStats.bySource
    });
  }

  // Round to reasonable precision
  const result: ComputeTotalsResult = {
    calories: Math.round(totals.calories),
    proteinG: Math.round(totals.proteinG * 10) / 10,
    carbsG: Math.round(totals.carbsG * 10) / 10,
    fatG: Math.round(totals.fatG * 10) / 10,
    fiberG: Math.round(totals.fiberG * 10) / 10,
    sugarG: Math.round(totals.sugarG * 10) / 10,
    provisional: {
      provisional,
      provisionalReasons
    },
    lowConfidenceShare: Number(lowShare.toFixed(3)),
    unmappedCount
  };

  if (portionStats) {
    result.portionStats = portionStats;
  }

  return result;
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
  
  return { value: score, label: 'Health Score', breakdown };
}

/**
 * Compute and save nutrition data for a recipe
 */
export async function computeRecipeNutrition(
  recipeId: string, 
  goal: NutritionGoal = 'general'
): Promise<{ 
  totals: NutritionTotals; 
  score: NutritionScore; 
  provisional: ProvisionalInfo;
  unmappedIngredients: string[] 
}> {
  try {
    console.log('Starting nutrition computation for recipe:', recipeId);
    const recipeMeta = await prisma.recipe.findUnique({
      where: { id: recipeId },
      select: { authorId: true }
    });
    // Get all ingredients to check for unmapped ones
    const ingredients = await prisma.ingredient.findMany({
      where: { recipeId },
      include: {
        foodMaps: true
      }
    });
    console.log('Found', ingredients.length, 'ingredients');
  
  const unmappedIngredients = ingredients
    .filter(ing => ing.foodMaps.length === 0)
    .map(ing => ing.name);
  
  // Compute totals with provisional tracking
  const result = await computeTotals(recipeId, {
    userId: recipeMeta?.authorId ?? undefined
  });
  const { provisional, lowConfidenceShare, unmappedCount, ...totals } = result;
  
  // Calculate health score
  let score: NutritionScore;
  if (HEALTH_SCORE_V2) {
    const scoreV2Result = scoreV2({
      calories: totals.calories,
      protein: totals.proteinG,
      carbs: totals.carbsG,
      fat: totals.fatG,
      fiber: totals.fiberG,
      sugar: totals.sugarG
    }, goal);
    score = scoreV2Result;
  } else {
    score = scoreV1(totals, goal);
    // Add label for v1 compatibility
    score.label = score.value >= 80 ? 'great' : score.value >= 60 ? 'good' : score.value >= 40 ? 'ok' : 'poor';
  }
  
  // Log provisional computation
  logger.info('compute_provisional', {
    feature: 'mapping_v2',
    step: 'compute_provisional',
    recipeId,
    lowConfidenceShare,
    provisional: provisional.provisional,
    unmappedCount
  });
  
  // Save to database
  // Guard against NaN/Infinity values and ensure relation is satisfied on create
  const sanitize = (n: number) => (Number.isFinite(n) ? n : 0);

    console.log('Saving nutrition to database...');
  await prisma.nutrition.upsert({
    where: { recipeId },
    update: {
      calories: sanitize(totals.calories),
      proteinG: sanitize(totals.proteinG),
      carbsG: sanitize(totals.carbsG),
      fatG: sanitize(totals.fatG),
      fiberG: sanitize(totals.fiberG),
      sugarG: sanitize(totals.sugarG),
      healthScore: score.value,
      goal,
      computedAt: new Date()
    },
    create: {
      recipeId,
      calories: sanitize(totals.calories),
      proteinG: sanitize(totals.proteinG),
      carbsG: sanitize(totals.carbsG),
      fatG: sanitize(totals.fatG),
      fiberG: sanitize(totals.fiberG),
      sugarG: sanitize(totals.sugarG),
      healthScore: score.value,
      goal
    }
  });
    console.log('Nutrition saved successfully');
  
  return { totals, score, provisional, unmappedIngredients };
  } catch (error) {
    console.error('Error in computeRecipeNutrition:', error);
    throw error;
  }
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
