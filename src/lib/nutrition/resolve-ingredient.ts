import { logger } from '../logger';
import { parseIngredientLine } from '../parse/ingredient-line';
import { normalizeQuery, tokens } from '../search/normalize';
import { rankCandidates, type Candidate } from '../foods/rank';
import { kcalBandForQuery } from '../foods/plausibility';
import { deriveServingOptions } from '../units/servings';
import { resolvePortion } from './portion';
import { resolveGramsFromParsed } from './resolve-grams';
import { mapIngredientWithFatsecret, type FatsecretMappedIngredient } from '../fatsecret/map-ingredient';
import { FATSECRET_ENABLED, FATSECRET_MIN_CONFIDENCE, FATSECRET_STRICT_MODE } from '../fatsecret/config';

export type ResolvedIngredient = {
  source: 'fatsecret' | 'local';
  system: 'fatsecret' | 'usda_v2';
  rawLine: string;
  grams: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: number;
  fatsecret?: FatsecretMappedIngredient | null;
  local?: {
    foodId: string;
    foodName: string;
    portionSource: string;
    portionConfidence: number;
  };
};

export interface ResolveIngredientDependencies {
  mapWithFatsecret?: typeof mapIngredientWithFatsecret;
  resolveLocally?: (rawLine: string) => Promise<ResolvedIngredient>;
}

export interface ResolveIngredientOptions {
  preferFatsecret?: boolean;
  minFatsecretConfidence?: number;
  dependencies?: ResolveIngredientDependencies;
}

const defaultDependencies: ResolveIngredientDependencies = {
  mapWithFatsecret: mapIngredientWithFatsecret,
  resolveLocally: resolveIngredientWithLocalSystem,
};

export async function resolveIngredient(
  rawLine: string,
  opts: ResolveIngredientOptions = {}
): Promise<ResolvedIngredient> {
  const dependencies = { ...defaultDependencies, ...(opts.dependencies ?? {}) };
  const preferFatsecret = opts.preferFatsecret ?? true;
  const minConfidence = opts.minFatsecretConfidence ?? FATSECRET_MIN_CONFIDENCE;

  if (preferFatsecret && FATSECRET_ENABLED) {
    try {
      const fatsecretResult = await dependencies.mapWithFatsecret!(rawLine);
      if (fatsecretResult) {
        // In strict mode, require confidence >= minConfidence
        // In non-strict mode, accept any confidence >= 0.3 (do not treat as fallback)
        if (FATSECRET_STRICT_MODE) {
          if (fatsecretResult.confidence >= minConfidence) {
            logger.info('fatsecret.resolve.success', {
              rawLine,
              foodId: fatsecretResult.foodId,
              grams: fatsecretResult.grams,
              confidence: fatsecretResult.confidence,
              strictMode: true,
              FATSECRET_STRICT_MODE: true,
            });
            return {
              source: 'fatsecret',
              system: 'fatsecret',
              rawLine,
              grams: fatsecretResult.grams,
              kcal: fatsecretResult.kcal,
              protein: fatsecretResult.protein,
              carbs: fatsecretResult.carbs,
              fat: fatsecretResult.fat,
              confidence: fatsecretResult.confidence,
              fatsecret: fatsecretResult,
            };
          }
          // Strict mode: reject low confidence
          logger.info('fatsecret.resolve.fallback', {
            rawLine,
            reason: 'low_confidence',
            confidence: fatsecretResult.confidence,
            minConfidence,
            strictMode: true,
            FATSECRET_STRICT_MODE: true,
          });
        } else {
          // Non-strict mode: accept any confidence >= 0.3 (skip "low_confidence" fallback log)
          if (fatsecretResult.confidence >= 0.3) {
            // Track when we accept low confidence for coverage metrics
            if (fatsecretResult.confidence < minConfidence) {
              logger.info('fatsecret.resolve.accepted_low_confidence', {
                rawLine,
                foodId: fatsecretResult.foodId,
                confidence: fatsecretResult.confidence,
                minConfidence,
                strictMode: false,
                FATSECRET_STRICT_MODE: false,
              });
            }
            logger.info('fatsecret.resolve.success', {
              rawLine,
              foodId: fatsecretResult.foodId,
              grams: fatsecretResult.grams,
              confidence: fatsecretResult.confidence,
              strictMode: false,
              FATSECRET_STRICT_MODE: false,
            });
            return {
              source: 'fatsecret',
              system: 'fatsecret',
              rawLine,
              grams: fatsecretResult.grams,
              kcal: fatsecretResult.kcal,
              protein: fatsecretResult.protein,
              carbs: fatsecretResult.carbs,
              fat: fatsecretResult.fat,
              confidence: fatsecretResult.confidence,
              fatsecret: fatsecretResult,
            };
          }
          // Non-strict mode: only reject very low confidence (< 0.3)
          logger.info('fatsecret.resolve.fallback', {
            rawLine,
            reason: 'very_low_confidence',
            confidence: fatsecretResult.confidence,
            threshold: 0.3,
            strictMode: false,
            FATSECRET_STRICT_MODE: false,
          });
        }
      } else {
        logger.info('fatsecret.resolve.fallback', {
          rawLine,
          reason: 'no_match',
        });
      }
    } catch (error) {
      logger.warn('fatsecret.resolve.error', {
        rawLine,
        reason: 'exception',
        message: (error as Error).message,
      });
    }
  } else if (!FATSECRET_ENABLED || !preferFatsecret) {
    logger.info('fatsecret.resolve.fallback', {
      rawLine,
      reason: 'disabled',
    });
  }

  const localResult = await dependencies.resolveLocally!(rawLine);
  logger.info('resolveIngredient.local_used', {
    rawLine,
    grams: localResult.grams,
    source: localResult.source,
  });
  return localResult;
}

