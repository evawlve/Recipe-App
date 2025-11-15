import { createHash } from 'node:crypto';
import type { FatSecretFoodCache, Prisma } from '@prisma/client';
import { prisma } from '../db';
import { logger } from '../logger';
import {
  FATSECRET_CACHE_MAX_AGE_MINUTES,
} from './config';
import {
  FatSecretClient,
  type FatSecretFoodDetails,
  type FatSecretServing,
} from './client';

export interface CacheFoodOptions {
  client?: FatSecretClient;
  source?: string;
  legacyFoodId?: string;
}

export interface CachedFoodResult {
  food: FatSecretFoodCache;
  refreshed: boolean;
}

const defaultClient = new FatSecretClient();

const MS_PER_MINUTE = 60 * 1000;

export function isCacheEntryFresh(entry: Pick<FatSecretFoodCache, 'syncedAt'> | null): boolean {
  if (!entry) return false;
  const maxAgeMs = FATSECRET_CACHE_MAX_AGE_MINUTES * MS_PER_MINUTE;
  return Date.now() - entry.syncedAt.getTime() < maxAgeMs;
}

export async function getCachedFood(fatsecretId: string) {
  if (!fatsecretId) return null;
  return prisma.fatSecretFoodCache.findUnique({
    where: { id: fatsecretId },
    include: {
      servings: true,
      aliases: true,
      densityEstimates: true,
    },
  });
}

export async function ensureFoodCached(
  fatsecretId: string,
  options: CacheFoodOptions = {},
): Promise<CachedFoodResult | null> {
  if (!fatsecretId) return null;
  const existing = await getCachedFood(fatsecretId);
  if (existing && isCacheEntryFresh(existing)) {
    return { food: existing, refreshed: false };
  }
  const food = await upsertFoodFromApi(fatsecretId, options);
  return food ? { food, refreshed: true } : null;
}

export async function upsertFoodFromApi(
  fatsecretId: string,
  options: CacheFoodOptions = {},
): Promise<FatSecretFoodCache | null> {
  if (!fatsecretId) return null;
  const client = options.client ?? defaultClient;
  const details = await client.getFood(fatsecretId);
  if (!details) {
    logger.warn({ fatsecretId }, 'FatSecret cache: no food details returned');
    return null;
  }

  const hash = hashFoodDetails(details);
  const expiresAt = new Date(Date.now() + FATSECRET_CACHE_MAX_AGE_MINUTES * MS_PER_MINUTE);
  const nutrients = deriveNutrients(details);
  const aliases = buildAliasList(details);
  const servings = normalizeServings(details);

  return prisma.$transaction(async (tx) => {
    await tx.fatSecretServingCache.deleteMany({ where: { foodId: fatsecretId } });
    await tx.fatSecretFoodAlias.deleteMany({ where: { foodId: fatsecretId } });
    await tx.fatSecretDensityEstimate.deleteMany({ where: { foodId: fatsecretId } });

    const food = await tx.fatSecretFoodCache.upsert({
      where: { id: fatsecretId },
      create: {
        id: fatsecretId,
        name: details.name,
        brandName: details.brandName,
        foodType: details.foodType,
        country: details.country,
        description: details.description,
        defaultServingId: servings.find((s) => s.isDefault)?.id,
        source: options.source ?? 'food.get.v4',
        confidence: 0.95,
        nutrientsPer100g: nutrients,
        legacyFoodId: options.legacyFoodId,
        hash,
        syncedAt: new Date(),
        expiresAt,
      },
      update: {
        name: details.name,
        brandName: details.brandName,
        foodType: details.foodType,
        country: details.country,
        description: details.description,
        defaultServingId: servings.find((s) => s.isDefault)?.id,
        source: options.source ?? 'food.get.v4',
        nutrientsPer100g: nutrients,
        legacyFoodId: options.legacyFoodId ?? undefined,
        hash,
        syncedAt: new Date(),
        expiresAt,
      },
    });

    const densityCache = new Map<string, string>();
    for (const serving of servings) {
      let densityEstimateId: string | undefined;
      if (serving.densityGml) {
        const densityKey = `${roundDensity(serving.densityGml)}:${serving.densitySource}`;
        let cachedId = densityCache.get(densityKey);
        if (!cachedId) {
          const density = await tx.fatSecretDensityEstimate.create({
            data: {
              foodId: fatsecretId,
              densityGml: serving.densityGml,
              source: serving.densitySource ?? 'fatsecret_serving',
              confidence: serving.densityConfidence ?? 0.9,
              notes: serving.densityNote,
            },
          });
          cachedId = density.id;
          densityCache.set(densityKey, cachedId);
        }
        densityEstimateId = cachedId;
      }

      await tx.fatSecretServingCache.create({
        data: {
          id: serving.id,
          foodId: fatsecretId,
          measurementDescription: serving.measurementDescription,
          numberOfUnits: serving.numberOfUnits,
          metricServingAmount: serving.metricServingAmount,
          metricServingUnit: serving.metricServingUnit,
          servingWeightGrams: serving.servingWeightGrams,
          volumeMl: serving.volumeMl,
          isVolume: serving.isVolume,
          isDefault: serving.isDefault,
          derivedViaDensity: serving.derivedViaDensity,
          densityEstimateId,
        },
      });
    }

    if (aliases.length > 0) {
      await tx.fatSecretFoodAlias.createMany({
        data: aliases.map((alias) => ({
          foodId: fatsecretId,
          alias,
          source: alias.includes(details.name) ? 'fatsecret' : 'derived',
        })),
        skipDuplicates: true,
      });
    }

    return food;
  });
}

