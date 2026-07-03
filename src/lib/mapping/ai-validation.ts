/**
 * AI-powered validation of ingredient mappings
 * 
 * This module provides the core AI validation logic that determines if a mapping
 * is accurate enough to be cached for all users.
 */

import { logger } from '../logger';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_BASE_URL = 'https://api.openai.com/v1';
const AI_MODEL = 'gpt-4o-mini'; // Fast and cost-effective

export type AIValidationResult = {
    approved: boolean;
    confidence: number; // 0.0-1.0
    reason: string;
    category?: 'fat_mismatch' | 'type_mismatch' | 'preparation_mismatch' | 'generic_vs_specific' | 'search_query_issue' | 'search_scoring_issue' | 'correct';
    suggestedAlternative?: string | null;
    detectedIssues?: Array<'included_measurement' | 'included_prep_phrase' | 'included_brand' | 'too_vague' | 'too_specific' | 'wrong_ingredient_type' | 'nutrition_mismatch' | 'none'>;
    detectedQualifiers?: {
        fatContent?: string; // '90% lean', 'fat-free', 'whole', etc.
        preparationState?: string; // 'raw', 'cooked', 'canned'
        specificType?: string; // 'rice vinegar', 'soy sauce'
    };
};

const VALIDATION_SCHEMA = {
    name: 'ingredient_validation',
    strict: true,
    schema: {
        type: 'object',
        properties: {
            approved: {
                type: 'boolean',
                description: 'Whether the mapping is nutritionally accurate'
            },
            confidence: {
                type: 'number',
                description: 'Confidence score from 0.0 to 1.0'
            },
            reason: {
                type: 'string',
                description: 'Brief explanation of the decision'
            },
            category: {
                type: 'string',
                enum: ['fat_mismatch', 'type_mismatch', 'preparation_mismatch', 'generic_vs_specific', 'search_query_issue', 'search_scoring_issue', 'correct'],
                description: 'Category of the validation result'
            },
            suggestedAlternative: {
                type: ['string', 'null'],
                description: 'If rejected, suggest a better search term (for search_query_issue) or note that search was fine (for search_scoring_issue)'
            },
            detectedIssues: {
                type: 'array',
                items: {
                    type: 'string',
                    enum: ['included_measurement', 'included_prep_phrase', 'included_brand', 'too_vague', 'too_specific', 'wrong_ingredient_type', 'nutrition_mismatch', 'none']
                },
                description: 'Array of specific issues detected (can be multiple)'
            }
        },
        required: ['approved', 'confidence', 'reason', 'category', 'suggestedAlternative', 'detectedIssues'],
        additionalProperties: false
    }
};

/**
 * Validate an ingredient mapping using AI
 */
