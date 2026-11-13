import 'dotenv/config';
import {
  FATSECRET_CACHE_AI_MODEL,
} from './config';
import { getAiNormalizeCache, saveAiNormalizeCache } from './validated-mapping-helpers';
import { callStructuredLlm } from '../ai/structured-client';
import { isPromptExampleEcho, PROMPT_EXAMPLE_ECHO_REASON } from './llm-output-guards';
import { logger } from '../logger';

// Overall deadline on the normalize LLM call (C70, S239, 2026-10-19). callStructuredLlm()
// bounds each ATTEMPT, but walks retries and a provider-fallback chain with no overall bound:
// one call cost ~54 s of a 2026-10-19 line during an OpenRouter incident. On expiry this
// returns the same { status: 'error' } shape an all-providers-failed call returns, so every
// caller continues exactly as on that path (no hint; no cache write). The race wraps ONLY the
// callStructuredLlm() promise, armed after the cache read, so a cache hit never arms a timer.
// On expiry the call is also ABORTED through callStructuredLlm()'s `signal`: a call still queued
// for a normalize slot leaves the queue without taking one, an in-flight fetch is aborted, and
// no retry or provider fallback starts, so an expired line starts no further request and frees
// its slot at once. (Whether a provider still bills the aborted in-flight request is UNVERIFIED.)
// The race stays, so the deadline holds even if a provider ignores the abort; an answer that
// still arrives is dropped unread, so nothing is saved after the deadline.
// Known risks:
//  - Caller back-pressure is lost: arrivals are no longer throttled by completions.
//  - A line that hits the deadline is hint-less, and the winner retrieval then finds can still
//    be saved to FoodMapping and outlive the incident, exactly as on the all-fail path.
//  - An aborted in-flight attempt counts one /api/ok `failures` (an attempt with no 2xx, as that
//    counter is defined), exactly as a timed-out attempt does.
export const AI_NORMALIZE_DEADLINE_MS = 10_000;
// Distinct from PROMPT_EXAMPLE_ECHO_REASON on purpose: that is the one error reason a caller acts on.
export const AI_NORMALIZE_DEADLINE_REASON = 'normalize_deadline_exceeded';

/**
 * Resolve to the call's result, or to null once AI_NORMALIZE_DEADLINE_MS has passed. On expiry it
 * also aborts the signal it handed to `start`. Always clears its timer.
 */
async function withNormalizeDeadline<T>(start: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      start(controller.signal),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          resolve(null);
          controller.abort();
        }, AI_NORMALIZE_DEADLINE_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Prompt-example echo guard (C70): the model sometimes answers a no-food line with
// an example's name from SYSTEM_PROMPT. aiNormalizeIngredient() refuses that answer,
// cached or fresh, and never saves it. Other callers inherit the guard unchanged:
// `auto-map.ts` (recipe auto-map) and `pattern-learner.ts` (learnPatternsFromAI).

type AiNormalizeSuccess = {
  status: 'success';
  normalizedName: string;
  canonicalBase: string;  // Base ingredient for cache key (e.g., 'strawberries' for 'strawberry halves')
  prepPhrases: string[];
  sizePhrases: string[];
  synonyms: string[];
  cookingModifier?: string;  // Preserved for future food diary use
  nutritionEstimate?: {
    caloriesPer100g: number;
    proteinPer100g: number;
    carbsPer100g: number;
    fatPer100g: number;
    confidence: number;  // 0-1
  };
  // Candidate filtering hints (Jan 2026)
  isBranded: boolean;           // User explicitly wants branded product
  isMultiIngredient: boolean;   // Input contains multiple distinct ingredients
  splitIngredients?: string[];  // If isMultiIngredient, the separated components
};

type AiNormalizeError = {
  status: 'error';
  reason: string;
};

export type AiNormalizeResult = AiNormalizeSuccess | AiNormalizeError;

