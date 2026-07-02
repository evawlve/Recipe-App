/**
 * AI Parse Fallback
 * 
 * Dedicated function for parsing difficult ingredient lines when the regex parser fails.
 * Uses AI to extract quantity, unit, and ingredient name from ambiguous inputs.
 * 
 * Examples:
 * - "1 5 floz serving red wine" → {qty: 5, unit: "floz", name: "red wine"}
 * - "buttery cinnamon powder" → {qty: null, unit: null, name: "cinnamon powder"}
 * 
 * @module ai-parse
 * @since Jan 2026
 */

import 'dotenv/config';
import { callStructuredLlm } from '../ai/structured-client';
import { logger } from '../logger';

// ============================================================
// Types
// ============================================================

export type AiParseSuccess = {
    status: 'success';
    qty: number | null;
    unit: string | null;
    name: string;
    notes?: string;  // Any notes/qualifiers extracted
    confidence: number;  // 0-1 confidence in the parse
};

export type AiParseError = {
    status: 'error';
    reason: string;
};

export type AiParseResult = AiParseSuccess | AiParseError;

// ============================================================
// Schema
// ============================================================

const RESPONSE_SCHEMA = {
    name: 'ingredient_parse',
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            qty: { type: ['number', 'null'] },
            unit: { type: ['string', 'null'] },
            name: { type: 'string' },
            notes: { type: ['string', 'null'] },
            confidence: { type: 'number' },
            error: { type: ['string', 'null'] },
        },
        required: ['qty', 'unit', 'name', 'confidence', 'error'],
    },
    strict: true,
};

// ============================================================
// System Prompt
// ============================================================

const SYSTEM_PROMPT = `You are an ingredient line parser. Extract the quantity, unit, and ingredient name from raw recipe ingredient strings.

RULES:
1. Extract the QUANTITY as a number (e.g., "1", "0.5", "2.5"). If no quantity, return null.
2. Extract the UNIT (e.g., "cup", "tbsp", "oz", "floz", "g", "lb"). If no unit or unitless, return null.
3. Extract the INGREDIENT NAME (the food itself, without quantity/unit).
4. Handle tricky patterns:
   - "1 5 floz serving red wine" → qty: 5, unit: "floz", name: "red wine" 
     (The "1" is a serving count, "5 floz" is the actual measure)
   - "2 4oz chicken breasts" → qty: 4, unit: "oz", name: "chicken breasts"
     (The "2" is count of breasts, "4oz" is weight each)
   - "buttery cinnamon powder" → qty: null, unit: null, name: "cinnamon powder"
     (No quantity, "buttery" is a descriptor to extract as note)
5. Normalize common variations:
   - "fl oz", "fl. oz", "fluid oz" → "floz"
   - "tsp", "teaspoon" → "tsp"
   - "tbsp", "tablespoon" → "tbsp"
6. Set confidence based on how clear the parse is (0.0-1.0).
7. If the input is truly unparseable, set error.

EXAMPLES:
- "1 5 floz serving red wine" → {qty: 5, unit: "floz", name: "red wine", notes: null, confidence: 0.9}
- "0.5 tsp buttery cinnamon powder" → {qty: 0.5, unit: "tsp", name: "cinnamon powder", notes: "buttery", confidence: 0.85}
- "3 large eggs" → {qty: 3, unit: "large", name: "eggs", notes: null, confidence: 0.95}
- "salt to taste" → {qty: null, unit: null, name: "salt", notes: "to taste", confidence: 0.9}
- "2 (14 oz) cans tomatoes" → {qty: 28, unit: "oz", name: "canned tomatoes", notes: null, confidence: 0.8}

Return JSON with: qty, unit, name, notes, confidence, error (null if success).`;

// ============================================================
// Main Function
// ============================================================

/**
 * Use AI to parse a difficult ingredient line.
 * This is a fallback for when the regex parser fails to detect qty/unit.
 * 
 * @param rawLine - The raw ingredient string to parse
 * @returns Parsed result with qty, unit, name
 */
export async function aiParseIngredient(rawLine: string): Promise<AiParseResult> {
    const userPrompt = `Parse this ingredient line:\n"${rawLine}"`;

    try {
        const result = await callStructuredLlm({
            schema: RESPONSE_SCHEMA,
            systemPrompt: SYSTEM_PROMPT,
            userPrompt,
            purpose: 'parse',  // Dedicated purpose for Ollama-only (simple structural extraction)
        });

        if (result.status === 'error') {
            logger.warn('ai_parse.llm_failed', { rawLine, error: result.error });
            return { status: 'error', reason: result.error ?? 'LLM call failed' };
        }

        const parsed = result.content as Record<string, unknown>;

        if (parsed.error) {
            logger.warn('ai_parse.parse_error', { rawLine, error: parsed.error });
            return { status: 'error', reason: parsed.error as string };
        }

        if (typeof parsed.name !== 'string') {
            return { status: 'error', reason: 'Invalid AI response: missing name' };
        }

        const parseResult: AiParseSuccess = {
            status: 'success',
            qty: typeof parsed.qty === 'number' ? parsed.qty : null,
            unit: typeof parsed.unit === 'string' ? parsed.unit : null,
            name: parsed.name,
            notes: typeof parsed.notes === 'string' ? parsed.notes : undefined,
            confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
        };

        logger.info('ai_parse.success', {
            rawLine,
            qty: parseResult.qty,
            unit: parseResult.unit,
            name: parseResult.name,
            confidence: parseResult.confidence,
        });

        return parseResult;
    } catch (err) {
        logger.error('ai_parse.exception', { rawLine, error: (err as Error).message });
        return { status: 'error', reason: (err as Error).message };
    }
}