export async function resolveIngredientWithLocalSystem(rawLine: string): Promise<ResolvedIngredient> {
  const parsed = parseIngredientLine(rawLine);
  const query = parsed?.name?.trim() || rawLine.trim();
  if (!query) {
    return {
      source: 'local',
      system: 'usda_v2',
      rawLine,
      grams: 0,
      kcal: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      confidence: 0,
    };
  }

  const normalized = normalizeQuery(query);
  const ts = tokens(normalized);
  if (ts.length === 0) {
    return {
      source: 'local',
      system: 'usda_v2',
      rawLine,
      grams: 0,
      kcal: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      confidence: 0,
    };
  }

  const andORs = ts.map(t => ({
    OR: [
      { name: { contains: t, mode: 'insensitive' as const } },
      { brand: { contains: t, mode: 'insensitive' as const } },
      { aliases: { some: { alias: { contains: t, mode: 'insensitive' as const } } } },
    ]
  }));

  const prisma = await getPrismaClient();
  const foods = await prisma.food.findMany({
    where: { AND: andORs },
    include: {
      units: true,
      barcodes: true,
      aliases: true,
      portionOverrides: true,
    },
    take: 80,
  });

  if (foods.length === 0) {
    return {
      source: 'local',
      system: 'usda_v2',
      rawLine,
      grams: 0,
      kcal: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      confidence: 0,
    };
  }

  const candidates: Candidate[] = foods.map(food => ({
    food: {
      id: food.id,
      name: food.name,
      brand: food.brand,
      source: food.source,
      verification: food.verification as 'verified' | 'unverified' | 'suspect',
      kcal100: food.kcal100,
      protein100: food.protein100,
      carbs100: food.carbs100,
      fat100: food.fat100,
      densityGml: food.densityGml,
      categoryId: food.categoryId,
      popularity: food.popularity ?? 0,
    },
    aliases: (food.aliases ?? []).map(a => a.alias),
    barcodes: (food.barcodes ?? []).map(b => b.gtin),
    usedByUserCount: 0,
  }));

  const ranked = rankCandidates(candidates, {
    query,
    kcalBand: kcalBandForQuery(query),
    unitHint: parsed?.unitHint ?? null,
    qualifiers: parsed?.qualifiers ?? undefined,
  });

  const best = ranked[0];
  if (!best) {
    return {
      source: 'local',
      system: 'usda_v2',
      rawLine,
      grams: 0,
      kcal: 0,
      protein: 0,
      carbs: 0,
      fat: 0,
      confidence: 0,
    };
  }

  const matchedFood = foods.find(f => f.id === best.candidate.food.id)!;
  const servingOptions = deriveServingOptions({
    units: matchedFood.units?.map(u => ({ label: u.label, grams: u.grams })) ?? [],
    densityGml: matchedFood.densityGml ?? undefined,
    categoryId: matchedFood.categoryId ?? null,
  });

  let grams: number | null = null;
  let portionSource = 'fallback';
  let portionConfidence = 0;

  if (parsed) {
    const resolution = resolvePortion({
      food: {
        id: matchedFood.id,
        name: matchedFood.name,
        densityGml: matchedFood.densityGml ?? undefined,
        categoryId: matchedFood.categoryId ?? null,
        units: matchedFood.units?.map(u => (u ? { label: u.label, grams: u.grams } : null)) ?? [],
        portionOverrides: matchedFood.portionOverrides?.map(o => (
          o
            ? {
                unit: o.unit,
                grams: o.grams,
                label: o.label ?? null,
              }
            : null
        )) ?? [],
      },
      parsed,
      userOverrides: null,
    });

    if (resolution.grams && resolution.grams > 0) {
      grams = resolution.grams;
      portionSource = resolution.source;
      portionConfidence = resolution.confidence;
    } else {
      const resolved = resolveGramsFromParsed(parsed, servingOptions);
      if (resolved && resolved > 0) {
        grams = resolved;
      }
    }
  }

  if (!grams || grams <= 0) {
    if (parsed?.unit) {
      grams = convertUnitFallback(parsed.qty * parsed.multiplier, parsed.unit);
    }
  }

  if (!grams || grams <= 0) {
    grams = servingOptions[0]?.grams ?? 100;
  }

  const multiplier = grams / 100;
  const kcal = matchedFood.kcal100 * multiplier;
  const protein = matchedFood.protein100 * multiplier;
  const carbs = matchedFood.carbs100 * multiplier;
  const fat = matchedFood.fat100 * multiplier;

  return {
    source: 'local',
    system: 'usda_v2',
    rawLine,
    grams,
    kcal,
    protein,
    carbs,
    fat,
    confidence: Number(best.confidence.toFixed(3)),
    local: {
      foodId: matchedFood.id,
      foodName: matchedFood.name,
      portionSource,
      portionConfidence,
    },
  };
}