export const RESPONSE_SCHEMA = {
  name: 'fatsecret_normalize',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      normalized_name: { type: 'string' },
      canonical_base: { type: 'string' },  // Base ingredient for cache (e.g., 'strawberries' for 'strawberry halves')
      prep_phrases: { type: 'array', items: { type: 'string' } },
      size_phrases: { type: 'array', items: { type: 'string' } },
      synonyms: { type: 'array', items: { type: 'string' } },
      cooking_modifier: { type: ['string', 'null'] },
      nutrition_estimate: {
        type: ['object', 'null'],
        properties: {
          calories_per_100g: { type: 'number' },
          protein_per_100g: { type: 'number' },
          carbs_per_100g: { type: 'number' },
          fat_per_100g: { type: 'number' },
          confidence: { type: 'number' },
        },
        required: ['calories_per_100g', 'protein_per_100g', 'carbs_per_100g', 'fat_per_100g', 'confidence'],
        additionalProperties: false,
      },
      // Candidate filtering hints (Jan 2026)
      is_branded: { type: 'boolean' },
      is_multi_ingredient: { type: 'boolean' },
      split_ingredients: { type: ['array', 'null'], items: { type: 'string' } },
      error: { type: ['string', 'null'] },
    },
    required: ['normalized_name', 'canonical_base', 'prep_phrases', 'size_phrases', 'synonyms', 'cooking_modifier', 'nutrition_estimate', 'is_branded', 'is_multi_ingredient', 'split_ingredients', 'error'],
  },
  strict: true,
};

