import { parseIngredientLine, type ParsedIngredient } from '../parse/ingredient-line';
import { normalizeQuery } from '../search/normalize';
import { logger } from '../logger';
import { FatSecretClient, type FatSecretFoodDetails, type FatSecretFoodSummary, type FatSecretServing } from './client';
import { FATSECRET_MIN_CONFIDENCE } from './config';

export type FatsecretMappedIngredient = {
  source: 'fatsecret';
  foodId: string;
  foodName: string;
  brandName?: string | null;
  servingId?: string | null;
  servingDescription?: string | null;
  grams: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: number;
  rawLine: string;
};

export interface MapIngredientOptions {
  client?: FatSecretClient;
  minConfidence?: number;
  enableNlp?: boolean;
}

const defaultClient = new FatSecretClient();

interface MappingCandidate {
  food: FatSecretFoodSummary;
  source: 'nlp' | 'search';
  baseScore: number;
  servingId?: string | null;
}

export async function mapIngredientWithFatsecret(
  rawLine: string,
  options: MapIngredientOptions = {}
): Promise<FatsecretMappedIngredient | null> {
  const trimmed = rawLine.trim();
  if (!trimmed) return null;

  const parsed = parseIngredientLine(trimmed);
  const query = parsed?.name?.trim() || trimmed;
  const client = options.client ?? defaultClient;
  const minConfidence = options.minConfidence ?? 0;

  const candidates: MappingCandidate[] = [];

  if (options.enableNlp !== false) {
    try {
      const nlp = await client.nlpParse(trimmed);
      if (nlp?.entries?.length) {
        for (const entry of nlp.entries) {
          const summary: FatSecretFoodSummary = {
            id: entry.foodId,
            name: entry.foodName,
            brandName: entry.brandName,
            foodType: entry.brandName ? 'Brand' : 'Generic',
            servings: entry.servings,
          };
          candidates.push({
            food: summary,
            source: 'nlp',
            baseScore: computeCandidateScore(summary, query, parsed),
            servingId: entry.servingId ?? undefined,
          });
        }
      }
    } catch (error) {
      logger.warn('fatsecret.map.nlp_failed', { message: (error as Error).message });
    }
  }

  try {
    const search = await client.searchFoods(query, { maxResults: 10 });
    for (const food of search.foods) {
      candidates.push({
        food,
        source: 'search',
        baseScore: computeCandidateScore(food, query, parsed),
      });
    }
  } catch (error) {
    logger.warn('fatsecret.map.search_failed', { message: (error as Error).message });
    if (candidates.length === 0) return null;
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => b.baseScore - a.baseScore);

  for (const candidate of candidates.slice(0, 6)) {
    const hydrated = await hydrateCandidate(client, candidate.food);
    if (!hydrated || !hydrated.servings || hydrated.servings.length === 0) continue;

    const servingSelection = selectServing(parsed, hydrated.servings, candidate.servingId);
    if (!servingSelection) continue;

    const qty = parsed ? parsed.qty * parsed.multiplier : 1;
    const grams = servingSelection.gramsPerUnit != null
      ? servingSelection.gramsPerUnit * qty
      : servingSelection.baseGrams ?? null;

    if (!grams || grams <= 0) continue;

    const macros = computeMacros(servingSelection.serving, qty, servingSelection.unitsPerServing);
    if (!macros) continue;

    const confidence = clamp(
      0.25 +
        Math.min(1, Math.max(0, candidate.baseScore)) * 0.4 +
        servingSelection.matchScore * 0.2 +
        (candidate.source === 'nlp' ? 0.1 : 0) +
        (hydrated.country?.toUpperCase() === 'US' ? 0.05 : 0) +
        (parsed?.unitHint && hydrated.name.toLowerCase().includes(parsed.unitHint.toLowerCase()) ? 0.05 : 0),
      0,
      1
    );

    if (confidence < minConfidence) {
      continue;
    }

    return {
      source: 'fatsecret',
      foodId: hydrated.id,
      foodName: hydrated.name,
      brandName: hydrated.brandName,
      servingId: servingSelection.serving.id ?? undefined,
      servingDescription: servingSelection.serving.description ?? undefined,
      grams,
      kcal: macros.kcal,
      protein: macros.protein,
      carbs: macros.carbs,
      fat: macros.fat,
      confidence,
      rawLine: rawLine.trim(),
    };
  }

  return null;
}

async function hydrateCandidate(client: FatSecretClient, summary: FatSecretFoodSummary): Promise<FatSecretFoodDetails | null> {
  if (summary.servings && summary.servings.length > 0) {
    return {
      ...summary,
      servings: summary.servings,
    };
  }
  return client.getFood(summary.id);
}

