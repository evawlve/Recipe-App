/**
 * Batch AI Normalize
 * 
 * Processes multiple ingredients in a single AI API call for efficiency.
 * ~6x faster than individual calls for batch operations.
 */

import 'dotenv/config';
import {
    FATSECRET_CACHE_AI_MODEL,
    OPENAI_API_BASE_URL,
} from './config';
import { getAiNormalizeCache, saveAiNormalizeCache } from './validated-mapping-helpers';
import { logger } from '../logger';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';

// ============================================================
// Types
// ============================================================

export interface BatchNormalizeInput {
    rawLine: string;
    hint?: string;
}

export interface BatchNormalizeResult {
    rawLine: string;
    status: 'success' | 'error';
    normalizedName?: string;
    synonyms?: string[];
    prepPhrases?: string[];
    sizePhrases?: string[];
    error?: string;
}

// ============================================================
// Response Schema
// ============================================================

const BATCH_RESPONSE_SCHEMA = {
    name: 'batch_fatsecret_normalize',
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            results: {
                type: 'array',
                items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                        index: { type: 'integer' },
                        normalized_name: { type: 'string' },
                        prep_phrases: { type: 'array', items: { type: 'string' } },
                        size_phrases: { type: 'array', items: { type: 'string' } },
                        synonyms: { type: 'array', items: { type: 'string' } },
                        error: { type: ['string', 'null'] },
                    },
                    required: ['index', 'normalized_name', 'prep_phrases', 'size_phrases', 'synonyms', 'error'],
                },
            },
        },
        required: ['results'],
    },
    strict: true,
};

const SYSTEM_PROMPT = [
    'You normalize ingredient strings for recipe mapping.',
    'Process each ingredient and return JSON with:',
    '- normalized_name: canonical food name (no qty/unit)',
    '- prep_phrases: phrases to strip (e.g., "finely chopped")',
    '- size_phrases: size descriptors (e.g., "large", "medium")',
    '- synonyms: alternative search terms (US equivalents for UK terms, etc.)',
    'Do not invent foods; stay close to the ingredient meaning.',
    'If unclear, provide your best guess rather than error.',
].join(' ');

// ============================================================
// Main Batch Function
// ============================================================

/**
 * Normalize multiple ingredients in a single API call
 * Much faster than calling aiNormalizeIngredient individually
 */
export async function batchNormalizeIngredients(
    inputs: BatchNormalizeInput[]
): Promise<BatchNormalizeResult[]> {
    if (inputs.length === 0) return [];

    // Check cache first for each input
    const results: BatchNormalizeResult[] = new Array(inputs.length);
    const uncachedInputs: Array<{ index: number; input: BatchNormalizeInput }> = [];

    for (let i = 0; i < inputs.length; i++) {
        const cached = await getAiNormalizeCache(inputs[i].rawLine);
        if (cached) {
            results[i] = {
                rawLine: inputs[i].rawLine,
                status: 'success',
                normalizedName: cached.normalizedName,
                synonyms: cached.synonyms,
                prepPhrases: cached.prepPhrases,
                sizePhrases: cached.sizePhrases,
            };
        } else {
            uncachedInputs.push({ index: i, input: inputs[i] });
        }
    }

    // If all cached, return early
    if (uncachedInputs.length === 0) {
        logger.info('batch_normalize.all_cached', { count: inputs.length });
        return results;
    }

    // If no API key, return errors for uncached
    if (!OPENAI_API_KEY) {
        for (const { index, input } of uncachedInputs) {
            results[index] = {
                rawLine: input.rawLine,
                status: 'error',
                error: 'OPENAI_API_KEY missing',
            };
        }
        return results;
    }

    // Build batch prompt
    const ingredientList = uncachedInputs.map(({ index, input }, i) =>
        `${i + 1}. Raw: "${input.rawLine}"${input.hint ? ` (hint: ${input.hint})` : ''}`
    ).join('\n');

    const userPrompt = [
        `Normalize these ${uncachedInputs.length} ingredients:`,
        ingredientList,
        '',
        'Return results array with index matching input order (0-based).',
    ].join('\n');

    try {
        const startTime = Date.now();

        const response = await fetch(`${OPENAI_API_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: FATSECRET_CACHE_AI_MODEL,
                response_format: { type: 'json_schema', json_schema: BATCH_RESPONSE_SCHEMA },
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: userPrompt },
                ],
            }),
        });

        const json = await response.json();
        const content = json?.choices?.[0]?.message?.content;

        if (!content) {
            // Return errors for all uncached
            for (const { index, input } of uncachedInputs) {
                results[index] = {
                    rawLine: input.rawLine,
                    status: 'error',
                    error: 'empty AI response',
                };
            }
            return results;
        }

        const parsed = JSON.parse(content);
        const elapsed = Date.now() - startTime;

        logger.info('batch_normalize.completed', {
            requested: uncachedInputs.length,
            received: parsed.results?.length ?? 0,
            elapsedMs: elapsed,
        });

        // Process results
        if (Array.isArray(parsed.results)) {
            for (const result of parsed.results) {
                const uncachedItem = uncachedInputs[result.index];
                if (!uncachedItem) continue;

                const { index, input } = uncachedItem;

                if (result.error) {
                    results[index] = {
                        rawLine: input.rawLine,
                        status: 'error',
                        error: result.error,
                    };
                } else {
                    results[index] = {
                        rawLine: input.rawLine,
                        status: 'success',
                        normalizedName: result.normalized_name,
                        synonyms: result.synonyms || [],
                        prepPhrases: result.prep_phrases || [],
                        sizePhrases: result.size_phrases || [],
                    };

                    // Save to cache
                    await saveAiNormalizeCache(input.rawLine, {
                        normalizedName: result.normalized_name,
                        synonyms: result.synonyms || [],
                        prepPhrases: result.prep_phrases || [],
                        sizePhrases: result.size_phrases || [],
                    });
                }
            }
        }

        // Fill in any missing results with errors
        for (const { index, input } of uncachedInputs) {
            if (!results[index]) {
                results[index] = {
                    rawLine: input.rawLine,
                    status: 'error',
                    error: 'missing from AI response',
                };
            }
        }

        return results;
    } catch (error) {
        logger.error('batch_normalize.error', { error });

        // Return errors for all uncached
        for (const { index, input } of uncachedInputs) {
            results[index] = {
                rawLine: input.rawLine,
                status: 'error',
                error: (error as Error).message,
            };
        }
        return results;
    }
}
