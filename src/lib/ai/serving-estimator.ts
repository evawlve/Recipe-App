import type { Prisma } from '@prisma/client';
import {
  FATSECRET_CACHE_AI_ENABLED,
  FATSECRET_CACHE_AI_CONFIDENCE_MIN,
  FATSECRET_CACHE_AI_BACKFILL_CONFIDENCE_MIN,
  FATSECRET_CACHE_AI_MAX_DENSITY,
  FATSECRET_CACHE_AI_MIN_DENSITY,
} from '../fatsecret/config';
import { callStructuredLlm } from './structured-client';

export type ServingGapType = 'volume' | 'weight';

// ============================================================
// Unified Types for AI Serving Estimation
// Works with both FatSecret and FDC food sources
// ============================================================

export interface UnifiedServingForAi {
  description: string;
  grams: number | null;
  volumeMl: number | null;
}

export interface UnifiedFoodForAi {
  id: string;
  name: string;
  brandName: string | null;
  foodType: string | null;
  nutrientsPer100g: {
    calories?: number;
    protein?: number;
    carbohydrate?: number;
    fat?: number;
    fiber?: number;
  };
  servings: UnifiedServingForAi[];
  source: 'fatsecret' | 'fdc';
}

export interface AiServingRequest {
  gapType: ServingGapType;
  food: UnifiedFoodForAi;
  /** Specific unit to estimate (e.g., "packet", "scoop", "slice") */
  targetServingUnit?: string;
  /** Prep modifier to include in serving label (e.g., "cubed", "minced", "sliced") */
  prepModifier?: string;
  /** Use lower confidence threshold for on-demand backfills (user can see/override grams) */
  isOnDemandBackfill?: boolean;
}


export interface ServingSuggestion {
  servingLabel: string;
  grams: number;
  volumeUnit?: string;
  volumeAmount?: number;
  confidence: number;
  rationale?: string;
  /** The prep modifier that was used (passed through from request) */
  prepModifier?: string;
}

export type AiServingResult =
  | {
    status: 'success';
    suggestion: ServingSuggestion;
    prompt: string;
    raw: unknown;
  }
  | {
    status: 'error';
    reason: string;
    prompt: string;
    raw?: unknown;
  };

const RESPONSE_SCHEMA = {
  name: 'fatsecret_serving_suggestion',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      servingLabel: { type: 'string' },
      grams: { type: 'number' },
      volumeUnit: { type: ['string', 'null'] },
      volumeAmount: { type: ['number', 'null'] },
      confidence: { type: 'number' },
      rationale: { type: ['string', 'null'] },
      error: { type: ['string', 'null'] },
    },
    required: [
      'servingLabel',
      'grams',
      'volumeUnit',
      'volumeAmount',
      'confidence',
      'rationale',
      'error',
    ],
  },
  strict: true,
};

const SYSTEM_PROMPT = [
  'You are a nutrition assistant that fills in missing serving data for food items.',
  'Every response must be valid JSON following the provided schema.',
  'If a realistic convertible volume or weight serving does not exist, return { "error": "reason" }.',
  'When you can provide a serving, prefer canonical nutrition label formats (cups, tbsp, tsp, ml, fl oz, grams, ounces, or explicit counts).',
  'Report your confidence between 0 and 1 and include a short rationale.',
].join(' ');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';

function formatNutrients(nutrients: UnifiedFoodForAi['nutrientsPer100g']): string {
  if (!nutrients) return 'unknown';
  try {
    const fragments: string[] = [];
    if (nutrients.calories != null) fragments.push(`${nutrients.calories}kcal calories/100g`);
    if (nutrients.protein != null) fragments.push(`${nutrients.protein}g protein/100g`);
    if (nutrients.carbohydrate != null) fragments.push(`${nutrients.carbohydrate}g carbohydrate/100g`);
    if (nutrients.fat != null) fragments.push(`${nutrients.fat}g fat/100g`);
    if (nutrients.fiber != null) fragments.push(`${nutrients.fiber}g fiber/100g`);
    return fragments.length > 0 ? fragments.join(', ') : 'unknown';
  } catch {
    return 'unknown';
  }
}

function formatExistingServings(servings: UnifiedServingForAi[]): string {
  if (!servings || servings.length === 0) return 'none';
  return servings
    .map((serving) => {
      const parts = [];
      if (serving.description) {
        parts.push(serving.description);
      }
      if (serving.grams) {
        parts.push(`${serving.grams} g`);
      }
      if (serving.volumeMl) {
        parts.push(`${serving.volumeMl} ml`);
      }
      return `- ${parts.join(' / ') || 'Unnamed serving'}`;
    })
    .join('\n');
}

