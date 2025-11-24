import type {
  FatSecretFoodAlias,
  FatSecretFoodCache,
  FatSecretServingCache,
  FatSecretDensityEstimate,
  Prisma,
} from '@prisma/client';
import { prisma } from '../db';
import { normalizeQuery, tokens } from '../search/normalize';
import { deriveServingOptions } from '../units/servings';
import { type FatSecretFoodSummary, type FatSecretFoodDetails, type FatSecretServing } from './client';

export type CacheFoodRecord = FatSecretFoodCache & {
  servings: FatSecretServingCache[];
  aliases: FatSecretFoodAlias[];
  densityEstimates: FatSecretDensityEstimate[];
};

function toNumber(value: unknown): number | null {
  if (value == null) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

export function extractCacheNutrients(food: FatSecretFoodCache) {
  const payload = (food.nutrientsPer100g as Prisma.JsonObject | null) ?? null;
  const base = (payload ?? {}) as Record<string, unknown>;
  return {
    calories: toNumber(base.calories),
    protein: toNumber(base.protein),
    carbs: toNumber(base.carbs ?? base.carbohydrate),
    fat: toNumber(base.fat),
    fiber: toNumber(base.fiber),
    sugar: toNumber(base.sugar),
  };
}

function pickDensity(food: CacheFoodRecord): number | null {
  if (food.densityEstimates?.length) {
    const sorted = [...food.densityEstimates].sort(
      (a, b) => (b.confidence ?? 0) - (a.confidence ?? 0),
    );
    return sorted[0]?.densityGml ?? null;
  }
  for (const serving of food.servings) {
    if (serving.servingWeightGrams && serving.volumeMl && serving.volumeMl > 0) {
      return serving.servingWeightGrams / serving.volumeMl;
    }
  }
  return null;
}

function buildUnitsFromServings(food: CacheFoodRecord) {
  const units: Array<{ label: string; grams: number }> = [];
  for (const serving of food.servings) {
    if (!serving.servingWeightGrams || serving.servingWeightGrams <= 0) continue;
    const label =
      serving.measurementDescription?.trim() ||
      (serving.numberOfUnits && serving.metricServingUnit
        ? `${serving.numberOfUnits} ${serving.metricServingUnit}`
        : 'FatSecret serving');
    units.push({
      label,
      grams: Number(serving.servingWeightGrams),
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
  serving: FatSecretServingCache,
) {
  if (!nutrients) return { calories: null, protein: null, carbohydrate: null, fat: null };
  const grams = serving.servingWeightGrams;
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
  serving: FatSecretServingCache,
  nutrients: ReturnType<typeof extractCacheNutrients>,
): FatSecretServing {
  const macros = computeServingMacros(nutrients, serving);
  return {
    id: serving.id,
    description: serving.measurementDescription ?? undefined,
    measurementDescription: serving.measurementDescription ?? undefined,
    numberOfUnits: serving.numberOfUnits ?? null,
    metricServingAmount: serving.metricServingAmount ?? null,
    metricServingUnit: serving.metricServingUnit ?? null,
    servingWeightGrams: serving.servingWeightGrams ?? null,
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
    name: food.name,
    brandName: food.brandName,
    foodType: food.foodType ?? undefined,
    description: food.description ?? undefined,
    country: food.country ?? undefined,
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

export async function searchFatSecretCacheFoods(query: string, limit = 200) {
  const normalized = normalizeQuery(query.trim());
  if (!normalized) return [];
  const toks = tokens(normalized);
  const where = toks.length
    ? {
        AND: toks.map((t) => ({
          OR: [
            { name: { contains: t, mode: 'insensitive' } },
            { brandName: { contains: t, mode: 'insensitive' } },
            { aliases: { some: { alias: { contains: t, mode: 'insensitive' } } } },
          ],
        })),
      }
    : {};

  const foods = await prisma.fatSecretFoodCache.findMany({
    where,
    take: limit,
    include: {
      servings: true,
      aliases: true,
      densityEstimates: true,
    },
  });
  return foods;
}

export async function getCachedFoodWithRelations(id: string) {
  if (!id) return null;
  return prisma.fatSecretFoodCache.findUnique({
    where: { id },
    include: {
      servings: true,
      aliases: true,
      densityEstimates: true,
    },
  });
}

export function buildCacheCandidate(food: CacheFoodRecord) {
  const nutrients = extractCacheNutrients(food);
  return {
    food: {
      id: food.id,
      name: food.name,
      brand: food.brandName,
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
    aliases: food.aliases?.map((a) => a.alias) ?? [],
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
    legacyFoodId: food.legacyFoodId,
    name: food.name,
    brand: food.brandName ?? null,
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