export const SYSTEM_PROMPT = [
  'You normalize ingredient strings for recipe mapping.',
  'Return JSON with: canonical name (no quantity/units), canonical_base (base ingredient for caching), prep/size phrases, synonyms, cooking modifier (if any), and nutrition estimate.',
  '',
  'CANONICAL_BASE RULES (CRITICAL - affects cache lookups):',
  '- Strip ONLY prep/size words: "strawberry halves" → canonical_base: "strawberries"',
  '- Use plural form when common: "strawberry" → "strawberries", "egg" → "eggs"',
  '- MUST PRESERVE nutrition-affecting modifiers in BOTH normalized_name AND canonical_base:',
  '  - "fat free milk" → canonical_base: "fat free milk" (NOT just "milk")',
  '  - "skim milk" → canonical_base: "skim milk" (NOT just "milk")',
  '  - "unsweetened almond milk" → canonical_base: "unsweetened almond milk" (NOT just "almond milk")',
  '  - "reduced fat cream cheese" → canonical_base: "reduced fat cream cheese"',
  '  - "sugar free pudding" → canonical_base: "sugar free pudding"',
  '  - EGG PARTS are distinct foods: "egg whites" → canonical_base: "egg whites" (NOT "eggs"); "egg yolks" → canonical_base: "egg yolks" (NOT "eggs")',
  '  - COOKED STATE changes nutrition per gram: "cooked quinoa" → canonical_base: "cooked quinoa" (NOT "quinoa"); "cooked rice" → canonical_base: "cooked rice". Preserve "cooked" in normalized_name AND canonical_base — do NOT move it to cooking_modifier.',
  '- BRANDS: When is_branded=true, INCLUDE the brand name (lowercase) in canonical_base:',
  '  - "Philadelphia cream cheese" → canonical_base: "philadelphia cream cheese", is_branded: true',
  '  - "Kerrygold butter" → canonical_base: "kerrygold butter", is_branded: true',
  '  - "Kraft singles" → canonical_base: "kraft cheese singles", is_branded: true',
  '  - "cream cheese" (generic) → canonical_base: "cream cheese", is_branded: false',
  '- ALLOWED TO STRIP: prep words (diced, chopped), size words (halves, cubes), freshness (fresh)',
  '- Examples: "diced tomatoes" → canonical_base: "tomatoes", "fresh basil leaves" → canonical_base: "basil"',
  '',
  'NUTRITION-AFFECTING MODIFIERS (NEVER strip from normalized_name OR canonical_base):',
  '- Fat modifiers: "reduced fat", "low fat", "nonfat", "fat free", "light", "lite", "skim"',
  '- CONVERT "extra light" → "fat free" (they are equivalent)',
  '- Calorie modifiers: "low calorie", "diet", "zero calorie", "sugar free"',
  '- Sodium modifiers: "low sodium", "reduced sodium", "no salt"',
  '- Sugar modifiers: "unsweetened", "sweetened", "no sugar added"',
  '- Lean modifiers: "lean", "extra lean", and ANY lean percentages like "85%", "90%", "93%", "80/20", "85/15", "90/10"',
  '',
  'FORM WORDS: These indicate a DIFFERENT INGREDIENT FORM and must be PRESERVED in normalized_name:',
  '- Processing forms: "powder", "powdered", "ground", "granulated", "flakes", "flaked", "crushed", "dried", "dehydrated"',
  '- Examples: "garlic powder" is NOT the same as "garlic" - keep "garlic powder"',
  '- Examples: "onion flakes" is NOT the same as "onion" - keep "onion flakes"',
  '- Examples: "red pepper flakes" must stay as "red pepper flakes"',
  '- DO NOT add these to prep_phrases when they form a distinct product name',
  '',
  'NORMALIZATION RULES:',
  '- Remove hyphens from compound modifiers: "reduced-fat" → "reduced fat", "sugar-free" → "sugar free"',
  '- Strip assumed part-names: "parsley leaves" → "parsley", "garlic cloves" → "garlic", "celery stalks" → "celery"',
  '- Keep natural word order (do NOT reorder to noun-first): "extra lean ground beef" stays as-is',
  '',
  'RICE DEFAULT: When "rice" is specified without a color modifier (white/brown/wild/black/red), default to WHITE rice.',
  '- "rice long-grain" → normalized_name: "white rice long-grain", canonical_base: "white rice long-grain"',
  '- "4 cups rice" → normalized_name: "white rice", canonical_base: "white rice"',
  '- "brown rice" → normalized_name: "brown rice" (preserve explicit modifier)',
  '- "wild rice" → normalized_name: "wild rice" (preserve explicit modifier)',
  '',
  'COOKING MODIFIER: Record any cooking method (grilled, roasted, fried, boiled, etc) in cooking_modifier.',
  'KEEP it in normalized_name as well — it is a copy, NOT a move. The cooking state changes',
  'nutrition per gram, so dropping it makes the modifier-bearing line share a cache key with the',
  'bare line and bill the wrong basis (see the COOKED STATE rule above — same reasoning, all methods).',
  '',
  'PRODUCT TYPE PHRASES (do NOT strip - these are product types not cooking methods):',
  '- For canned/packaged products, phrases like "fire roasted", "sun dried", "oven roasted" describe the PRODUCT TYPE.',
  '- These must be KEPT in normalized_name because they affect which product to match.',
  '- Examples:',
  '  - "fire roasted tomatoes" → normalized_name: "fire roasted tomatoes", cooking_modifier: null',
  '  - "fire roasted diced tomatoes" → normalized_name: "fire roasted diced tomatoes"',
  '  - "sun dried tomatoes" → normalized_name: "sun dried tomatoes"',
  '  - "oven roasted turkey" (deli product) → normalized_name: "oven roasted turkey"',
  '- AND: "roasted chicken" (home cooking) → normalized_name: "roasted chicken", cooking_modifier: "roasted"',
  '- Rule: keep the descriptor either way. The packaged/home distinction decides what cooking_modifier',
  '  says, not whether normalized_name keeps the word.',
  '',
  'NUTRITION ESTIMATE: Estimate per 100g of the food IN THE STATE THE LINE STATES — cooked if the',
  'line says cooked, raw only if the line says raw or states nothing. Cooking drives off water and',
  'concentrates every macro, so a raw panel billed against a cooked line under-reports it:',
  '- calories_per_100g: kcal per 100g',
  '- protein_per_100g, carbs_per_100g, fat_per_100g: grams per 100g',
  '- confidence: 0.0-1.0 (how confident you are in your estimate)',
  'Use common nutritional knowledge. If truly uncertain, set confidence low (0.3-0.5).',
  'Set nutrition_estimate to null only if the food is unrecognizable.',
  '',
  'Examples:',
  '- "1 cup reduced fat colby jack cheese" → normalized_name: "reduced fat colby jack cheese", nutrition_estimate: {calories_per_100g: 280, protein_per_100g: 24, carbs_per_100g: 3, fat_per_100g: 19, confidence: 0.8}',
  '- "grilled chicken breast" → normalized_name: "grilled chicken breast", cooking_modifier: "grilled", nutrition_estimate: {calories_per_100g: 165, protein_per_100g: 31, carbs_per_100g: 0, fat_per_100g: 3.6, confidence: 0.9}',
  '- "chicken breast" (no state stated) → normalized_name: "chicken breast", cooking_modifier: null, nutrition_estimate: {calories_per_100g: 120, protein_per_100g: 23, carbs_per_100g: 0, fat_per_100g: 2.5, confidence: 0.9}',
  '- "2 cup stberry halves" → normalized_name: "strawberry halves", canonical_base: "strawberries" (fix typos, base for caching), nutrition_estimate: {calories_per_100g: 32, protein_per_100g: 0.7, carbs_per_100g: 7.7, fat_per_100g: 0.3, confidence: 0.95}',
  '- "3 g garlic powder" → normalized_name: "garlic powder" (keep form word!), prep_phrases: [], nutrition_estimate: {calories_per_100g: 331, protein_per_100g: 17, carbs_per_100g: 73, fat_per_100g: 0.7, confidence: 0.9}',
  '',
  'BRANDED DETECTION (is_branded):',
  'Set is_branded=true if the user explicitly mentions a brand name or product line:',
  '- "Violife cream cheese" → is_branded: true',
  '- "Kraft singles" → is_branded: true',
  '- "cream cheese" → is_branded: false (generic)',
  '- "organic milk" → is_branded: false (organic is a category, not brand)',
  '',
  'MULTI-INGREDIENT DETECTION (is_multi_ingredient):',
  'Set is_multi_ingredient=true if input contains TWO DISTINCT ingredients that would be measured separately:',
  '- "salt and pepper" → is_multi_ingredient: true, split_ingredients: ["salt", "pepper"]',
  '- "sour cream and onion dip" → is_multi_ingredient: false (this is ONE product name)',
  '- "chilli peppers cream cheese" → is_multi_ingredient: false (ONE compound product)',
  'The key distinction: Would you need to measure/add these separately in a recipe?',
  'When is_multi_ingredient=true, normalize the FIRST ingredient and list all in split_ingredients.',
  '',
  'Do not invent foods; stay close to the ingredient meaning. If truly unclear, set error.',
].join('\n');