let cachedPrisma: typeof import('../db')['prisma'] | null = null;
async function getPrismaClient() {
  if (cachedPrisma) return cachedPrisma;
  const mod = await import('../db');
  cachedPrisma = mod.prisma;
  return cachedPrisma;
}

const SIMPLE_UNIT_TO_GRAMS: Record<string, number> = {
  g: 1,
  gram: 1,
  grams: 1,
  kg: 1000,
  kilogram: 1000,
  kilograms: 1000,
  mg: 0.001,
  milligram: 0.001,
  milligrams: 0.001,
  oz: 28.3495,
  ounce: 28.3495,
  ounces: 28.3495,
  lb: 453.592,
  pound: 453.592,
  pounds: 453.592,
  cup: 240,
  cups: 240,
  tbsp: 15,
  tablespoon: 15,
  tablespoons: 15,
  tsp: 5,
  teaspoon: 5,
  teaspoons: 5,
  piece: 50,
  pieces: 50,
  count: 50,
  unit: 50,
};

function convertUnitFallback(qty: number, unit: string | null | undefined): number {
  if (!unit) return qty * 100;
  const key = unit.trim().toLowerCase();
  const factor = SIMPLE_UNIT_TO_GRAMS[key];
  if (factor) return qty * factor;
  return qty * 100;
}
