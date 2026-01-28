/**
 * Check AI Simplify cache and test direct API call
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log("\n=== CHECKING AI SIMPLIFY CACHE ===\n");

    // Check for cached SIMPLIFY entries
    const cachedEntries = await prisma.aiNormalizeCache.findMany({
        where: { key: { startsWith: 'SIMPLIFY:' } },
        take: 20,
    });

    console.log(`Found ${cachedEntries.length} SIMPLIFY cache entries:\n`);
    for (const entry of cachedEntries) {
        const data = entry.data as any;
        console.log(`  Key: ${entry.key}`);
        console.log(`    Normalized: ${data?.normalizedName ?? 'NULL'}`);
    }

    // Check if specific failing ingredients have cache entries
    const failedIngredients = [
        "buttery cinnamon powder",
        "sugar free cherry pie filling",
        "vegetarian mince",
        "burger relish",
        "plum tomatoes",
    ];

    console.log("\n=== CHECKING SPECIFIC FAILED INGREDIENTS ===\n");
    for (const ingredient of failedIngredients) {
        const cacheKey = `SIMPLIFY:${ingredient}`;
        const cached = await prisma.aiNormalizeCache.findUnique({
            where: { key: cacheKey }
        });
        console.log(`  "${ingredient}": ${cached ? 'CACHED' : 'NOT CACHED'}`);
        if (cached) {
            const data = cached.data as any;
            console.log(`    → normalizedName: ${data?.normalizedName ?? 'NULL'}`);
        }
    }

    // Test direct OpenAI API call
    console.log("\n=== TESTING DIRECT OPENAI API CALL ===\n");
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
    console.log(`  OPENAI_API_KEY set: ${!!OPENAI_API_KEY}`);
    console.log(`  Key prefix: ${OPENAI_API_KEY?.slice(0, 10)}...`);

    if (OPENAI_API_KEY) {
        try {
            const testPrompt = "burger relish";
            console.log(`  Testing with: "${testPrompt}"`);

            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${OPENAI_API_KEY}`,
                },
                body: JSON.stringify({
                    model: 'gpt-4.1-mini',
                    response_format: { type: 'json_object' },
                    messages: [
                        { role: 'system', content: 'You are a semantic simplifier. Return JSON: { simplified: string, rationale: string }' },
                        { role: 'user', content: `Simplify ingredient: ${testPrompt}` },
                    ],
                }),
            });

            console.log(`  Response status: ${response.status}`);
            const json = await response.json();

            if (json.error) {
                console.log(`  API Error: ${JSON.stringify(json.error)}`);
            } else {
                const content = json?.choices?.[0]?.message?.content;
                console.log(`  API Response: ${content}`);
            }
        } catch (err) {
            console.error(`  API call error: ${(err as Error).message}`);
        }
    }

    await prisma.$disconnect();
}

main().catch(console.error);
