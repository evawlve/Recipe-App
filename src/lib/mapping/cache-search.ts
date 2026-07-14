import type {
  AiGeneratedFood,
  AiGeneratedServing,
  Prisma,
} from '@prisma/client';
import { prisma } from '../db';
import { normalizeQuery, tokens } from '../search/normalize';
import { deriveServingOptions } from '../units/servings';
import { type FatSecretFoodSummary, type FatSecretFoodDetails, type FatSecretServing } from './client';

export type CacheFoodRecord = AiGeneratedFood & {
  servings: AiGeneratedServing[];
};

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function extractCacheNutrients(food: AiGeneratedFood) {
  return {
    calories: toNumber(food.caloriesPer100g),
    protein: toNumber(food.proteinPer100g),
    carbs: toNumber(food.carbsPer100g),
    fat: toNumber(food.fatPer100g),
    fiber: toNumber(food.fiberPer100g),
    sugar: toNumber(food.sugarPer100g),
  };
}

function pickDensity(food: CacheFoodRecord): number | null {
  for (const serving of food.servings) {
    if (serving.grams && serving.volumeMl && serving.volumeMl > 0) {
      return serving.grams / serving.volumeMl;
    }
  }
  return null;
}

function buildUnitsFromServings(food: CacheFoodRecord) {
  const units: Array<{ label: string; grams: number }> = [];
  for (const serving of food.servings) {
    if (!serving.grams || serving.grams <= 0) continue;
    units.push({
      label: serving.label,
      grams: Number(serving.grams),
    });
  }
  return units;
}

export function buildServingOptionsForCacheFood(food: CacheFoodRecord) {
  const densityGml = pickDensity(food);
  const units = buildUnitsFromServings(food);
  const options = deriveServingOptions({
    units,
    densityGml: densityGml ?? undefined,
    categoryId: null,
  });
  if (options.length === 0) {
    options.push({ label: '100 g', grams: 100 });
  }
  return { servingOptions: options, densityGml };
}

function computeServingMacros(
  nutrients: ReturnType<typeof extractCacheNutrients>,
  serving: AiGeneratedServing,
) {
  if (!nutrients) return { calories: null, protein: null, carbohydrate: null, fat: null };
  const grams = serving.grams;
  if (!grams || grams <= 0) {
    return { calories: null, protein: null, carbohydrate: null, fat: null };
  }
  const factor = grams / 100;
  const calc = (value: number | null) =>
    value != null && Number.isFinite(value) ? Number((value * factor).toFixed(4)) : null;
  return {
    calories: calc(nutrients.calories),
    protein: calc(nutrients.protein),
    carbohydrate: calc(nutrients.carbs),
    fat: calc(nutrients.fat),
  };
}

function convertServingToFatSecret(
  serving: AiGeneratedServing,
  nutrients: ReturnType<typeof extractCacheNutrients>,
): FatSecretServing {
  const macros = computeServingMacros(nutrients, serving);
  return {
    id: serving.id,
    description: serving.label ?? undefined,
    measurementDescription: serving.label ?? undefined,
    numberOfUnits: 1,
    metricServingAmount: serving.volumeMl ?? serving.grams ?? null,
    metricServingUnit: serving.volumeMl ? 'ml' : 'g',
    servingWeightGrams: serving.grams ?? null,
    calories: macros.calories,
    protein: macros.protein,
    carbohydrate: macros.carbohydrate,
    fat: macros.fat,
    fiber: null,
    sugar: null,
  };
}

export function cacheFoodToSummary(food: CacheFoodRecord): FatSecretFoodSummary {
  const nutrients = extractCacheNutrients(food);
  return {
    id: food.id,
    name: food.displayName,
    brandName: undefined,
    foodType: 'Generic',
    description: food.displayName ?? undefined,
    country: 'US',
    servings: food.servings.map((serving) => convertServingToFatSecret(serving, nutrients)),
  };
}

export function cacheFoodToDetails(food: CacheFoodRecord): FatSecretFoodDetails {
  const summary = cacheFoodToSummary(food);
  return {
    ...summary,
    servings: summary.servings ?? [],
  };
}

export async function searchFatSecretCacheFoods(query: string, limit = 200): Promise<CacheFoodRecord[]> {
  const normalized = normalizeQuery(query.trim());
  if (!normalized) return [];
  const toks = tokens(normalized);
  const where = toks.length
    ? {
      AND: toks.map((t) => ({
        OR: [
          { displayName: { contains: t, mode: 'insensitive' as Prisma.QueryMode } },
        ],
      })),
    }
    : {};

  const foods = await prisma.aiGeneratedFood.findMany({
    where,
    take: limit,
    include: {
      servings: true,
    },
  });
  return foods as unknown as CacheFoodRecord[];
}

export async function getCachedFoodWithRelations(id: string) {
  if (!id) return null;
  return prisma.aiGeneratedFood.findUnique({
    where: { id },
    include: {
      servings: true,
    },
  });
}

export function buildCacheCandidate(food: CacheFoodRecord) {
  const nutrients = extractCacheNutrients(food);
  return {
    food: {
      id: food.id,
      name: food.displayName,
      brand: undefined,
      source: 'fatsecret-cache',
      verification: 'fatsecret',
      kcal100: nutrients.calories ?? 0,
      protein100: nutrients.protein ?? 0,
      carbs100: nutrients.carbs ?? 0,
      fat100: nutrients.fat ?? 0,
      densityGml: pickDensity(food),
      categoryId: null,
      popularity: 0,
    },
    aliases: [],
    barcodes: [],
    usedByUserCount: 0,
  };
}

export function buildCacheFoodResponse(
  food: CacheFoodRecord,
  confidence: number,
) {
  const nutrients = extractCacheNutrients(food);
  const { servingOptions, densityGml } = buildServingOptionsForCacheFood(food);
  return {
    id: food.id,
    fatsecretId: food.id,
    legacyFoodId: food.id,
    name: food.displayName,
    brand: null,
    categoryId: null,
    source: 'fatsecret-cache',
    verification: 'fatsecret',
    densityGml,
    kcal100: nutrients.calories ?? 0,
    protein100: nutrients.protein ?? 0,
    carbs100: nutrients.carbs ?? 0,
    fat100: nutrients.fat ?? 0,
    fiber100: nutrients.fiber ?? 0,
    sugar100: nutrients.sugar ?? 0,
    popularity: 0,
    confidence,
    servingOptions,
  };
}