type NormalizedServing = {
  id: string;
  measurementDescription?: string | null;
  numberOfUnits?: number | null;
  metricServingAmount?: number | null;
  metricServingUnit?: string | null;
  servingWeightGrams?: number | null;
  volumeMl?: number | null;
  isVolume: boolean;
  isDefault: boolean;
  derivedViaDensity: boolean;
  densityGml?: number;
  densitySource?: string;
  densityConfidence?: number;
  densityNote?: string;
};

function normalizeServings(details: FatSecretFoodDetails): NormalizedServing[] {
  if (!details.servings || details.servings.length === 0) return [];
  const servings: NormalizedServing[] = [];
  for (const [index, serving] of details.servings.entries()) {
    const id = serving.id ?? `${details.id}_${index}`;
    const volumeMl = deriveVolumeMl(serving);
    const density = deriveDensity(serving, volumeMl);
    servings.push({
      id,
      measurementDescription: serving.measurementDescription,
      numberOfUnits: serving.numberOfUnits,
      metricServingAmount: serving.metricServingAmount,
      metricServingUnit: serving.metricServingUnit,
      servingWeightGrams: serving.servingWeightGrams,
      volumeMl,
      isVolume: volumeMl != null,
      isDefault: index === 0,
      derivedViaDensity: false,
      densityGml: density,
      densitySource: density ? 'fatsecret_serving' : undefined,
      densityConfidence: density ? 0.9 : undefined,
      densityNote: density && serving.measurementDescription
        ? `Derived from ${serving.measurementDescription}`
        : undefined,
    });
  }
  return servings;
}

function deriveVolumeMl(serving: FatSecretServing): number | null {
  if (!serving.metricServingAmount || !serving.metricServingUnit) return null;
  const unit = serving.metricServingUnit.toLowerCase();
  if (unit === 'ml' || unit === 'milliliter' || unit === 'milliliters') {
    return serving.metricServingAmount;
  }
  return null;
}

function deriveDensity(serving: FatSecretServing, volumeMl: number | null): number | null {
  if (!serving.servingWeightGrams || serving.servingWeightGrams <= 0) return null;
  const grams = serving.servingWeightGrams;
  if (volumeMl && volumeMl > 0) {
    return grams / volumeMl;
  }
  return null;
}

function deriveNutrients(details: FatSecretFoodDetails): Prisma.JsonObject | null {
  if (!details.servings || details.servings.length === 0) return null;
  for (const serving of details.servings) {
    const grams = serving.servingWeightGrams;
    if (!grams || grams <= 0) continue;
    const nutrients = {
      calories: normalizeMacro(serving.calories, grams),
      protein: normalizeMacro(serving.protein, grams),
      carbs: normalizeMacro(serving.carbohydrate, grams),
      fat: normalizeMacro(serving.fat, grams),
      fiber: normalizeMacro(serving.fiber, grams),
      sugar: normalizeMacro(serving.sugar, grams),
    };
    if (Object.values(nutrients).some((value) => value != null)) {
      return nutrients as Prisma.JsonObject;
    }
  }
  return null;
}

function normalizeMacro(value: number | null | undefined, grams: number): number | null {
  if (value == null || grams <= 0) return null;
  const normalized = (value / grams) * 100;
  return Number.isFinite(normalized) ? Number(normalized.toFixed(4)) : null;
}

function buildAliasList(details: FatSecretFoodDetails): string[] {
  const aliases = new Set<string>();
  aliases.add(details.name.trim());
  if (details.brandName) {
    aliases.add(`${details.brandName} ${details.name}`.trim());
  }
  if (details.description) {
    const parts = details.description.split(';').map((part) => part.trim());
    for (const part of parts) {
      if (part.length > 2) {
        aliases.add(part);
      }
    }
  }
  return Array.from(aliases).filter(Boolean);
}

function hashFoodDetails(details: FatSecretFoodDetails): string {
  const payload = {
    id: details.id,
    name: details.name,
    brandName: details.brandName,
    description: details.description,
    servings: details.servings?.map((serving) => ({
      id: serving.id,
      measurementDescription: serving.measurementDescription,
      numberOfUnits: serving.numberOfUnits,
      metricServingAmount: serving.metricServingAmount,
      metricServingUnit: serving.metricServingUnit,
      servingWeightGrams: serving.servingWeightGrams,
      calories: serving.calories,
      protein: serving.protein,
      carbohydrate: serving.carbohydrate,
      fat: serving.fat,
      fiber: serving.fiber,
      sugar: serving.sugar,
    })),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function roundDensity(value: number): number {
  return Number(value.toFixed(4));
}
