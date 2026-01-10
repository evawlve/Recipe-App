import type { FatSecretFoodCache, FatSecretServingCache, Prisma } from '@prisma/client';
import {
  FATSECRET_CACHE_AI_MODEL,
  FATSECRET_CACHE_AI_ENABLED,
  FATSECRET_CACHE_AI_CONFIDENCE_MIN,
  FATSECRET_CACHE_AI_BACKFILL_CONFIDENCE_MIN,
  FATSECRET_CACHE_AI_MAX_DENSITY,
  FATSECRET_CACHE_AI_MIN_DENSITY,
  OPENAI_API_BASE_URL,
} from '../fatsecret/config';

export type ServingGapType = 'volume' | 'weight';

export interface AiServingRequest {
  gapType: ServingGapType;
  food: FatSecretFoodCache & { servings: FatSecretServingCache[] };
  /** Specific unit to estimate (e.g., "packet", "scoop", "slice") */
  targetServingUnit?: string;
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
  'You are a nutrition assistant that fills in missing serving data for a FatSecret-backed food cache.',
  'Every response must be valid JSON following the provided schema.',
  'If a realistic convertible volume or weight serving does not exist, return { "error": "reason" }.',
  'When you can provide a serving, prefer canonical nutrition label formats (cups, tbsp, tsp, ml, fl oz, grams, ounces, or explicit counts).',
  'Report your confidence between 0 and 1 and include a short rationale.',
].join(' ');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';

function formatNutrients(nutrients: Prisma.JsonValue | null): string {
  if (!nutrients || typeof nutrients !== 'object') return 'unknown';
  try {
    const data = nutrients as Record<string, unknown>;
    const fragments: string[] = [];
    for (const key of ['calories', 'protein', 'carbohydrate', 'fat', 'fiber']) {
      const value = data[key];
      if (typeof value === 'number') {
        const unit = key === 'calories' ? 'kcal' : 'g';
        fragments.push(`${value}${unit} ${key}/100g`);
      }
    }
    return fragments.length > 0 ? fragments.join(', ') : 'unknown';
  } catch {
    return 'unknown';
  }
}

function formatExistingServings(servings: FatSecretServingCache[]): string {
  if (!servings || servings.length === 0) return 'none';
  return servings
    .map((serving) => {
      const parts = [];
      if (serving.measurementDescription) {
        parts.push(serving.measurementDescription);
      } else if (serving.numberOfUnits != null) {
        parts.push(`${serving.numberOfUnits} unit`);
      }
      if (serving.servingWeightGrams) {
        parts.push(`${serving.servingWeightGrams} g`);
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

function prefersCountServing(food: FatSecretFoodCache): boolean {
  const haystack = [food.name, food.brandName, food.description]
    .filter(Boolean)
    .map((value) => value!.toLowerCase())
    .join(' ');
  return WHOLE_ITEM_KEYWORDS.some((keyword) => haystack.includes(keyword));
}

function buildUserPrompt(request: AiServingRequest): string {
  const { food, gapType, targetServingUnit } = request;
  const lines = [
    `Food name: ${food.name}`,
    `Brand: ${food.brandName ?? 'generic'}`,
    `Type: ${food.foodType ?? 'n/a'}`,
    `Gap type: ${gapType === 'volume' ? 'Need convertible volume serving (cup/tbsp/tsp/ml/fl oz)' : 'Need weight-based serving in grams/ounces'}`,
    `Existing servings:\n${formatExistingServings(food.servings)}`,
    `Per-100g nutrition: ${formatNutrients(food.nutrientsPer100g)}`,
  ];

  // If a specific unit is requested, prioritize that
  if (targetServingUnit) {
    lines.push(
      ``,
      `IMPORTANT: User specifically requested a "${targetServingUnit}" serving.`,
      `Please estimate how many grams 1 ${targetServingUnit} of "${food.name}" weighs.`,
      `The servingLabel should be "1 ${targetServingUnit}" or similar.`,
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
  if (!OPENAI_API_KEY) {
    return { status: 'error', reason: 'OPENAI_API_KEY missing', prompt };
  }

  try {
    const response = await fetch(`${OPENAI_API_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: FATSECRET_CACHE_AI_MODEL,
        response_format: { type: 'json_schema', json_schema: RESPONSE_SCHEMA },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      const errorPayload = await response.text();
      return {
        status: 'error',
        reason: `OpenAI request failed (${response.status})`,
        prompt,
        raw: errorPayload,
      };
    }

    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) {
      return { status: 'error', reason: 'Empty AI response', prompt, raw: payload };
    }

    const parsed = JSON.parse(content) as Record<string, unknown>;
    if (typeof parsed.error === 'string' && parsed.error.length > 0) {
      return { status: 'error', reason: parsed.error, prompt, raw: parsed };
    }

    const suggestion: ServingSuggestion = {
      servingLabel: String(parsed.servingLabel ?? '').trim(),
      grams: typeof parsed.grams === 'number' ? parsed.grams : NaN,
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
