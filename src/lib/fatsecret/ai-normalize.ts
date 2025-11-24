import 'dotenv/config';
import {
  FATSECRET_CACHE_AI_MODEL,
  OPENAI_API_BASE_URL,
} from './config';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';

type AiNormalizeSuccess = {
  status: 'success';
  normalizedName: string;
  prepPhrases: string[];
  sizePhrases: string[];
  synonyms: string[];
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
      error: { type: ['string', 'null'] },
    },
    required: ['normalized_name', 'prep_phrases', 'size_phrases', 'synonyms', 'error'],
  },
  strict: true,
};

const SYSTEM_PROMPT = [
  'You normalize ingredient strings for recipe mapping.',
  'Return JSON with a canonical name (no quantity or units), prep phrases to strip, size phrases to strip, and helpful synonyms.',
  'Do not invent foods; stay close to the ingredient meaning. If truly unclear, set error.',
].join(' ');

const cache = new Map<string, AiNormalizeSuccess>();

export async function aiNormalizeIngredient(
  rawLine: string,
  cleanedInput?: string
): Promise<AiNormalizeResult> {
  if (cache.has(rawLine)) {
    return cache.get(rawLine)!;
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
    const result: AiNormalizeSuccess = {
      status: 'success',
      normalizedName: parsed.normalized_name,
      prepPhrases: parsed.prep_phrases.filter((p: unknown) => typeof p === 'string'),
      sizePhrases: parsed.size_phrases.filter((p: unknown) => typeof p === 'string'),
      synonyms: parsed.synonyms.filter((s: unknown) => typeof s === 'string'),
    };
    cache.set(rawLine, result);
    return result;
  } catch (err) {
    return { status: 'error', reason: (err as Error).message };
  }
}