function computeCandidateScore(food: FatSecretFoodSummary, query: string, parsed: ParsedIngredient | null): number {
  const normalizedQuery = normalizeQuery(query);
  const foodName = `${food.brandName ?? ''} ${food.name}`.trim().toLowerCase();
  const queryTokens = tokenSet(normalizedQuery);
  const foodTokens = tokenSet(foodName);
  const similarity = jaccard(queryTokens, foodTokens);

  let score = similarity;
  if ((food.foodType ?? 'Generic').toLowerCase() === 'generic') {
    score += 0.1;
  }

  if (food.brandName) {
    const brandLower = food.brandName.toLowerCase();
    if (normalizedQuery.includes(brandLower)) {
      score += 0.1;
    } else {
      score -= 0.05;
    }
  }

  const cookPreference = detectCookPreference(normalizedQuery);
  if (cookPreference) {
    const matches = cookPreference === 'cooked'
      ? /cooked|baked|roasted|grilled|boiled|steamed/.test(foodName)
      : /raw|uncooked|fresh|dry/.test(foodName);
    const conflicts = cookPreference === 'cooked'
      ? /raw/.test(foodName)
      : /cooked|baked|roasted|grilled/.test(foodName);
    if (matches) score += 0.1;
    if (conflicts) score -= 0.1;
  }

  if (parsed?.unitHint && foodName.includes(parsed.unitHint.toLowerCase())) {
    score += 0.2;
  }

  if (parsed?.qualifiers && parsed.qualifiers.length > 0) {
    const hits = parsed.qualifiers.filter(q => foodName.includes(q.toLowerCase())).length;
    score += Math.min(0.15, hits * 0.05);
  }

  return score;
}

function selectServing(
  parsed: ParsedIngredient | null,
  servings: FatSecretServing[],
  preferredId?: string | null
): { serving: FatSecretServing; matchScore: number; gramsPerUnit: number | null; unitsPerServing: number; baseGrams: number | null } | null {
  if (!servings.length) return null;
  const qty = parsed ? parsed.qty * parsed.multiplier : 1;
  const unit = parsed?.unit?.toLowerCase() ?? null;
  let best: FatSecretServing | null = null;
  let bestScore = -Infinity;

  for (const serving of servings) {
    let score = 0;
    if (preferredId && serving.id === preferredId) {
      score += 2;
    }
    const description = (serving.description ?? '').toLowerCase();
    if (unit && description.includes(unit)) {
      score += 0.8;
    }
    if (!unit && /100\s*g/.test(description)) {
      score += 0.4;
    }
    if (parsed?.unitHint && description.includes(parsed.unitHint.toLowerCase())) {
      score += 0.3;
    }
    const units = serving.numberOfUnits ?? 1;
    if (qty === units) {
      score += 0.2;
    }
    if (!best || score > bestScore) {
      best = serving;
      bestScore = score;
    }
  }

  if (!best) {
    best = servings[0];
    bestScore = 0;
  }

  const unitsPerServing = best.numberOfUnits && best.numberOfUnits > 0 ? best.numberOfUnits : 1;
  const gramsPerServing = gramsForServing(best);
  const gramsPerUnit = gramsPerServing != null ? gramsPerServing / unitsPerServing : null;

  return {
    serving: best,
    matchScore: clamp(bestScore / 2, 0, 1),
    gramsPerUnit,
    unitsPerServing,
    baseGrams: gramsPerServing,
  };
}

function gramsForServing(serving: FatSecretServing): number | null {
  if (serving.servingWeightGrams && serving.servingWeightGrams > 0) return serving.servingWeightGrams;
  if (serving.metricServingUnit?.toLowerCase() === 'g' && serving.metricServingAmount) {
    return serving.metricServingAmount;
  }
  if (serving.metricServingUnit?.toLowerCase() === 'ml' && serving.metricServingAmount) {
    return serving.metricServingAmount;
  }
  return null;
}

function computeMacros(serving: FatSecretServing, qty: number, unitsPerServing: number) {
  const divisor = unitsPerServing > 0 ? unitsPerServing : 1;
  const factor = qty / divisor;
  if (
    serving.calories == null ||
    serving.protein == null ||
    serving.carbohydrate == null ||
    serving.fat == null
  ) {
    return null;
  }
  return {
    kcal: serving.calories * factor,
    protein: serving.protein * factor,
    carbs: serving.carbohydrate * factor,
    fat: serving.fat * factor,
  };
}

function tokenSet(value: string): Set<string> {
  return new Set(value.split(/[^a-z0-9]+/).filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union > 0 ? intersection / union : 0;
}

function detectCookPreference(query: string): 'cooked' | 'raw' | null {
  if (/cooked|baked|roasted|steamed|grilled|boiled/.test(query)) return 'cooked';
  if (/raw|uncooked|fresh|dry/.test(query)) return 'raw';
  return null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function getDefaultFatSecretConfidence() {
  return FATSECRET_MIN_CONFIDENCE;
}
