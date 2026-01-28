/**
 * Ambiguous Serving Estimator
 * 
 * Estimates weight for ambiguous units (container, scoop, bowl, etc.)
 * that don't have standard weights.
 * 
 * Uses AI to estimate the typical weight based on product type and context.
 */

import {
    FATSECRET_CACHE_AI_ENABLED,
    FATSECRET_CACHE_AI_BACKFILL_CONFIDENCE_MIN,
} from '../fatsecret/config';
import { callStructuredLlm } from './structured-client';
import { getFdcServingWeight } from '../fdc/fdc-servings';
import { getDefaultCountServing } from '../servings/default-count-grams';

// Units that are inherently ambiguous and require AI estimation
export const AMBIGUOUS_UNITS = new Set([
    'container', 'containers',
    'scoop', 'scoops',
    'bowl', 'bowls',
    'handful', 'handfuls',
    'packet', 'packets',
    'package', 'packages',    // "1 package spinach"
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
    // Stock/bouillon cubes: API inconsistently uses dry vs prepared liquid weights
    'cube', 'cubes',
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

/**
 * Checks if a unit is ambiguous and requires AI estimation
 */
export function isAmbiguousUnit(unit: string): boolean {
    return AMBIGUOUS_UNITS.has(unit.toLowerCase().trim());
}

/**
 * Estimates the weight of an ambiguous unit using AI
 * Step 8 optimization: Try FDC servings and count defaults before LLM
 */
export async function estimateAmbiguousServing(
    request: AmbiguousServingRequest
): Promise<AmbiguousServingResult> {
    const { foodName, brandName, unit, foodType } = request;

    // Step 8: Try count defaults first (no API call)
    const sizeFromUnit = unit.toLowerCase() as 'small' | 'medium' | 'large' | undefined;
    const isSize = ['small', 'medium', 'large'].includes(sizeFromUnit || '');
    const countDefault = getDefaultCountServing(
        foodName,
        unit,
        isSize ? sizeFromUnit : undefined
    );

    if (countDefault) {
        return {
            status: 'success',
            estimatedGrams: countDefault.grams,
            confidence: countDefault.confidence,
            reasoning: `Default from ${countDefault.source} data`,
        };
    }

    // Step 8: Try FDC serving lookup (uses cache)
    try {
        const fdcResult = await getFdcServingWeight(
            foodName,
            unit,
            isSize ? sizeFromUnit : undefined
        );

        if (fdcResult) {
            return {
                status: 'success',
                estimatedGrams: fdcResult.grams,
                confidence: 0.9, // High confidence for USDA data
                reasoning: `From USDA FDC: ${fdcResult.label}`,
            };
        }
    } catch (err) {
        // FDC lookup failed, continue to LLM
    }

    // Fall back to LLM if no defaults available
    if (!FATSECRET_CACHE_AI_ENABLED) {
        return { status: 'error', error: 'AI backfill disabled' };
    }

    if (!process.env.OPENAI_API_KEY && !process.env.OPENROUTER_API_KEY) {
        return { status: 'error', error: 'No API keys configured' };
    }

    const prompt = buildPrompt(request);

    try {
        const result = await callStructuredLlm({
            schema: RESPONSE_SCHEMA,
            systemPrompt: SYSTEM_PROMPT,
            userPrompt: prompt,
            purpose: 'ambiguous',
        });

        if (result.status === 'error') {
            return { status: 'error', error: result.error ?? 'unknown error' };
        }

        const parsed = result.content as Record<string, unknown>;

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

        // Sanity check: Validate against category-specific limits
        const sanitized = applySanityCheck(foodName, unit, estimatedGrams, request);
        if (sanitized.needsReEstimate) {
            // Re-estimate with OpenRouter if local estimate is out of bounds
            try {
                const reResult = await callStructuredLlm({
                    schema: RESPONSE_SCHEMA,
                    systemPrompt: SYSTEM_PROMPT + `\n\nWARNING: Previous estimate of ${estimatedGrams}g was rejected. ${sanitized.reason}. Please provide a more accurate estimate.`,
                    userPrompt: prompt,
                    purpose: 'ambiguous',
                    forceProvider: 'openrouter',
                });

                if (reResult.status === 'success' && reResult.content) {
                    const reParsed = reResult.content as Record<string, unknown>;
                    const reGrams = typeof reParsed.estimatedGrams === 'number' ? reParsed.estimatedGrams : NaN;
                    if (!Number.isNaN(reGrams) && reGrams > 0) {
                        const reCheck = applySanityCheck(foodName, unit, reGrams, request);
                        if (!reCheck.needsReEstimate) {
                            return {
                                status: 'success',
                                estimatedGrams: reGrams,
                                confidence: (reParsed.confidence as number) ?? 0.7,
                                reasoning: `Re-estimated with cloud API: ${reParsed.reasoning}`,
                            };
                        }
                    }
                }
            } catch (err) {
                // Fall through to use clamped value
            }

            // If re-estimate still fails, use clamped value
            if (sanitized.clampedGrams !== estimatedGrams) {
                return {
                    status: 'success',
                    estimatedGrams: sanitized.clampedGrams,
                    confidence: confidence * 0.7, // Reduce confidence for clamped values
                    reasoning: `${reasoning} [Clamped: ${sanitized.reason}]`,
                };
            }
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

// ============================================================
// Sanity Check for Category-Specific Limits
// ============================================================

interface SanityCheckResult {
    needsReEstimate: boolean;
    clampedGrams: number;
    reason?: string;
}

const CATEGORY_LIMITS: Record<string, { minG: number; maxG: number; keywords: string[] }> = {
    'protein_powder': { minG: 20, maxG: 50, keywords: ['protein powder', 'whey', 'casein', 'protein isolate'] },
    'scallion': { minG: 5, maxG: 25, keywords: ['scallion', 'green onion', 'spring onion'] },
    'herbs': { minG: 1, maxG: 20, keywords: ['basil', 'cilantro', 'parsley', 'mint', 'dill', 'oregano', 'thyme'] },
    'spices': { minG: 0.5, maxG: 10, keywords: ['pepper', 'cinnamon', 'cumin', 'paprika', 'turmeric'] },
};

function applySanityCheck(
    foodName: string,
    unit: string,
    estimatedGrams: number,
    _request: AmbiguousServingRequest
): SanityCheckResult {
    const nameLower = foodName.toLowerCase();

    for (const [category, limits] of Object.entries(CATEGORY_LIMITS)) {
        const matches = limits.keywords.some(kw => nameLower.includes(kw));
        if (matches) {
            if (estimatedGrams < limits.minG) {
                return {
                    needsReEstimate: true,
                    clampedGrams: limits.minG,
                    reason: `${category}: ${estimatedGrams}g below minimum ${limits.minG}g`,
                };
            }
            if (estimatedGrams > limits.maxG) {
                return {
                    needsReEstimate: true,
                    clampedGrams: limits.maxG,
                    reason: `${category}: ${estimatedGrams}g exceeds maximum ${limits.maxG}g per serving`,
                };
            }
        }
    }

    return { needsReEstimate: false, clampedGrams: estimatedGrams };
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

// ============================================================
// Batched Produce Size Estimation (single AI call for all 3 sizes)
// ============================================================

export interface ProduceSizeEstimates {
    small: number;
    medium: number;
    large: number;
    confidence: number;
    reasoning?: string;
}

export interface BatchedProduceSizeResult {
    status: 'success' | 'error';
    estimates?: ProduceSizeEstimates;
    error?: string;
}

const PRODUCE_SIZE_RESPONSE_SCHEMA = {
    name: 'produce_size_estimates',
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            small: { type: 'number', description: 'Weight in grams for a small item' },
            medium: { type: 'number', description: 'Weight in grams for a medium item' },
            large: { type: 'number', description: 'Weight in grams for a large item' },
            confidence: { type: 'number', description: 'Confidence score 0-1' },
            reasoning: { type: 'string', description: 'Brief explanation of estimates' },
            error: { type: ['string', 'null'] },
        },
        required: ['small', 'medium', 'large', 'confidence', 'reasoning', 'error'],
    },
    strict: true,
};

const PRODUCE_SIZE_SYSTEM_PROMPT = [
    'You are a nutrition assistant that estimates weights for whole produce items.',
    'Given a produce item (fruit or vegetable), estimate typical weights in grams for SMALL, MEDIUM, and LARGE sizes.',
    'Use USDA/FDA standard sizing guidelines when available.',
    'Return all three estimates with a confidence score (0-1) and brief reasoning.',
].join(' ');

/**
 * Estimates small/medium/large weights for a produce item in a SINGLE AI call.
 * Step 8 optimization: Try FDC servings and count defaults before LLM.
 * Use this instead of 3 separate calls to estimateAmbiguousServing().
 */
export async function estimateProduceSizes(
    foodName: string,
    brandName?: string | null
): Promise<BatchedProduceSizeResult> {
    // Step 8: Try FDC first for all three sizes
    try {
        const [fdcSmall, fdcMedium, fdcLarge] = await Promise.all([
            getFdcServingWeight(foodName, 'small', 'small'),
            getFdcServingWeight(foodName, 'medium', 'medium'),
            getFdcServingWeight(foodName, 'large', 'large'),
        ]);

        if (fdcSmall && fdcMedium && fdcLarge) {
            return {
                status: 'success',
                estimates: {
                    small: fdcSmall.grams,
                    medium: fdcMedium.grams,
                    large: fdcLarge.grams,
                    confidence: 0.9,
                    reasoning: 'From USDA FDC household measures',
                },
            };
        }
    } catch (err) {
        // FDC lookup failed, try count defaults
    }

    // Step 8: Try count defaults
    const defaultSmall = getDefaultCountServing(foodName, 'small', 'small');
    const defaultMedium = getDefaultCountServing(foodName, 'medium', 'medium');
    const defaultLarge = getDefaultCountServing(foodName, 'large', 'large');

    if (defaultSmall && defaultMedium && defaultLarge) {
        return {
            status: 'success',
            estimates: {
                small: defaultSmall.grams,
                medium: defaultMedium.grams,
                large: defaultLarge.grams,
                confidence: Math.min(defaultSmall.confidence, defaultMedium.confidence, defaultLarge.confidence),
                reasoning: `Default from ${defaultMedium.source} data`,
            },
        };
    }

    // Fall back to LLM
    if (!FATSECRET_CACHE_AI_ENABLED) {
        return { status: 'error', error: 'AI backfill disabled' };
    }

    if (!process.env.OPENAI_API_KEY && !process.env.OPENROUTER_API_KEY) {
        return { status: 'error', error: 'No API keys configured' };
    }

    const prompt = buildProduceSizePrompt(foodName, brandName);

    try {
        const result = await callStructuredLlm({
            schema: PRODUCE_SIZE_RESPONSE_SCHEMA,
            systemPrompt: PRODUCE_SIZE_SYSTEM_PROMPT,
            userPrompt: prompt,
            purpose: 'produce',
        });

        if (result.status === 'error') {
            return { status: 'error', error: result.error ?? 'unknown error' };
        }

        const parsed = result.content as Record<string, unknown>;

        if (typeof parsed.error === 'string' && parsed.error.length > 0) {
            return { status: 'error', error: parsed.error };
        }

        const small = typeof parsed.small === 'number' ? parsed.small : NaN;
        const medium = typeof parsed.medium === 'number' ? parsed.medium : NaN;
        const large = typeof parsed.large === 'number' ? parsed.large : NaN;
        const confidence = typeof parsed.confidence === 'number' ? parsed.confidence : NaN;
        const reasoning = typeof parsed.reasoning === 'string' ? parsed.reasoning : undefined;

        if (Number.isNaN(small) || small <= 0 ||
            Number.isNaN(medium) || medium <= 0 ||
            Number.isNaN(large) || large <= 0) {
            return { status: 'error', error: 'Invalid gram estimates from AI' };
        }

        if (confidence < FATSECRET_CACHE_AI_BACKFILL_CONFIDENCE_MIN) {
            return {
                status: 'error',
                error: `Low confidence (${confidence.toFixed(2)} < ${FATSECRET_CACHE_AI_BACKFILL_CONFIDENCE_MIN})`,
            };
        }

        return {
            status: 'success',
            estimates: { small, medium, large, confidence, reasoning },
        };
    } catch (error) {
        return { status: 'error', error: (error as Error).message };
    }
}

function buildProduceSizePrompt(foodName: string, brandName?: string | null): string {
    const lines = [
        `Produce: ${foodName}`,
        brandName ? `Variety/Brand: ${brandName}` : '',
        ``,
        `Question: What are the typical weights in grams for SMALL, MEDIUM, and LARGE sizes of "${foodName}"?`,
        ``,
        `Guidelines (use USDA standards when available):`,
        `- Small: bottom 10-20% of typical size range`,
        `- Medium: average/typical size`,
        `- Large: top 10-20% of typical size range`,
        ``,
        `IMPORTANT: Pay attention to the type of produce!`,
        `- HEAVY produce (potatoes, apples): 100-300g each`,
        `- MEDIUM produce (tomatoes, peppers): 80-180g each`,
        `- THIN/LIGHT produce (scallions, herbs, green onions): 5-25g each`,
        `- TINY items (garlic cloves, berries): 1-5g each`,
        ``,
        `Examples by category:`,
        ``,
        `HEAVY produce:`,
        `- Apple: small=150g, medium=182g, large=220g`,
        `- Potato: small=150g, medium=213g, large=300g`,
        `- Avocado: small=115g, medium=150g, large=200g`,
        ``,
        `MEDIUM produce:`,
        `- Tomato: small=91g, medium=123g, large=182g`,
        `- Banana: small=101g, medium=118g, large=136g`,
        `- Bell pepper: small=120g, medium=164g, large=186g`,
        ``,
        `THIN/LIGHT produce:`,
        `- Scallion/Green onion: small=10g, medium=15g, large=25g`,
        `- Celery stalk: small=30g, medium=40g, large=50g`,
        `- Asparagus spear: small=12g, medium=16g, large=20g`,
        `- Carrot: small=50g, medium=72g, large=85g`,
        ``,
        `TINY items:`,
        `- Garlic clove: small=2g, medium=3g, large=5g`,
        `- Strawberry: small=7g, medium=12g, large=18g`,
        ``,
        `Provide estimates for all three sizes. Do NOT confuse thin produce with heavy produce!`,
    ].filter(Boolean);

    return lines.join('\n');
}