const WHOLE_ITEM_KEYWORDS = [
  'breast',
  'thigh',
  'wing',
  'drumstick',
  'tenderloin',
  'steak',
  'fillet',
  'filet',
  'whole',
  'bagel',
  'bun',
  'tortilla',
  'pita',
  'egg',
  'avocado',
  'tomato',
  'pepper',
  'apple',
  'pear',
  'carrot',
  'zucchini',
  'cucumber',
];

function prefersCountServing(food: UnifiedFoodForAi): boolean {
  const haystack = [food.name, food.brandName, food.foodType]
    .filter(Boolean)
    .map((value) => value!.toLowerCase())
    .join(' ');
  return WHOLE_ITEM_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

/** Density adjustment factors for different prep methods - exported for use in backfill */
export const PREP_MODIFIER_DENSITY_HINTS: Record<string, { factor: number; description: string }> = {
  cubed: { factor: 0.85, description: 'Air gaps between cubes → lighter per cup' },
  diced: { factor: 0.90, description: 'Smaller pieces, fewer gaps' },
  sliced: { factor: 0.92, description: 'Flat pieces stack loosely' },
  chopped: { factor: 1.00, description: 'Standard density reference' },
  minced: { factor: 1.10, description: 'Fine pieces pack tightly' },
  grated: { factor: 1.15, description: 'Very fine, high packing density' },
  mashed: { factor: 1.05, description: 'No air gaps, slightly compressed' },
  shredded: { factor: 0.80, description: 'Loose strands with lots of air' },
  crushed: { factor: 1.20, description: 'Broken down, packs very densely' },
  julienned: { factor: 0.88, description: 'Thin strips with air gaps' },
  pureed: { factor: 1.00, description: 'Liquid-like, no air gaps' },
};

function buildUserPrompt(request: AiServingRequest): string {
  const { food, gapType, targetServingUnit, prepModifier } = request;
  const lines = [
    `Food name: ${food.name}`,
    `Brand: ${food.brandName ?? 'generic'}`,
    `Type: ${food.foodType ?? 'n/a'}`,
    `Gap type: ${gapType === 'volume' ? 'Need convertible volume serving (cup/tbsp/tsp/ml/fl oz)' : 'Need weight-based serving in grams/ounces'}`,
    `Existing servings:\n${formatExistingServings(food.servings)}`,
    `Per-100g nutrition: ${formatNutrients(food.nutrientsPer100g)}`,
  ];

  // If a prep modifier is provided, add context about density adjustment
  if (prepModifier) {
    const hint = PREP_MODIFIER_DENSITY_HINTS[prepModifier.toLowerCase()];
    lines.push(
      ``,
      `PREP MODIFIER: The ingredient is "${prepModifier}".`,
      `IMPORTANT: The serving label MUST include this modifier (e.g., "1 cup ${prepModifier}" not "1 cup").`,
    );
    if (hint) {
      lines.push(
        `Density hint: ${hint.description}`,
        `Adjust gram weight by approximately ${((hint.factor - 1) * 100).toFixed(0)}% compared to unprepared form.`,
      );
    }
  }

  // If a specific unit is requested, prioritize that
  if (targetServingUnit) {
    const labelWithModifier = prepModifier ? `${targetServingUnit} ${prepModifier}` : targetServingUnit;
    lines.push(
      ``,
      `IMPORTANT: User specifically requested a "${targetServingUnit}" serving.`,
      `Please estimate how many grams 1 ${labelWithModifier} of "${food.name}" weighs.`,
      `The servingLabel should be "1 ${labelWithModifier}" or similar.`,
      `Set volumeUnit to "${targetServingUnit}" and volumeAmount to 1.`,
    );
  }

  lines.push(
    '',
    'Instructions:',
    '- Provide exactly one serving suggestion.',
    '- Prefer official label units if available.',
    '- If returning a volume serving, also estimate its grams.',
    "- If cups/tbsp/ml aren't realistic but a count-based portion is (e.g., 1 tortilla, 2 bagels, 1 egg), return that count and its grams instead of throwing an error, and set volumeUnit to 'count' (or a similar label) with volumeAmount equal to the count.",
    '- For any solid, whole item (proteins, whole fruits/veggies, baked goods), avoid ml/tbsp unless the food can genuinely be scooped or poured; use a count-based portion instead.',
    '- Only return { "error": "no convertible serving" } when no reasonable label/count/volume can be provided.',
  );
  if (prefersCountServing(food)) {
    lines.push(
      'This food is a solid, whole item. Prefer a count-based portion (e.g., "1 chicken breast", "1 bagel") over cups/tbsp/ml unless a true liquid/puree serving is available.',
      "Avoid inventing milliliter/cup servings for intact pieces; instead use volumeUnit='count' (or similar) with volumeAmount equal to the count.",
    );
  }
  return lines.join('\n');
}

export async function requestAiServing(request: AiServingRequest): Promise<AiServingResult> {
  const prompt = buildUserPrompt(request);

  if (!FATSECRET_CACHE_AI_ENABLED) {
    return { status: 'error', reason: 'AI backfill disabled', prompt };
  }
  if (!OPENAI_API_KEY && !process.env.OPENROUTER_API_KEY) {
    return { status: 'error', reason: 'No API keys configured', prompt };
  }

  try {
    const result = await callStructuredLlm({
      schema: RESPONSE_SCHEMA,
      systemPrompt: SYSTEM_PROMPT,
      userPrompt: prompt,
      purpose: 'serving',
    });

    if (result.status === 'error') {
      return { status: 'error', reason: result.error ?? 'unknown error', prompt };
    }

    const parsed = result.content as Record<string, unknown>;
    if (typeof parsed.error === 'string' && parsed.error.length > 0) {
      return { status: 'error', reason: parsed.error, prompt, raw: parsed };
    }

    // Handle model non-compliance: some models return 'serving' instead of 'servingLabel'
    // Also handle 'label', 'servingDescription', etc.
    const servingLabelRaw = parsed.servingLabel ?? parsed.serving ?? parsed.label ?? parsed.servingDescription ?? '';

    // Handle model non-compliance: some models use 'weightGrams' or 'weight' instead of 'grams'
    const gramsRaw = parsed.grams ?? parsed.weightGrams ?? parsed.weight;

    const suggestion: ServingSuggestion = {
      servingLabel: String(servingLabelRaw).trim(),
      grams: typeof gramsRaw === 'number' ? gramsRaw : NaN,
      volumeUnit:
        typeof parsed.volumeUnit === 'string' && parsed.volumeUnit.trim().length > 0
          ? parsed.volumeUnit.trim()
          : undefined,
      volumeAmount: typeof parsed.volumeAmount === 'number' ? parsed.volumeAmount : undefined,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : NaN,
      rationale:
        typeof parsed.rationale === 'string' && parsed.rationale.length > 0
          ? parsed.rationale
          : undefined,
      prepModifier: request.prepModifier,
    };

    if (!suggestion.servingLabel || Number.isNaN(suggestion.grams)) {
      return { status: 'error', reason: 'Incomplete AI response', prompt, raw: parsed };
    }

    // Use lower threshold for on-demand backfills (user can see and override the gram amount)
    const minConfidence = request.isOnDemandBackfill
      ? FATSECRET_CACHE_AI_BACKFILL_CONFIDENCE_MIN
      : FATSECRET_CACHE_AI_CONFIDENCE_MIN;

    if (suggestion.confidence < minConfidence) {
      return { status: 'error', reason: `low confidence (${suggestion.confidence.toFixed(2)} < ${minConfidence})`, prompt, raw: parsed };
    }

    const normalizedUnit = suggestion.volumeUnit?.toLowerCase?.().trim();
    const countUnitSet = new Set([
      'count', 'item', 'items', 'piece', 'pieces',
      'packet', 'packets', 'sachet', 'sachets', 'pouch', 'pouches',
      'scoop', 'scoops', 'stick', 'sticks', 'bar', 'bars',
      'envelope', 'envelopes', 'serving', 'servings',
      'slice', 'slices', 'egg', 'eggs', 'tortilla', 'tortillas',
    ]);
    const isCountUnit = normalizedUnit ? countUnitSet.has(normalizedUnit) : false;
    if (!isCountUnit && suggestion.volumeAmount && suggestion.volumeUnit) {
      const volumeMl = toMilliliters(suggestion.volumeUnit, suggestion.volumeAmount);
      if (!volumeMl) {
        return { status: 'error', reason: 'unknown volume unit', prompt, raw: parsed };
      }
      const density = suggestion.grams / volumeMl;
      if (
        density < FATSECRET_CACHE_AI_MIN_DENSITY ||
        density > FATSECRET_CACHE_AI_MAX_DENSITY
      ) {
        return {
          status: 'error',
          reason: 'density outside allowed range',
          prompt,
          raw: parsed,
        };
      }
    }

    return { status: 'success', suggestion, prompt, raw: parsed };
  } catch (error) {
    return { status: 'error', reason: (error as Error).message, prompt };
  }
}
const VOLUME_UNIT_TO_ML: Record<string, number> = {
  cup: 240,
  cups: 240,
  tbsp: 15,
  tablespoon: 15,
  tablespoons: 15,
  tsp: 5,
  teaspoon: 5,
  teaspoons: 5,
  ml: 1,
  milliliter: 1,
  milliliters: 1,
  'fl oz': 30,
  floz: 30,
  'fluid ounce': 30,
  'fluid ounces': 30,
  ounce: 30,
  ounces: 30,
};

function toMilliliters(unit: string | undefined, amount: number | undefined): number | null {
  if (!unit || !amount || amount <= 0) return null;
  const scale = VOLUME_UNIT_TO_ML[unit.toLowerCase()];
  if (!scale) return null;
  return amount * scale;
}