export async function validateMappingWithAI(
    rawIngredient: string,
    mapping: {
        foodId: string;
        foodName: string;
        brandName?: string | null;
        searchQuery?: string;
        ourConfidence: number;
        nutrition?: {
            protein: number;
            carbs: number;
            fat: number;
            kcal: number;
        };
    }
): Promise<AIValidationResult> {
    // If no API key, fail open (allow mapping but with low confidence)
    if (!OPENAI_API_KEY) {
        logger.warn('ai_validation.no_api_key', { rawIngredient });
        return {
            approved: true,
            confidence: 0.5,
            reason: 'AI validation unavailable (no API key)',
            category: 'correct',
            suggestedAlternative: null,
            detectedIssues: ['none'],
        };
    }

    const nutritionInfo = mapping.nutrition
        ? `\nNutrition (per 100g): ${mapping.nutrition.protein}g protein, ${mapping.nutrition.carbs}g carbs, ${mapping.nutrition.fat}g fat, ${mapping.nutrition.kcal} kcal`
        : '';

    const searchQueryInfo = mapping.searchQuery
        ? `\nSearch query used: "${mapping.searchQuery}"`
        : '';

    const prompt = `You are validating an ingredient mapping for nutrition tracking.

Recipe ingredient: "${rawIngredient}"${searchQueryInfo}
Mapped to: "${mapping.foodName}"${mapping.brandName ? ` (${mapping.brandName})` : ''}${nutritionInfo}
System confidence: ${mapping.ourConfidence.toFixed(2)}

Determine if this mapping is CORRECT for nutrition calculations. Pay special attention to:

1. **Fat content qualifiers**: 90% lean, 80/20, fat-free, reduced-fat, whole milk, skim, 2%, low-fat
2. **Specific types**: Rice vinegar (not just vinegar), soy sauce (not just sauce), olive oil (not vegetable oil)
3. **Preparation states**: Raw vs cooked, canned vs fresh, frozen
4. **Compound ingredients**: Must preserve both words (e.g., "ground beef" not just "beef")
5. **Nutrition mismatch**: Check if nutrition values make sense (e.g., almond flour has ~50g fat/100g, rice flour has ~1g)
6. **Search query issues**: If search query contains measurements ("2 tbsp"), prep phrases ("blanched"), or brands, flag it

Common failure patterns to watch for:
- "90 lean ground beef" mapped to generic "Beef" (WRONG - missing leanness, causes incorrect fat calculations)
- "rice vinegar" mapped to "Vinegar" (WRONG - missing type specificity)
- "skim milk" mapped to "Milk, whole" (WRONG - fat content mismatch)
- "cooked rice" mapped to "Rice, raw" (WRONG - preparation state affects calories)
- "almond flour" mapped to "Rice Flour" (WRONG - completely different ingredient, nutrition mismatch)
- Search query: "2 tbsp almond flour blanched" (WRONG - includes measurement and prep phrase, should be just "almond flour")

Guidelines:
- If the ingredient specifies a qualifier that affects nutrition (fat %, preparation state, specific type), the mapping MUST include it
- Generic mappings are only acceptable if the ingredient itself is generic
- If you're unsure, err on the side of rejection and suggest a more specific search term

Categories Explained:
- 'search_query_issue': The search query itself was poorly constructed (e.g., included measurements or too many qualifiers). Suggest a CLEANER search query.
- 'search_scoring_issue': The search query was correct, but the wrong result was selected from the candidates. This indicates a candidate scoring problem, not a search problem.
- Other categories: Use for specific nutrition mismatches (fat_mismatch, type_mismatch, etc.)

Detected Issues (can be multiple):
- 'included_measurement': Search query contains measurements like "2 tbsp", "1 cup"
- 'included_prep_phrase': Query contains prep phrases like "blanched", "diced", "raw"
- 'included_brand': Query contains brand names that confused the search
- 'wrong_ingredient_type': Mapped to completely different food category
- 'nutrition_mismatch': Nutrition values don't match expected values for this ingredient
- 'too_vague': Query was too generic
- 'too_specific': Query was overly specific and limited results
- 'none': No issues detected

Respond with:
- approved: true if mapping is nutritionally accurate, false if it will cause incorrect calculations
- confidence: 0.0-1.0 (how certain you are of your decision)
- reason: Brief explanation (one sentence)
- category: Use 'search_query_issue' if the search itself was bad, 'search_scoring_issue' if search was OK but wrong candidate picked
- suggestedAlternative: If rejected, suggest a better search term (for search_query_issue) or null if search was fine
- detectedIssues: Array of specific issues found (can be multiple, e.g., ["included_measurement", "included_prep_phrase"])`;

    try {
        const response = await fetch(`${OPENAI_API_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: AI_MODEL,
                response_format: {
                    type: 'json_schema',
                    json_schema: VALIDATION_SCHEMA
                },
                messages: [
                    {
                        role: 'system',
                        content: 'You are a nutrition mapping validator. Your job is to ensure ingredient mappings are accurate for calorie and nutrition tracking.'
                    },
                    { role: 'user', content: prompt },
                ],
                temperature: 0.1, // Low temperature for consistent validation
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`OpenAI API error: ${response.status} ${errorText}`);
        }

        const json = await response.json();
        const result: AIValidationResult = JSON.parse(json.choices[0].message.content);

        logger.info('ai_validation.completed', {
            rawIngredient,
            mappedTo: mapping.foodName,
            approved: result.approved,
            confidence: result.confidence,
            category: result.category,
            detectedIssues: result.detectedIssues,
        });

        return result;
    } catch (error) {
        logger.error('ai_validation.error', {
            error: (error as Error).message,
            rawIngredient,
        });

        // Fail open - if AI is down, don't block mapping
        // But flag it with medium confidence so it doesn't get auto-cached
        return {
            approved: true,
            confidence: 0.5,
            reason: `AI validation failed: ${(error as Error).message}`,
            category: 'correct',
            suggestedAlternative: null,
            detectedIssues: ['none'],
        };
    }
}
