/**
 * Ambiguous Serving Estimator
 * 
 * Estimates weight for ambiguous units (container, scoop, bowl, etc.)
 * that don't have standard weights.
 * 
 * Uses AI to estimate the typical weight based on product type and context.
 */

import {
    FATSECRET_CACHE_AI_MODEL,
    FATSECRET_CACHE_AI_ENABLED,
    FATSECRET_CACHE_AI_BACKFILL_CONFIDENCE_MIN,
    OPENAI_API_BASE_URL,
} from '../fatsecret/config';

// Units that are inherently ambiguous and require AI estimation
export const AMBIGUOUS_UNITS = new Set([
    'container', 'containers',
    'scoop', 'scoops',
    'bowl', 'bowls',
    'handful', 'handfuls',
    'packet', 'packets',
    'package', 'packages',    // NEW: "1 package spinach"
    'envelope', 'envelopes',
    'can', 'cans',
    'jar', 'jars',
    'bottle', 'bottles',
    'carton', 'cartons',
    'tub', 'tubs',
    'box', 'boxes',
    'bag', 'bags',
    'pouch', 'pouches',
    // Eggs: API often returns 100g/egg instead of actual ~50g
    'egg', 'eggs',
    // Size descriptors for whole produce (when no serving data exists)
    'medium', 'large', 'small', 'whole',
]);

export interface AmbiguousServingRequest {
    foodName: string;
    brandName?: string | null;
    unit: string;
    foodType?: string | null;
}

export interface AmbiguousServingResult {
    status: 'success' | 'error';
    estimatedGrams?: number;
    confidence?: number;
    reasoning?: string;
    error?: string;
}

const RESPONSE_SCHEMA = {
    name: 'ambiguous_serving_estimate',
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            estimatedGrams: { type: 'number' },
            confidence: { type: 'number' },
            reasoning: { type: 'string' },
            error: { type: ['string', 'null'] },
        },
        required: ['estimatedGrams', 'confidence', 'reasoning', 'error'],
    },
    strict: true,
};

const SYSTEM_PROMPT = [
    'You are a nutrition assistant that estimates serving sizes for ambiguous units.',
    'Given a food item and an ambiguous unit (like "container" or "scoop"), estimate the typical weight in grams.',
    'Consider common retail packaging sizes and typical serving patterns.',
    'Return your estimate with a confidence score (0-1) and brief reasoning.',
    'If you cannot make a reasonable estimate, return an error message.',
].join(' ');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';

/**
 * Checks if a unit is ambiguous and requires AI estimation
 */
export function isAmbiguousUnit(unit: string): boolean {
    return AMBIGUOUS_UNITS.has(unit.toLowerCase().trim());
}

/**
 * Estimates the weight of an ambiguous unit using AI
 */
export async function estimateAmbiguousServing(
    request: AmbiguousServingRequest
): Promise<AmbiguousServingResult> {
    const { foodName, brandName, unit, foodType } = request;

    if (!FATSECRET_CACHE_AI_ENABLED) {
        return { status: 'error', error: 'AI backfill disabled' };
    }

    if (!OPENAI_API_KEY) {
        return { status: 'error', error: 'OPENAI_API_KEY missing' };
    }

    const prompt = buildPrompt(request);

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
                error: `OpenAI request failed (${response.status}): ${errorPayload}`,
            };
        }

        const payload = (await response.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
        };
        const content = payload.choices?.[0]?.message?.content;
        if (!content) {
            return { status: 'error', error: 'Empty AI response' };
        }

        const parsed = JSON.parse(content) as Record<string, unknown>;

        if (typeof parsed.error === 'string' && parsed.error.length > 0) {
            return { status: 'error', error: parsed.error };
        }

        const estimatedGrams = typeof parsed.estimatedGrams === 'number' ? parsed.estimatedGrams : NaN;
        const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : NaN;
        const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : undefined;

        if (Number.isNaN(estimatedGrams) || estimatedGrams <= 0) {
            return { status: 'error', error: 'Invalid gram estimate from AI' };
        }

        if (confidence < FATSECRET_CACHE_AI_BACKFILL_CONFIDENCE_MIN) {
            return {
                status: 'error',
                error: `Low confidence (${confidence.toFixed(2)} < ${FATSECRET_CACHE_AI_BACKFILL_CONFIDENCE_MIN})`,
            };
        }

        return {
            status: 'success',
            estimatedGrams,
            confidence,
            reasoning,
        };
    } catch (error) {
        return { status: 'error', error: (error as Error).message };
    }
}

function buildPrompt(request: AmbiguousServingRequest): string {
    const { foodName, brandName, unit, foodType } = request;

    const lines = [
        `Food: ${foodName}`,
        brandName ? `Brand: ${brandName}` : 'Brand: Generic',
        foodType ? `Type: ${foodType}` : '',
        ``,
        `Question: What is the typical weight in grams for 1 ${unit} of "${foodName}"?`,
        ``,
        `Consider:`,
        `- Common retail packaging sizes for this type of product`,
        `- Single-serve vs family-size packaging`,
        `- If the brand is specified, consider brand-specific sizing`,
        ``,
        `Example reasoning for different units:`,
        `- "container" of yogurt: Usually 5.3oz (150g) for single-serve, 16oz (453g) for larger`,
        `- "scoop" of protein powder: Typically 30-35g`,
        `- "bowl" of cereal: About 200-300g including milk, 30-60g dry`,
        `- "can" of soda: Usually 355ml`,
        `- "packet" of sweetener: About 1g`,
        ``,
        `Provide your best estimate with confidence level and reasoning.`,
    ].filter(Boolean);

    return lines.join('\n');
}
