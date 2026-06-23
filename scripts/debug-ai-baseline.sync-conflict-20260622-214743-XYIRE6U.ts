import 'dotenv/config';
import { logger } from '../src/lib/logger';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_API_BASE_URL = 'https://api.openai.com/v1';
const AI_MODEL = 'gpt-4o-mini';

async function queryAiBaseline(ingredient: string) {
    console.log(`\n🤖 Querying AI baseline for: "${ingredient}"...`);

    const prompt = `You are a nutrition expert.
Please provide the TYPICAL nutritional profile per 100g for: "${ingredient}"

Format your response as a JSON object with these fields:
- calories (kcal)
- protein (g)
- carbs (g)
- fat (g)
- acceptable_fat_range (min-max g)
- notes (explain any variations)

Be specific about what you consider "standard" vs "outlier".`;

    try {
        const response = await fetch(`${OPENAI_API_BASE_URL}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
                model: AI_MODEL,
                messages: [
                    { role: 'user', content: prompt },
                ],
                temperature: 0,
            }),
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.status} ${await response.text()}`);
        }

        const json = await response.json();
        const content = json.choices[0].message.content;

        try {
            // Strip markdown code blocks if present
            const cleanContent = content.replace(/```json\n|\n```/g, '').replace(/```/g, '');
            const data = JSON.parse(cleanContent);
            console.log(`\n--- Baseline for ${ingredient} ---`);
            console.log(`Fat: ${data.fat}g`);
            console.log(`Acceptable Range: ${JSON.stringify(data.acceptable_fat_range)}`);
            console.log(`Notes: ${data.notes}`);
            console.log('-----------------------------------');
        } catch (e) {
            console.log('Raw output (parse failed):', content);
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

async function main() {
    await queryAiBaseline('Almond Flour Meal');
}

main().catch(console.error);
