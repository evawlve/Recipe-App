/**
 * ai-segmenter.ts — the LLM text→items splitter for magic-log parsing.
 *
 * Extracted from app/api/nlp/parse/route.ts so the segmentation prompt, output
 * schema, timeouts, and the SegmentationCache version stamp live in ONE place.
 *
 * AI-first segmentation: the cheap LLM splitter (CHEAP_AI_MODEL_PRIMARY via
 * OpenRouter — gpt-4o-mini, ~$0.0003/call, magic-log is rate-capped) is the
 * unconditional first step for any multi-token / delimited log. The
 * deterministic heuristic is deliberately NOT on the primary path — it
 * survives only as forceSegmentText, the fallback used when the LLM errors or
 * exceeds its deadline. This removes the class of silent heuristic mis-splits
 * (flavor "and" like "cookies and cream", ambiguous "with" attachments) that a
 * static phrase whitelist could never keep up with. The mapper is then fed
 * clean, AI-segmented food names while quantity/units stay deterministic — the
 * goal being fewer AI guesses in the *mapping* stage, not the (cheap)
 * segmentation stage.
 */

import { callStructuredLlm } from '@/lib/ai/structured-client';

/**
 * ⚠️⚠️ SEGMENTATION PARSER VERSION — BUMP THIS ON ANY CHANGE TO: ⚠️⚠️
 *   - SEGMENT_SYSTEM_PROMPT (split semantics, examples, meal-type rules)
 *   - NLP_SPLIT_SCHEMA (output shape / fields)
 *   - the model or provider serving purpose 'parse' (structured-client
 *     provider chain, CHEAP_AI_MODEL_PRIMARY, Ollama routing)
 *
 * SegmentationCache rows are keyed [lineKey, parserVersion]; rows written
 * under an old version are simply never read again (the sliding 30d TTL
 * garbage-collects them). Bumping is always safe and cheap — forgetting to
 * bump serves STALE segmentations for up to 30 days.
 */
export const SEG_PARSER_VERSION = 'seg-v1';

export type SegmentedMealType = 'breakfast' | 'lunch' | 'dinner' | 'snacks';

export interface SegmentedItem {
  rawText: string;
  mealType: SegmentedMealType;
  brand: string;
  normalizedForm: string;
}

const MEAL_TYPES: ReadonlySet<string> = new Set(['breakfast', 'lunch', 'dinner', 'snacks']);

/**
 * Shape guard for SegmentedItem[] — used to validate LLM output before
 * caching and cached segmentsJson blobs before serving (a malformed cached
 * row must read as a miss, never crash the request).
 */
export function isSegmentedItemArray(value: unknown): value is SegmentedItem[] {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((it) => {
    if (!it || typeof it !== 'object') return false;
    const item = it as Record<string, unknown>;
    return (
      typeof item.rawText === 'string' && item.rawText.trim() !== '' &&
      typeof item.mealType === 'string' && MEAL_TYPES.has(item.mealType) &&
      typeof item.brand === 'string' &&
      typeof item.normalizedForm === 'string'
    );
  });
}

const NLP_SPLIT_SCHEMA = {
  name: 'nlp_split',
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      items: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            rawText: { type: 'string' },
            mealType: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snacks'] },
            brand: { type: 'string' },
            normalizedForm: { type: 'string' }
          },
          required: ['rawText', 'mealType', 'brand', 'normalizedForm']
        }
      }
    },
    required: ['items']
  },
  strict: true
};

// Minimal prompt: the JSON schema already constrains the output shape,
// so the prompt only needs the field semantics and one example.
const SEGMENT_SYSTEM_PROMPT = `Split the food-log text into individual food items. Per item:
- rawText: original chunk incl. quantity/unit (e.g. "2 scrambled eggs")
- mealType: breakfast|lunch|dinner|snacks (default "snacks")
- brand: explicit brand name, else ""
- normalizedForm: base food name without quantity/unit, keep prep modifiers ("2 scrambled eggs" -> "scrambled eggs", "1 tbsp Heinz ketchup" -> "ketchup")
Attached condiments stay with their item ("toast with butter" = 1 item); distinct foods are separate items.
Two distinct whole foods joined by "and" are SEPARATE items ("chicken and rice" -> 2, "eggs and bacon" -> 2, "rice and beans" -> 2). Keep "and" together ONLY when the whole phrase names ONE product or a single flavor ("cookies and cream", "peaches and cream", "mac and cheese", "peanut butter and jelly" = 1 item).
Example: "2 eggs and wheat toast for breakfast" -> {"items":[{"rawText":"2 eggs","mealType":"breakfast","brand":"","normalizedForm":"eggs"},{"rawText":"wheat toast","mealType":"breakfast","brand":"","normalizedForm":"wheat toast"}]}`;

// Per-attempt timeout 6s, overall deadline 8s: a hung provider chain
// (previously up to 15s+) now degrades to the lenient heuristic split
// instead of stalling the request or returning a 500.
const LLM_ATTEMPT_TIMEOUT_MS = 6000;
const LLM_OVERALL_DEADLINE_MS = 8000;

/**
 * Run AI segmentation on a raw log line.
 *
 * Returns the segmented items on a SUCCESSFUL, complete parse; returns null
 * when the LLM errored, exceeded the deadline, or returned an empty/invalid
 * item list — callers fall back to forceSegmentText and must NOT cache the
 * degraded result.
 */
export async function segmentTextWithAi(text: string): Promise<SegmentedItem[] | null> {
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const llmResult = await Promise.race([
    callStructuredLlm({
      schema: NLP_SPLIT_SCHEMA,
      systemPrompt: SEGMENT_SYSTEM_PROMPT,
      userPrompt: `Unstructured text: "${text}"`,
      purpose: 'parse',
      timeout: LLM_ATTEMPT_TIMEOUT_MS,
      maxTokens: 600,
    }),
    new Promise<null>((resolve) => {
      deadlineTimer = setTimeout(() => resolve(null), LLM_OVERALL_DEADLINE_MS);
    }),
  ]);
  if (deadlineTimer) clearTimeout(deadlineTimer);

  if (!llmResult || llmResult.status === 'error') {
    console.warn(
      `[nlp-parse] LLM segmentation ${llmResult ? `failed: ${llmResult.error}` : `deadline exceeded (${LLM_OVERALL_DEADLINE_MS}ms)`} — caller falls back to lenient heuristic split`
    );
    return null;
  }

  const items = llmResult.content?.items;
  if (!isSegmentedItemArray(items)) {
    return null;
  }
  return items;
}
