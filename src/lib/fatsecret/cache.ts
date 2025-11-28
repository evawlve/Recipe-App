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
  searchQuery?: string;
  allowNextBest?: boolean;
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
  let details = await client.getFood(fatsecretId);
  if (!details) {
    logger.warn({ fatsecretId }, 'FatSecret cache: no food details returned');
    return null;
  }

  let resolvedFoodId = fatsecretId;
  const originalFoodName = details.name?.toLowerCase() || '';
  let servings = normalizeServings(details);
  let nutrients = deriveNutrients(details);
  const fallbackQuery = options.searchQuery?.trim() || details.name?.trim() || '';

  // If the top hit lacks nutrients or serving weight/volume, try the next-best search result.
  if (
    fallbackQuery &&
    options.allowNextBest !== false &&
    shouldTryNextBest(servings, nutrients) &&
    allowFallbackForQueryType(fallbackQuery, originalFoodName)
  ) {
    const fallback = await pickNextBestFatSecretResult({
      client,
      query: fallbackQuery,
      excludeId: fatsecretId,
      originalFoodName,
    });
    if (fallback) {
      details = fallback;
      resolvedFoodId = fallback.id;
      servings = normalizeServings(details);
      nutrients = deriveNutrients(details);
      logger.info(
        {
          requestedId: fatsecretId,
          fallbackId: resolvedFoodId,
          query: fallbackQuery,
        },
        'fatsecret.cache.next_best_fallback_used',
      );
    }
  }

  const hash = hashFoodDetails(details);
  const expiresAt = new Date(Date.now() + FATSECRET_CACHE_MAX_AGE_MINUTES * MS_PER_MINUTE);
  const aliases = buildAliasList(details);

  return prisma.$transaction(async (tx) => {
    await tx.fatSecretServingCache.deleteMany({ where: { foodId: resolvedFoodId } });
    await tx.fatSecretFoodAlias.deleteMany({ where: { foodId: resolvedFoodId } });
    await tx.fatSecretDensityEstimate.deleteMany({ where: { foodId: resolvedFoodId } });

    const food = await tx.fatSecretFoodCache.upsert({
      where: { id: resolvedFoodId },
      create: {
        id: resolvedFoodId,
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
        id: resolvedFoodId,
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
              foodId: resolvedFoodId,
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
          foodId: resolvedFoodId,
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
          foodId: resolvedFoodId,
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

function shouldTryNextBest(
  servings: NormalizedServing[],
  nutrients: Prisma.JsonObject | null,
): boolean {
  const hasWeight = servings.some((s) => (s.servingWeightGrams ?? 0) > 0);
  const hasVolume = servings.some((s) => (s.volumeMl ?? 0) > 0 || s.isVolume);
  const missingServings = !hasWeight && !hasVolume;
  return missingServings || nutrients == null;
}

async function pickNextBestFatSecretResult({
  client,
  query,
  excludeId,
  originalFoodName,
  allowFallbackForQuery,
}: {
  client: FatSecretClient;
  query: string;
  excludeId?: string;
  originalFoodName?: string;
  allowFallbackForQuery?: boolean;
}): Promise<FatSecretFoodDetails | null> {
  const trimmed = query.trim();
  if (!trimmed) return null;
  if (allowFallbackForQuery === false) return null;
  try {
    const searchResults = await client.searchFoodsV4(trimmed, { maxResults: 5 });
    const candidates = searchResults.filter((f) => f.id !== excludeId).slice(0, 2);
    for (const candidate of candidates) {
      const details = await client.getFood(candidate.id);
      if (!details) continue;
      // Safeguard: only accept fallback if it shares key tokens with original
      if (originalFoodName) {
        const origTokens = tokenSet(originalFoodName);
        const candTokens = tokenSet(details.name ?? '');
        const overlap = [...origTokens].filter(t => candTokens.has(t));
        // Require at least 2 overlapping tokens to avoid unrelated fallbacks
        if (overlap.length < 2) {
          continue;
        }

        // For sweeteners and milks/cheeses with qualifiers, require all critical tokens to be present
        const critical = extractCriticalTokens(originalFoodName);
        if (critical.length > 0) {
          const missing = critical.filter(t => !candTokens.has(t));
          if (missing.length > 0) {
            continue;
          }
        }
      }
      const servings = normalizeServings(details);
      const nutrients = deriveNutrients(details);
      if (!shouldTryNextBest(servings, nutrients)) {
        return details;
      }
    }
  } catch (error) {
    logger.warn(
      {
        query,
        message: (error as Error).message,
      },
      'fatsecret.cache.next_best_lookup_failed',
    );
  }
  return null;
}

function tokenSet(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\w]+/)
      .filter((t) => t.length > 2)
  );
}

function allowFallbackForQueryType(query: string, originalFoodName?: string): boolean {
  const text = `${query} ${originalFoodName ?? ''}`.toLowerCase();
  const sweetenerTokens = ['monk', 'erythritol', 'stevia', 'allulose', 'splenda', 'sweetener'];
  const milkTokens = ['coconut', 'almond', 'soy', 'oat', 'unsweetened', 'sweetened'];
  const cheeseTokens = ['mozzarella', 'part', 'skim', 'low', 'moisture', 'reduced', 'fat', 'light'];
  const meatFatTokens = ['90', '85', '80', '75', 'lean', 'fat']; // crude check for fat% qualifiers

  const hasSweetener = sweetenerTokens.some(t => text.includes(t));
  const hasMilk = milkTokens.some(t => text.includes(t));
  const hasCheese = cheeseTokens.some(t => text.includes(t));
  const hasMeatFat = /(\d{2})\s*\/\s*(\d{2})/.test(text) || meatFatTokens.some(t => text.includes(t));
  const hasSalted = /\bsalted\b|\bunsalted\b/.test(text);

  // Disable fallback for any qualifier-heavy query; we prefer AI serving backfill over swapping foods.
  if (hasSweetener || hasMilk || hasCheese || hasMeatFat || hasSalted) return false;

  // Allow fallback only for trivial/generic items without critical qualifiers
  const trivialTokens = ['water', 'salt', 'sugar', 'flour', 'rice', 'oil', 'vinegar'];
  return trivialTokens.some(t => text.includes(t));
}

function extractCriticalTokens(text: string): string[] {
  const lower = text.toLowerCase();
  const tokens: string[] = [];
  const pairs: Array<[RegExp, string]> = [
    [/\bmonk\b.*\bfruit\b/, 'monk'],
    [/\berytr/i, 'erythritol'],
    [/\bstevia\b/, 'stevia'],
    [/\ballulose\b/, 'allulose'],
    [/\bsplenda\b/, 'splenda'],
    [/\bcoconut\b/, 'coconut'],
    [/\balmond\b/, 'almond'],
    [/\bsoy\b/, 'soy'],
    [/\boat\b/, 'oat'],
    [/\bunsweetened\b/, 'unsweetened'],
    [/\bsweetened\b/, 'sweetened'],
    [/\bpart[-\s]?skim\b/, 'part'],
    [/\blow[-\s]?moisture\b/, 'low'],
    [/\breduced[-\s]?fat\b/, 'reduced'],
    [/\blight\b/, 'light'],
  ];
  for (const [re, token] of pairs) {
    if (re.test(lower)) tokens.push(token);
  }
  return tokens;
}

function normalizeServings(details: FatSecretFoodDetails): NormalizedServing[] {
  if (!details.servings || details.servings.length === 0) return [];
  const servings: NormalizedServing[] = [];
  for (const [index, serving] of details.servings.entries()) {
    const id = serving.id ?? `${details.id}_${index}`;
    const volumeMl = deriveVolumeMl(serving);
    const servingWeightGrams = resolveServingWeightGrams(serving);
    const density = deriveDensity(servingWeightGrams, volumeMl);
    servings.push({
      id,
      measurementDescription: serving.measurementDescription,
      numberOfUnits: serving.numberOfUnits,
      metricServingAmount: serving.metricServingAmount,
      metricServingUnit: serving.metricServingUnit,
      servingWeightGrams,
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

const VOLUME_UNIT_TO_ML: Record<string, number> = {
  'ml': 1,
  'milliliter': 1,
  'milliliters': 1,
  'millilitre': 1,
  'millilitres': 1,
  'l': 1000,
  'liter': 1000,
  'liters': 1000,
  'litre': 1000,
  'litres': 1000,
  'cup': 240,
  'cups': 240,
  'tbsp': 14.7868,
  'tablespoon': 14.7868,
  'tablespoons': 14.7868,
  'tbs': 14.7868,
  'tsp': 4.92892,
  'teaspoon': 4.92892,
  'teaspoons': 4.92892,
  'fl oz': 29.5735,
  'fluid ounce': 29.5735,
  'fluid ounces': 29.5735,
  'pint': 473.176,
  'pints': 473.176,
  'quart': 946.353,
  'quarts': 946.353,
  'gallon': 3785.41,
  'gallons': 3785.41,
};

function deriveVolumeMl(serving: FatSecretServing): number | null {
  const metricVolume = deriveVolumeFromMetric(serving);
  if (metricVolume != null) return metricVolume;
  const descriptionVolume = deriveVolumeFromDescription(serving);
  if (descriptionVolume != null) return descriptionVolume;
  return null;
}

function deriveVolumeFromMetric(serving: FatSecretServing): number | null {
  if (!serving.metricServingAmount || !serving.metricServingUnit) return null;
  const unit = serving.metricServingUnit.toLowerCase();
  if (unit in VOLUME_UNIT_TO_ML) {
    const multiplier = VOLUME_UNIT_TO_ML[unit];
    return serving.metricServingAmount * multiplier;
  }
  return null;
}

function deriveVolumeFromDescription(serving: FatSecretServing): number | null {
  if (!serving.measurementDescription) return null;
  const desc = serving.measurementDescription.toLowerCase();
  const units = serving.numberOfUnits && serving.numberOfUnits > 0 ? serving.numberOfUnits : 1;
  for (const [token, ml] of Object.entries(VOLUME_UNIT_TO_ML)) {
    if (desc.includes(token)) {
      return ml * units;
    }
  }
  return null;
}

function deriveDensity(servingWeightGrams: number | null, volumeMl: number | null): number | null {
  if (!servingWeightGrams || servingWeightGrams <= 0) return null;
  const grams = servingWeightGrams;
  if (volumeMl && volumeMl > 0) {
    return grams / volumeMl;
  }
  return null;
}

function deriveNutrients(details: FatSecretFoodDetails): Prisma.JsonObject | null {
  if (!details.servings || details.servings.length === 0) return null;
  for (const serving of details.servings) {
    const grams = resolveServingWeightGrams(serving);
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

function resolveServingWeightGrams(serving: FatSecretServing): number | null {
  if (serving.servingWeightGrams && serving.servingWeightGrams > 0) {
    return serving.servingWeightGrams;
  }
  if (!serving.metricServingAmount || serving.metricServingAmount <= 0 || !serving.metricServingUnit) {
    return null;
  }
  const unit = serving.metricServingUnit.toLowerCase();
  if (unit === 'g' || unit === 'gram' || unit === 'grams') {
    return serving.metricServingAmount;
  }
  if (unit === 'kg' || unit === 'kilogram' || unit === 'kilograms') {
    return serving.metricServingAmount * 1000;
  }
  if (unit === 'oz' || unit === 'ounce' || unit === 'ounces') {
    return serving.metricServingAmount * 28.349523125;
  }
  if (unit === 'lb' || unit === 'lbs' || unit === 'pound' || unit === 'pounds') {
    return serving.metricServingAmount * 453.59237;
  }
  return null;
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
