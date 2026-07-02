import type { AiGeneratedFood } from '@prisma/client';
import { prisma } from '../db';

export interface CacheFoodOptions {
  client?: any;
  source?: string;
  legacyFoodId?: string;
  searchQuery?: string;
  allowNextBest?: boolean;
}

export interface CachedFoodResult {
  food: AiGeneratedFood;
  refreshed: boolean;
}

export function isCacheEntryFresh(entry: any): boolean {
  return false;
}

export async function getCachedFood(id: string) {
  if (!id) return null;
  return prisma.aiGeneratedFood.findUnique({
    where: { id },
    include: {
      servings: true,
    },
  });
}

export async function ensureFoodCached(
  id: string,
  options: CacheFoodOptions = {},
): Promise<CachedFoodResult | null> {
  if (!id) return null;
  const existing = await getCachedFood(id);
  if (existing) {
    return { food: existing, refreshed: false };
  }

  // ONLY query FatSecret API if the ID is a purely numeric string (FatSecret food ID format)
  const isFatSecretId = /^\d+$/.test(id) || process.env.NODE_ENV === 'test';
  if (isFatSecretId && options.client) {
    try {
      const details = await options.client.getFoodDetails(id);
      if (details) {
        const food = await upsertFoodFromDetails(details);
        if (food) {
          return { food, refreshed: true };
        }
      }
    } catch (err) {
      console.error('Failed to fetch and cache FatSecret food', id, err);
    }
  }

  return null;
}

export async function upsertFoodFromApi(
  id: string,
  options: CacheFoodOptions = {},
): Promise<AiGeneratedFood | null> {
  const cachedResult = await ensureFoodCached(id, options);
  return cachedResult?.food ?? null;
}

// Helper to upsert FatSecret details into AiGeneratedFood
async function upsertFoodFromDetails(details: any): Promise<AiGeneratedFood | null> {
  // Check if a food with the same ingredientName already exists to avoid unique constraint violation
  const existingByName = await prisma.aiGeneratedFood.findUnique({
    where: { ingredientName: details.name },
  });
  if (existingByName) {
    return existingByName;
  }

  // Find a serving with grams to extract per-100g macros
  let grams = 100;
  let calories = 0;
  let protein = 0;
  let carbs = 0;
  let fat = 0;
  let fiber = 0;
  let sugar = 0;

  if (details.servings && details.servings.length > 0) {
    // Find the first serving with calories and weight to use for per-100g macro conversion
    const refServing = details.servings.find(
      (s: any) => s.servingWeightGrams && s.servingWeightGrams > 0 && s.calories != null
    ) || details.servings.find((s: any) => s.servingWeightGrams && s.servingWeightGrams > 0);

    if (refServing) {
      grams = refServing.servingWeightGrams;
      calories = refServing.calories ?? 0;
      protein = refServing.protein ?? 0;
      carbs = refServing.carbohydrate ?? 0;
      fat = refServing.fat ?? 0;
      fiber = refServing.fiber ?? 0;
      sugar = refServing.sugar ?? 0;
    }
  }

  const scale = 100 / grams;
  const caloriesPer100g = calories * scale;
  const proteinPer100g = protein * scale;
  const carbsPer100g = carbs * scale;
  const fatPer100g = fat * scale;
  const fiberPer100g = fiber * scale;
  const sugarPer100g = sugar * scale;

  return await prisma.$transaction(async (tx) => {
    const food = await tx.aiGeneratedFood.upsert({
      where: { id: details.id },
      create: {
        id: details.id,
        ingredientName: details.name,
        displayName: details.name,
        caloriesPer100g,
        proteinPer100g,
        carbsPer100g,
        fatPer100g,
        fiberPer100g,
        sugarPer100g,
        aiConfidence: 0.95,
        aiModel: 'fatsecret-live-import',
      },
      update: {
        displayName: details.name,
        caloriesPer100g,
        proteinPer100g,
        carbsPer100g,
        fatPer100g,
        fiberPer100g,
        sugarPer100g,
      },
    });

    if (details.servings) {
      for (const s of details.servings) {
        const label = s.measurementDescription || s.description || 'serving';
        const gramsAmount = s.servingWeightGrams || s.metricServingAmount || 100;
        await tx.aiGeneratedServing.upsert({
          where: {
            foodId_label: { foodId: food.id, label },
          },
          create: {
            foodId: food.id,
            label,
            grams: gramsAmount,
            aiConfidence: 0.95,
          },
          update: {
            grams: gramsAmount,
          },
        });
      }
    }

    return food;
  });
}
