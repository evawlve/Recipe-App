/**
 * AI Parse Recovery Module
 * 
 * Provides intelligent fallback for failed or low-confidence ingredient mappings.
 * When the normal pipeline fails to find a good match, this module can:
 * 
 * 1. Simplify queries by removing noise words (e.g., "burger relish" → "relish")
 * 2. Identify problematic tokens that pollute search results
 * 3. Suggest better search terms based on the ingredient context
 * 
 * This is designed to catch cases where:
 * - API doesn't have the exact product (e.g., "burger relish" not in database)
 * - Dietary constraints filter out all candidates (e.g., "vegetarian mince" with no plant-based options)
 * - Query has noise words that confuse the search (e.g., "long" in "long sweet potato")
 */

import { callStructuredLlm } from '../ai/structured-client';
import { logger } from '../logger';

// ============================================================
// Types
// ============================================================

export interface ParseRecoveryInput {
    rawLine: string;
    normalizedName: string;
    failureReason: 'no_candidates' | 'all_filtered' | 'low_confidence' | 'dietary_constraint';
    topCandidateNames?: string[];  // Names of top candidates before filtering (for context)
}

export interface ParseRecoveryResult {
    success: boolean;
    simplifiedQuery?: string;       // Simplified search query (e.g., "relish" from "burger relish")
    badTokens?: string[];           // Tokens that were polluting the search
    suggestedSynonyms?: string[];   // Alternative search terms to try
    confidence: number;
}

// ============================================================
// Query Simplification Rules (Deterministic, no LLM needed)
// ============================================================

/**
 * Words that can be dropped from a query to find the core ingredient.
 * These are typically descriptors, brands, or context words.
 */
const DROPPABLE_PREFIX_WORDS = new Set([
    // Shape/size descriptors
    'long', 'short', 'tall', 'baby', 'mini', 'giant', 'jumbo', 'small', 'medium', 'large',
    // Preparation context (not the food itself)
    'burger', 'sandwich', 'taco', 'pizza', 'salad', 'wrap', 'breakfast', 'dinner', 'lunch',
    // Quality/state descriptors
    'fresh', 'frozen', 'hot', 'cold', 'warm', 'room', 'temperature',
    // Origin/style descriptors
    'homemade', 'storebought', 'store-bought', 'restaurant', 'style',
]);

/**
 * Common compound ingredient patterns where the first word is context.
 * Format: { pattern: words_to_drop, keep: core_ingredient }
 */
const COMPOUND_SIMPLIFICATIONS: Array<{ pattern: RegExp; simplify: string }> = [
    // "burger relish" → "relish"
    { pattern: /^burger\s+relish$/i, simplify: 'pickle relish' },
    { pattern: /^hot\s*dog\s+relish$/i, simplify: 'pickle relish' },
    // "pizza sauce" → "tomato sauce" (if pizza sauce not found)
    { pattern: /^pizza\s+sauce$/i, simplify: 'tomato sauce' },
    // "taco seasoning" → "seasoning mix"
    { pattern: /^taco\s+seasoning$/i, simplify: 'seasoning mix' },
    // "vegetarian mince" → "meatless crumbles" or "textured vegetable protein"
    { pattern: /^vegetarian\s+mince$/i, simplify: 'meatless crumbles' },
    { pattern: /^vegan\s+mince$/i, simplify: 'meatless crumbles' },
    { pattern: /^plant[- ]based\s+mince$/i, simplify: 'textured vegetable protein' },
    // "vegetarian ground" → "meatless ground"
    { pattern: /^vegetarian\s+ground$/i, simplify: 'meatless ground beef' },
    { pattern: /^vegan\s+ground$/i, simplify: 'meatless ground beef' },
];

// ============================================================
// Deterministic Query Simplification (Fast, no LLM)
// ============================================================

/**
 * Try to simplify a query by removing noise words or applying known patterns.
 * This is fast (no LLM call) and should be tried first.
 * 
 * @returns Simplified query if applicable, or null if no simplification found
 */
export function simplifyQueryDeterministic(normalizedName: string): string | null {
    const lower = normalizedName.toLowerCase().trim();

    // Check compound simplifications first
    for (const { pattern, simplify } of COMPOUND_SIMPLIFICATIONS) {
        if (pattern.test(lower)) {
            logger.info('parse_recovery.compound_simplification', {
                original: normalizedName,
                simplified: simplify,
            });
            return simplify;
        }
    }

    // Try dropping prefix words
    const words = lower.split(/\s+/);
    if (words.length >= 2) {
        const droppablePrefix = words.findIndex(w => !DROPPABLE_PREFIX_WORDS.has(w));
        if (droppablePrefix > 0) {
            // Found droppable prefix words
            const simplified = words.slice(droppablePrefix).join(' ');
            if (simplified.length >= 3) {  // Ensure we have something meaningful left
                logger.info('parse_recovery.prefix_dropped', {
                    original: normalizedName,
                    dropped: words.slice(0, droppablePrefix),
                    simplified,
                });
                return simplified;
            }
        }
    }

    return null;
}

