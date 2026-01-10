/**
 * Simple AI Serving Estimation
 * 
 * A lightweight AI function that estimates grams for a given food + unit
 * without requiring the food to be in any cache. Used for:
 * - FDC foods with inline nutrition
 * - Count units detected from ingredient names (e.g., "ice cubes")
 * - Any case where we just need "how much does 1 X of Y weigh?"
 */

import {
    FATSECRET_CACHE_AI_MODEL,
    FATSECRET_CACHE_AI_ENABLED,
    FATSECRET_CACHE_AI_BACKFILL_CONFIDENCE_MIN,
    OPENAI_API_BASE_URL,
} from '../fatsecret/config';
import { logger } from '../logger';

export interface SimpleServingEstimate {
    unit: string;
    gramsPerUnit: number;
    confidence: number;
    rationale?: string;
}

export interface SimpleServingEstimateResult {
    status: 'success' | 'error';
    estimate?: SimpleServingEstimate;
    reason?: string;
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';

const RESPONSE_SCHEMA = {
    name: 'simple_serving_estimate',
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            gramsPerUnit: { type: 'number' },
            confidence: { type: 'number' },
            rationale: { type: ['string', 'null'] },
            error: { type: ['string', 'null'] },
        },
        required: ['gramsPerUnit', 'confidence', 'rationale', 'error'],
    },
    strict: true,
};

const SYSTEM_PROMPT = `You are a nutrition assistant that estimates serving weights.
Your job is to answer: "How many grams does 1 [unit] of [food] typically weigh?"

Guidelines:
- Use typical, average measurements
- For ice cubes: a standard ice cube tray produces cubes of ~25-30g each
- For sugar cubes: a standard sugar cube is ~4g
- For butter cubes (pats): typically ~5g each
- For cheese cubes: depends on context, usually ~15-20g for snack-sized
- For meat cubes (for stew/kabob): typically ~20-30g each
- Be confident in your estimates for common items
- Return error only if the combination makes no sense (e.g., "1 cube of water")

Always return valid JSON matching the schema.`;

/**
 * Estimate grams per unit for a food+unit combination using AI.
 * This is a simple, standalone function that doesn't require cached food data.
 */
export async function estimateServingWeight(
    foodName: string,
    unit: string,
    options?: {
        brandName?: string;
        context?: string;  // Additional context like "from ingredient: 6 ice cubes"
    }
): Promise<SimpleServingEstimateResult> {
    if (!FATSECRET_CACHE_AI_ENABLED) {
        return { status: 'error', reason: 'AI disabled' };
    }
    if (!OPENAI_API_KEY) {
        return { status: 'error', reason: 'OPENAI_API_KEY missing' };
    }

    const prompt = [
        `Food: ${foodName}${options?.brandName ? ` (${options.brandName})` : ''}`,
        `Unit: ${unit}`,
        `Question: How many grams does 1 ${unit} of ${foodName} typically weigh?`,
        options?.context ? `Context: ${options.context}` : '',
        '',
        'Provide your best estimate with confidence 0-1.',
    ].filter(Boolean).join('\n');

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
            const errorText = await response.text();
            logger.error('ai.simple_estimate.request_failed', {
                status: response.status,
                error: errorText
            });
            return { status: 'error', reason: `API error: ${response.status}` };
        }

        const payload = (await response.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
        };
        const content = payload.choices?.[0]?.message?.content;
        if (!content) {
            return { status: 'error', reason: 'Empty AI response' };
        }

        const parsed = JSON.parse(content) as Record<string, unknown>;

        if (typeof parsed.error === 'string' && parsed.error.length > 0) {
            return { status: 'error', reason: parsed.error };
        }

        const gramsPerUnit = typeof parsed.gramsPerUnit === 'number' ? parsed.gramsPerUnit : NaN;
        const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : NaN;

        if (Number.isNaN(gramsPerUnit) || gramsPerUnit <= 0) {
            return { status: 'error', reason: 'Invalid grams estimate' };
        }

        if (confidence < FATSECRET_CACHE_AI_BACKFILL_CONFIDENCE_MIN) {
            return {
                status: 'error',
                reason: `Low confidence: ${confidence.toFixed(2)}`
            };
        }

        logger.info('ai.simple_estimate.success', {
            foodName,
            unit,
            gramsPerUnit,
            confidence,
        });

        return {
            status: 'success',
            estimate: {
                unit,
                gramsPerUnit,
                confidence,
                rationale: typeof parsed.rationale === 'string' ? parsed.rationale : undefined,
            },
        };
    } catch (error) {
        logger.error('ai.simple_estimate.error', {
            foodName,
            unit,
            error: (error as Error).message
        });
        return { status: 'error', reason: (error as Error).message };
    }
}
