import 'dotenv/config';
import {
    FATSECRET_CACHE_AI_MODEL,
    OPENAI_API_BASE_URL,
} from './config';
import type { FatSecretFoodSummary } from './client';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';

const RESPONSE_SCHEMA = {
    name: 'fatsecret_refine_search',
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            suggested_query: { type: 'string' },
            reason: { type: 'string' },
            error: { type: ['string', 'null'] },
        },
        required: ['suggested_query', 'reason', 'error'],
    },
    strict: true,
};

const SYSTEM_PROMPT = [
    'You are an expert at finding FatSecret food entries.',
    'The user will provide a raw ingredient string and a list of candidates that were found but rejected (or empty if none found).',
    'Your job is to suggest a BETTER search query to find the correct food.',
    'Rules:',
    '- Simplify: remove adjectives, quantities, and brand names if they might be confusing the search.',
    '- Be specific: if the raw string is vague (e.g. "flour"), suggest a common type (e.g. "all purpose flour") or keep it simple if that failed.',
    '- Synonyms: try a common synonym if the original term failed (e.g. "aubergine" -> "eggplant").',
    '- Return JSON with "suggested_query" and "reason".',
].join(' ');

export async function refineSearchQuery(
    rawIngredient: string,
    failedCandidates: FatSecretFoodSummary[]
): Promise<{ suggestedQuery: string; reason: string } | null> {
    if (!OPENAI_API_KEY) return null;

    const candidateNames = failedCandidates.slice(0, 5).map(c => c.name).join(', ');
    const userPrompt = `Raw Ingredient: "${rawIngredient}"\nFailed Candidates: [${candidateNames}]\nSuggest a better search query.`;

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
        if (!content) return null;

        const parsed = JSON.parse(content);
        if (parsed.error || !parsed.suggested_query) return null;

        return {
            suggestedQuery: parsed.suggested_query,
            reason: parsed.reason,
        };
    } catch (error) {
        return null;
    }
}
