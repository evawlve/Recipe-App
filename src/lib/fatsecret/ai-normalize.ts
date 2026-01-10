import 'dotenv/config';
import {
  FATSECRET_CACHE_AI_MODEL,
  OPENAI_API_BASE_URL,
} from './config';
import { getAiNormalizeCache, saveAiNormalizeCache } from './validated-mapping-helpers';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';

type AiNormalizeSuccess = {
  status: 'success';
  normalizedName: string;
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
};

type AiNormalizeError = {
  status: 'error';
  reason: string;
};

export type AiNormalizeResult = AiNormalizeSuccess | AiNormalizeError;

const RESPONSE_SCHEMA = {
  name: 'fatsecret_normalize',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      normalized_name: { type: 'string' },
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
      error: { type: ['string', 'null'] },
    },
    required: ['normalized_name', 'prep_phrases', 'size_phrases', 'synonyms', 'cooking_modifier', 'nutrition_estimate', 'error'],
  },
  strict: true,
};

const SYSTEM_PROMPT = [
  'You normalize ingredient strings for recipe mapping.',
  'Return JSON with: canonical name (no quantity/units), prep/size phrases to strip, synonyms, cooking modifier (if any), and a nutrition estimate.',
  '',
  'CRITICAL: Dietary modifiers that affect nutrition MUST be preserved in normalized_name:',
  '- Fat modifiers: "reduced fat", "low fat", "nonfat", "fat free", "light", "lite", "skim"',
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
  'COOKING MODIFIER: Extract any cooking method (grilled, roasted, fried, boiled, etc) into cooking_modifier field.',
  'This is stripped from normalized_name but preserved for future use.',
  '',
  'NUTRITION ESTIMATE: Provide your best estimate for the RAW/BASE form of the food per 100g:',
  '- calories_per_100g: kcal per 100g',
  '- protein_per_100g, carbs_per_100g, fat_per_100g: grams per 100g',
  '- confidence: 0.0-1.0 (how confident you are in your estimate)',
  'Use common nutritional knowledge. If truly uncertain, set confidence low (0.3-0.5).',
  'Set nutrition_estimate to null only if the food is unrecognizable.',
  '',
  'Examples:',
  '- "1 cup reduced fat colby jack cheese" → normalized_name: "reduced fat colby jack cheese", nutrition_estimate: {calories_per_100g: 280, protein_per_100g: 24, carbs_per_100g: 3, fat_per_100g: 19, confidence: 0.8}',
  '- "grilled chicken breast" → normalized_name: "chicken breast", cooking_modifier: "grilled", nutrition_estimate: {calories_per_100g: 120, protein_per_100g: 23, carbs_per_100g: 0, fat_per_100g: 2.5, confidence: 0.9}',
  '- "2 cup stberry halves" → normalized_name: "strawberry halves" (fix typos), nutrition_estimate: {calories_per_100g: 32, protein_per_100g: 0.7, carbs_per_100g: 7.7, fat_per_100g: 0.3, confidence: 0.95}',
  '- "3 g garlic powder" → normalized_name: "garlic powder" (keep form word!), prep_phrases: [], nutrition_estimate: {calories_per_100g: 331, protein_per_100g: 17, carbs_per_100g: 73, fat_per_100g: 0.7, confidence: 0.9}',
  '',
  'Do not invent foods; stay close to the ingredient meaning. If truly unclear, set error.',
].join('\n');

export async function aiNormalizeIngredient(
  rawLine: string,
  cleanedInput?: string
): Promise<AiNormalizeResult> {
  // Check persistent database cache first
  const cached = await getAiNormalizeCache(rawLine);
  if (cached) {
    return {
      status: 'success',
      ...cached,
    };
  }

  if (!OPENAI_API_KEY) {
    return { status: 'error', reason: 'OPENAI_API_KEY missing' };
  }

  const userPrompt = [
    `Raw: ${rawLine}`,
    cleanedInput ? `Cleaned: ${cleanedInput}` : '',
    'Respond with normalized_name (no qty/unit), prep_phrases, size_phrases, synonyms. If impossible, set error.',
  ]
    .filter(Boolean)
    .join('\n');

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
          { role: 'user', content: userPrompt },
        ],
      }),
    });
    const json = await response.json();
    const content = json?.choices?.[0]?.message?.content;
    if (!content) {
      return { status: 'error', reason: 'empty AI response' };
    }
    const parsed = JSON.parse(content);
    if (parsed.error) {
      return { status: 'error', reason: parsed.error };
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
    const nutritionEstimate = parsed.nutrition_estimate ? {
      caloriesPer100g: parsed.nutrition_estimate.calories_per_100g,
      proteinPer100g: parsed.nutrition_estimate.protein_per_100g,
      carbsPer100g: parsed.nutrition_estimate.carbs_per_100g,
      fatPer100g: parsed.nutrition_estimate.fat_per_100g,
      confidence: parsed.nutrition_estimate.confidence,
    } : undefined;

    const result: AiNormalizeSuccess = {
      status: 'success',
      normalizedName: parsed.normalized_name,
      prepPhrases: parsed.prep_phrases.filter((p: unknown) => typeof p === 'string'),
      sizePhrases: parsed.size_phrases.filter((p: unknown) => typeof p === 'string'),
      synonyms: parsed.synonyms.filter((s: unknown) => typeof s === 'string'),
      cookingModifier: parsed.cooking_modifier || undefined,
      nutritionEstimate,
    };

    // Save to persistent database cache
    await saveAiNormalizeCache(rawLine, {
      normalizedName: result.normalizedName,
      synonyms: result.synonyms,
      prepPhrases: result.prepPhrases,
      sizePhrases: result.sizePhrases,
      cookingModifier: result.cookingModifier,
      nutritionEstimate: result.nutritionEstimate,
    });

    return result;
  } catch (err) {
    return { status: 'error', reason: (err as Error).message };
  }
}