// ============================================================
// LLM-Assisted Query Recovery (Fallback for complex cases)
// ============================================================

const PARSE_RECOVERY_SCHEMA = {
    type: 'object',
    properties: {
        simplifiedQuery: {
            type: 'string',
            description: 'A simpler search query that focuses on the core ingredient'
        },
        badTokens: {
            type: 'array',
            items: { type: 'string' },
            description: 'Words in the original query that were causing search problems'
        },
        suggestedSynonyms: {
            type: 'array',
            items: { type: 'string' },
            description: 'Alternative search terms that might find the ingredient'
        },
        confidence: {
            type: 'number',
            description: 'Confidence in the suggestion (0-1)'
        }
    },
    required: ['simplifiedQuery', 'confidence']
};

/**
 * Use LLM to analyze a failed mapping and suggest better search terms.
 * This is slower and should only be used when deterministic simplification fails.
 */
export async function simplifyQueryWithLlm(input: ParseRecoveryInput): Promise<ParseRecoveryResult> {
    const prompt = `You are analyzing a failed ingredient mapping. The search query didn't find good matches.

**Original Input:** "${input.rawLine}"
**Search Query Used:** "${input.normalizedName}"
**Failure Reason:** ${input.failureReason}
${input.topCandidateNames?.length ? `**Top Candidates Found (but rejected):** ${input.topCandidateNames.slice(0, 5).join(', ')}` : ''}

Analyze why the search failed and provide:
1. **simplifiedQuery**: A simpler search term focusing on the core ingredient
   - For "burger relish" → "pickle relish" or "relish"
   - For "vegetarian mince" → "meatless crumbles" or "textured vegetable protein"
   - For "long sweet potato" → "sweet potato"
   
2. **badTokens**: Words that were likely confusing the search
   - "burger" in "burger relish" (context, not ingredient)
   - "long" in "long sweet potato" (size descriptor)
   
3. **suggestedSynonyms**: Other terms to search for
   - "pickle relish", "dill relish", "sweet relish" for relish products
   - "tvp", "meatless crumbles", "beyond meat" for vegetarian mince

Return JSON matching the schema.`;

    try {
        const result = await callStructuredLlm({
            schema: PARSE_RECOVERY_SCHEMA,
            systemPrompt: 'You are analyzing a failed ingredient mapping. Return simplified search suggestions.',
            userPrompt: prompt,
            purpose: 'simplify',
            timeout: 5000,
        });

        if (result.status === 'success' && result.content) {
            const data = result.content as Record<string, unknown>;
            logger.info('parse_recovery.llm_success', {
                original: input.normalizedName,
                simplified: data.simplifiedQuery,
                badTokens: data.badTokens,
            });

            return {
                success: true,
                simplifiedQuery: data.simplifiedQuery as string,
                badTokens: data.badTokens as string[] | undefined,
                suggestedSynonyms: data.suggestedSynonyms as string[] | undefined,
                confidence: (data.confidence as number) || 0.7,
            };
        }

        return { success: false, confidence: 0 };
    } catch (error) {
        logger.warn('parse_recovery.llm_failed', {
            error: (error as Error).message,
            input: input.normalizedName
        });
        return { success: false, confidence: 0 };
    }
}

// ============================================================
// Main Recovery Function
// ============================================================

/**
 * Attempt to recover from a failed ingredient mapping.
 * 
 * Strategy:
 * 1. Try deterministic simplification first (fast, no LLM)
 * 2. If that fails, try LLM-assisted recovery (slower, smarter)
 * 
 * @returns Recovery result with simplified query if successful
 */
export async function attemptParseRecovery(input: ParseRecoveryInput): Promise<ParseRecoveryResult> {
    logger.info('parse_recovery.attempting', {
        rawLine: input.rawLine,
        normalizedName: input.normalizedName,
        reason: input.failureReason,
    });

    // Step 1: Try deterministic simplification
    const deterministicResult = simplifyQueryDeterministic(input.normalizedName);
    if (deterministicResult) {
        return {
            success: true,
            simplifiedQuery: deterministicResult,
            badTokens: undefined,  // Deterministic doesn't track this
            confidence: 0.8,
        };
    }

    // Step 2: Try LLM-assisted recovery
    const llmResult = await simplifyQueryWithLlm(input);
    return llmResult;
}
