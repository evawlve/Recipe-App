import 'dotenv/config';
import { callStructuredLlm } from '../ai/structured-client';
import { getAiNormalizeCache, saveAiNormalizeCache } from './validated-mapping-helpers';

const CACHE_PREFIX = 'SIMPLIFY:';

const SYSTEM_PROMPT = [
    'You are a semantic simplifier for ingredient search.',
    'The user has a complex/failed ingredient string. Provide a SINGLE, COMMON name for this item found in standard databases.',
    '',
    'CRITICAL: Dietary modifiers that affect nutrition MUST be preserved:',
    '- Fat modifiers: "reduced fat", "low fat", "nonfat", "fat free", "light", "lite", "skim", "2%"',
    '- Calorie modifiers: "low calorie", "diet", "zero calorie", "sugar free"',
    '- Sodium modifiers: "low sodium", "reduced sodium", "no salt"',
    '- Lean modifiers: "lean", "extra lean", "93% lean"',
    '',
    'Examples:',
    '- "4 cup dry mix light & fluffy buttermilk complete pancake mix" → "Pancake Mix"',
    '- "1 tsp psyllium fiber powder unsweetened unflavored" → "Psyllium Husk"',
    '- "2 oz low calorie mayonnaise" → "Light Mayonnaise" (preserved dietary modifier)',
    '- "organic gluten free rollover oats" → "Rolled Oats"',
    '- "reduced fat colby and monterey jack cheese" → "Reduced Fat Colby Jack Cheese" (preserved dietary modifier)',
    '- "nonfat greek yogurt vanilla flavored" → "Nonfat Greek Yogurt" (preserved dietary modifier)',
    '',
    'EDGE CASE Examples:',
    '- "burger relish" → "Pickle Relish" (relish used on burgers is pickle relish)',
    '- "hot dog relish" → "Pickle Relish" (same product)',
    '- "buttery cinnamon powder" → "Cinnamon" (buttery is a fabricated flavor descriptor)',
    '- "buttery vanilla extract" → "Vanilla Extract" (remove fabricated flavors)',
    '- "vegetarian mince" → "Meatless Crumbles" (common API name for meat-free ground)',
    '- "vegan mince" → "Meatless Crumbles"',
    '- "plant-based ground" → "Plant Based Ground Beef"',
    '- "sugar free cherry pie filling" → "Sugar Free Cherry Pie Filling" (preserve dietary modifier)',
    '- "plum tomatoes" → "Plum Tomatoes" (already a valid, standard name)',
    '',
    'RULES:',
    '1. Remove non-essential adjectives (fluffy, organic, premium, delicious).',
    '2. Remove brands unless the item IS the brand (e.g. Nutella).',
    '3. ALWAYS preserve fat/calorie/sodium/lean modifiers - they affect nutrition values!',
    '4. Remove fabricated flavor descriptors (buttery, tangy, zesty) that don\'t exist as real products.',
    '5. For use-case words (burger, hot dog, taco), identify the actual ingredient being described.',
    '6. OUTPUT JSON: { simplified: string, rationale: string }',
].join('\n');

const JSON_SCHEMA = {
    name: 'simplify_ingredient',
    schema: {
        type: 'object',
        properties: {
            simplified: { type: 'string' },
            rationale: { type: 'string' }
        },
        required: ['simplified', 'rationale'],
        additionalProperties: false
    },
    strict: true
};

type AiSimplifyResult = {
    simplified: string;
    rationale: string;
} | null;

export async function aiSimplifyIngredient(rawLine: string): Promise<AiSimplifyResult> {
    const cacheKey = CACHE_PREFIX + rawLine;

    // 1. Check Cache
    const cached = await getAiNormalizeCache(cacheKey);
    if (cached && cached.normalizedName) {
        return {
            simplified: cached.normalizedName,
            rationale: 'from_cache',
        };
    }

    // 2. Call structured LLM with OpenRouter → OpenAI fallback
    try {
        const result = await callStructuredLlm({
            schema: JSON_SCHEMA,
            systemPrompt: SYSTEM_PROMPT,
            userPrompt: `Ingredient: ${rawLine}`,
            purpose: 'simplify',
        });

        if (result.status !== 'success' || !result.content) {
            console.error('aiSimplifyIngredient error:', result.error);
            return null;
        }

        const simplified = result.content.simplified as string;
        const rationale = result.content.rationale as string;

        if (!simplified) return null;

        // Save to cache
        await saveAiNormalizeCache(cacheKey, {
            normalizedName: simplified,
            synonyms: [],
            prepPhrases: [],
            sizePhrases: [],
        });

        return {
            simplified,
            rationale,
        };

    } catch (err) {
        console.error('aiSimplifyIngredient error:', err);
        return null;
    }
}