/**
 * Spanish-only clause (C6970 D30, punch #170 layer 2). Sent ONLY when the caller passes
 * `opts.spanish` (isSpanishLine() true), appended to SYSTEM_PROMPT; an English request is
 * byte-identical to before. Goal: a Spanish line gets the English food name as
 * `normalized_name`, so its FoodMapping key joins the curated English universe (`huevos` -> `eggs`
 * -> the `egg` key). The examples here are deliberately NOT in PROMPT_EXAMPLE_IDENTITIES
 * (llm-output-guards.ts): the echo guard would refuse a genuine `dos huevos` -> `eggs`.
 */
export const SPANISH_CLAUSE = [
  '',
  'SPANISH INPUT: If the input food name is in Spanish, `normalized_name` and `canonical_base` MUST be the common English name of that food (huevos → eggs, leche → milk, arroz → rice, frijoles → beans, pollo → chicken).',
  '- Keep a dish name that has no English name as written (bolillo, pozole, mole, concha, pan dulce, torta, nieve, tres leches). Never translate a brand.',
  '- Translate nutrition and state modifiers too: sin azúcar → sugar free, descremada → skim, deslactosada → lactose free, sin grasa → fat free, light → light, integral → whole wheat, cocido → cooked.',
  '- medio/media means half (a quantity, never "medium"); un/una/dos are quantities, never part of the name.',
].join('\n');

/** AiNormalizeCache key sub-space for Spanish lines, so a Spanish and an English line never share an entry (same device as `SIMPLIFY:`). */
export const SPANISH_CACHE_NAMESPACE = 'ES:';

