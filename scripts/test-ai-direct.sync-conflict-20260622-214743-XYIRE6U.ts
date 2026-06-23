import 'dotenv/config';
import { FATSECRET_CACHE_AI_MODEL, OPENAI_API_BASE_URL } from '../src/lib/fatsecret/config';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';

async function testDirectAiCall() {
    const input = "4 cup dry mix light & fluffy buttermilk complete pancake mix";

    console.log('=== TESTING DIRECT OPENAI CALL ===');
    console.log('Input:', input);
    console.log('Model:', FATSECRET_CACHE_AI_MODEL);
    console.log('API URL:', OPENAI_API_BASE_URL);
    console.log('API Key present:', !!OPENAI_API_KEY);

    const SYSTEM_PROMPT = [
        'You are a semantic simplifier for ingredient search.',
        'The user has a complex/failed ingredient string. Provide a SINGLE, GENERIC, COMMON name for this item found in standard databases.',
        'Examples:',
        '- "4 cup dry mix light & fluffy buttermilk complete pancake mix" → "Pancake Mix"',
        '- "1 tsp psyllium fiber powder unsweetened unflavored" → "Psyllium Husk"',
        'CRITICAL RULES:',
        '1. Remove non-essential adjectives (fluffy, organic, premium).',
        '2. Remove brands unless the item IS the brand (e.g. Nutella).',
        '3. KEEP core identity.',
        '4. OUTPUT JSON: { simplified: string, rationale: string }',
    ].join('\n');

    try {
        const response = await fetch(`${OPENAI_API_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: FATSECRET_CACHE_AI_MODEL,
                temperature: 0,
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
                    { role: 'user', content: `Ingredient: ${input}` },
                ],
            }),
        });

        console.log('\nResponse status:', response.status);
        const json = await response.json();
        console.log('Response:', JSON.stringify(json, null, 2));

        const content = json?.choices?.[0]?.message?.content;
        console.log('\nParsed content:', content);

        if (content) {
            const parsed = JSON.parse(content);
            console.log('Simplified:', parsed.simplified);
        }

    } catch (err) {
        console.error('ERROR:', err);
    }
}

testDirectAiCall();
