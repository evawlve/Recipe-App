import 'dotenv/config';
import {
    FATSECRET_CACHE_AI_MODEL,
    OPENAI_API_BASE_URL,
} from './config';
import { getAiNormalizeCache, saveAiNormalizeCache } from './validated-mapping-helpers';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';

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
    '',
    'RULES:',
    '1. Remove non-essential adjectives (fluffy, organic, premium, delicious).',
    '2. Remove brands unless the item IS the brand (e.g. Nutella).',
    '3. ALWAYS preserve fat/calorie/sodium/lean modifiers - they affect nutrition values!',
    '4. Remove fabricated flavor descriptors (buttery, tangy, zesty) that don\'t exist as real products.',
    '5. For use-case words (burger, hot dog, taco), identify the actual ingredient being described.',
    '6. OUTPUT JSON: { simplified: string, rationale: string }',
].join('\n');

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

    if (!OPENAI_API_KEY) return null;

    try {
        const response = await fetch(`${OPENAI_API_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: FATSECRET_CACHE_AI_MODEL,
                // Note: Some models don't support temperature=0
                response_format: {
                    type: 'json_schema', json_schema: {
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
                    }
                },
                messages: [
                    { role: 'system', content: SYSTEM_PROMPT },
                    { role: 'user', content: `Ingredient: ${rawLine}` },
                ],
            }),
        });

        const json = await response.json();
        const content = json?.choices?.[0]?.message?.content;
        if (!content) return null;

        const parsed = JSON.parse(content);
        if (!parsed.simplified) return null;

        // Save to cache (Abusing AiNormalizeCache)
        await saveAiNormalizeCache(cacheKey, {
            normalizedName: parsed.simplified,
            synonyms: [],
            prepPhrases: [],
            sizePhrases: [],
        });

        return {
            simplified: parsed.simplified,
            rationale: parsed.rationale,
        };

    } catch (err) {
        console.error('aiSimplifyIngredient error:', err);
        return null;
    }
}
