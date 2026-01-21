/**
 * Test script for local Ollama LLM integration
 * Verifies that the structured-client correctly uses Ollama for serving estimation
 * 
 * Usage: npx tsx scripts/test-ollama-integration.ts
 */

import 'dotenv/config';
import { callStructuredLlm, getAiCallSummary, resetAiCallMetrics } from '../src/lib/ai/structured-client';

const SERVING_SCHEMA = {
    name: 'serving_estimation',
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            servingLabel: { type: 'string' },
            grams: { type: 'number' },
            confidence: { type: 'number' },
            rationale: { type: 'string' },
        },
        required: ['servingLabel', 'grams', 'confidence'],
    },
};

const SYSTEM_PROMPT = `You are a nutrition assistant that estimates serving weights in grams.
Given a food and serving description, estimate the weight in grams.
Report your confidence between 0 and 1 and include a short rationale.`;

async function testServingEstimation(query: string): Promise<void> {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`Testing: "${query}"`);
    console.log('='.repeat(60));

    const startTime = Date.now();

    const result = await callStructuredLlm({
        schema: SERVING_SCHEMA,
        systemPrompt: SYSTEM_PROMPT,
        userPrompt: `Estimate the weight of: ${query}`,
        purpose: 'serving',
    });

    const duration = Date.now() - startTime;

    if (result.status === 'success') {
        console.log(`✅ SUCCESS`);
        console.log(`   Provider: ${result.provider}`);
        console.log(`   Model: ${result.model}`);
        console.log(`   Duration: ${duration}ms`);
        console.log(`   Response:`, JSON.stringify(result.content, null, 2));
    } else {
        console.log(`❌ ERROR: ${result.error}`);
        console.log(`   Provider: ${result.provider}`);
        console.log(`   Model: ${result.model}`);
    }
}

async function main(): Promise<void> {
    console.log('\n🧪 Ollama Integration Test\n');
    console.log('Environment check:');
    console.log(`   OLLAMA_ENABLED: ${process.env.OLLAMA_ENABLED ?? 'true (default)'}`);
    console.log(`   OLLAMA_BASE_URL: ${process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434/v1 (default)'}`);
    console.log(`   OLLAMA_MODEL: ${process.env.OLLAMA_MODEL ?? 'qwen2.5:14b (default)'}`);

    resetAiCallMetrics();

    // Test various serving estimations
    const testCases = [
        '1 tbsp pancake mix',
        '1 cup all-purpose flour',
        '1 medium avocado',
        '2 slices whole wheat bread',
        '1 packet instant oatmeal',
    ];

    for (const testCase of testCases) {
        await testServingEstimation(testCase);
    }

    console.log('\n' + '='.repeat(60));
    console.log('SUMMARY');
    console.log('='.repeat(60));
    console.log(getAiCallSummary());
}

main().catch(console.error);