export async function aiNormalizeIngredient(
  rawLine: string,
  cleanedInput?: string,
  opts?: { spanish?: boolean }
): Promise<AiNormalizeResult> {
  // Spanish lines use their own cache namespace and prompt; English lines are unchanged.
  const cacheOpts = opts?.spanish ? { namespace: SPANISH_CACHE_NAMESPACE } : undefined;
  const systemPrompt = opts?.spanish ? `${SYSTEM_PROMPT}\n${SPANISH_CLAUSE}` : SYSTEM_PROMPT;
  // Check persistent database cache first
  const cached = await (cacheOpts ? getAiNormalizeCache(rawLine, cacheOpts) : getAiNormalizeCache(rawLine));
  if (cached) {
    // A poisoned row written before the guard existed: refuse it on replay too.
    if (isPromptExampleEcho(rawLine, cached.normalizedName)) {
      return { status: 'error', reason: PROMPT_EXAMPLE_ECHO_REASON };
    }
    // getAiNormalizeCache's projection supplies isBranded, isMultiIngredient and
    // splitIngredients directly; the column defaults cover rows written before those
    // columns existed. The `(cached as any)` casts that used to sit here read fields
    // the projection never returned, so they resolved to undefined every single time.
    return {
      status: 'success',
      ...cached,
    };
  }

  // Check if no API keys are configured
  // (callStructuredLlm will handle the actual key check)

  const userPrompt = [
    `Raw: ${rawLine}`,
    cleanedInput ? `Cleaned: ${cleanedInput}` : '',
    'Respond with normalized_name (no qty/unit), prep_phrases, size_phrases, synonyms. If impossible, set error.',
  ]
    .filter(Boolean)
    .join('\n');

  try {
    const result = await withNormalizeDeadline((signal) => callStructuredLlm({
      schema: RESPONSE_SCHEMA,
      systemPrompt,
      userPrompt,
      purpose: 'normalize',
      signal,
    }));

    if (result === null) {
      logger.warn('ai_normalize.deadline_exceeded', { rawLine, deadlineMs: AI_NORMALIZE_DEADLINE_MS });
      return { status: 'error', reason: AI_NORMALIZE_DEADLINE_REASON };
    }

    if (result.status === 'error') {
      return { status: 'error', reason: result.error ?? 'unknown error' };
    }

    const parsed = result.content as Record<string, unknown>;
    if (parsed.error) {
      return { status: 'error', reason: parsed.error as string };
    }
    if (
      typeof parsed.normalized_name !== 'string' ||
      !Array.isArray(parsed.prep_phrases) ||
      !Array.isArray(parsed.size_phrases) ||
      !Array.isArray(parsed.synonyms)
    ) {
      return { status: 'error', reason: 'invalid AI response schema' };
    }
    // Extract nutrition estimate if present
    const nutritionRaw = parsed.nutrition_estimate as Record<string, number> | null | undefined;
    const nutritionEstimate = nutritionRaw ? {
      caloriesPer100g: nutritionRaw.calories_per_100g,
      proteinPer100g: nutritionRaw.protein_per_100g,
      carbsPer100g: nutritionRaw.carbs_per_100g,
      fatPer100g: nutritionRaw.fat_per_100g,
      confidence: nutritionRaw.confidence,
    } : undefined;

    const normalizeResult: AiNormalizeSuccess = {
      status: 'success',
      normalizedName: parsed.normalized_name as string,
      canonicalBase: (parsed.canonical_base as string) || (parsed.normalized_name as string),  // Fallback for backward compatibility
      prepPhrases: (parsed.prep_phrases as unknown[]).filter((p: unknown) => typeof p === 'string') as string[],
      sizePhrases: (parsed.size_phrases as unknown[]).filter((p: unknown) => typeof p === 'string') as string[],
      synonyms: (parsed.synonyms as unknown[]).filter((s: unknown) => typeof s === 'string') as string[],
      cookingModifier: (parsed.cooking_modifier as string) || undefined,
      nutritionEstimate,
      // Candidate filtering hints (Jan 2026)
      isBranded: (parsed.is_branded as boolean) ?? false,
      isMultiIngredient: (parsed.is_multi_ingredient as boolean) ?? false,
      splitIngredients: (parsed.split_ingredients as unknown[] | null)?.filter((s: unknown) => typeof s === 'string') as string[] ?? undefined,
    };

    // Echo of a prompt example for a line that names no such food: fail, do NOT cache.
    if (isPromptExampleEcho(rawLine, normalizeResult.normalizedName)) {
      return { status: 'error', reason: PROMPT_EXAMPLE_ECHO_REASON };
    }

    // Log warning if multi-ingredient detected (mapped to first ingredient only)
    if (normalizeResult.isMultiIngredient && normalizeResult.splitIngredients?.length) {
      console.warn(`[ai-normalize] Multi-ingredient detected: "${rawLine}" → mapping first ingredient only. All ingredients: ${normalizeResult.splitIngredients.join(', ')}`);
    }

    // Save to persistent database cache
    await saveAiNormalizeCache(rawLine, {
      normalizedName: normalizeResult.normalizedName,
      canonicalBase: normalizeResult.canonicalBase,
      synonyms: normalizeResult.synonyms,
      prepPhrases: normalizeResult.prepPhrases,
      sizePhrases: normalizeResult.sizePhrases,
      cookingModifier: normalizeResult.cookingModifier,
      isBranded: normalizeResult.isBranded,
      isMultiIngredient: normalizeResult.isMultiIngredient,
      splitIngredients: normalizeResult.splitIngredients,
      nutritionEstimate: normalizeResult.nutritionEstimate,
    }, ...(cacheOpts ? [cacheOpts] : []));

    return normalizeResult;
  } catch (err) {
    return { status: 'error', reason: (err as Error).message };
  }
}
