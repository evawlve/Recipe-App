/**
 * Test script for structured LLM client
 * 
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/test-structured-client.ts
 * 
 * Tests:
 * 1. Provider chain detection
 * 2. Simple normalize call
 * 3. Timeout handling
 */

import 'dotenv/config';
import {
    callStructuredLlm,
    isOpenRouterConfigured,
    getConcurrencyLimit,
} from '../src/lib/ai/structured-client';

async function main() {
    console.log('='.repeat(60));
    console.log('Structured LLM Client Test');
    console.log('='.repeat(60));

    // Test 1: Provider configuration
    console.log('\n[1] Provider Configuration:');
    console.log(`    OpenRouter configured: ${isOpenRouterConfigured()}`);
    console.log(`    OpenAI configured: ${!!process.env.OPENAI_API_KEY}`);
    console.log(`    Concurrency (normalize): ${getConcurrencyLimit('normalize')}`);
    console.log(`    Concurrency (serving): ${getConcurrencyLimit('serving')}`);

    if (!isOpenRouterConfigured() && !process.env.OPENAI_API_KEY) {
        console.error('\n❌ No API keys configured! Set OPENROUTER_API_KEY or OPENAI_API_KEY');
        process.exit(1);
    }

    // Test 2: Simple normalize call
    console.log('\n[2] Testing normalize call (fat free milk):');

    const normalizeSchema = {
        name: 'test_normalize',
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                normalized_name: { type: 'string' },
                canonical_base: { type: 'string' },
                error: { type: ['string', 'null'] },
            },
            required: ['normalized_name', 'canonical_base', 'error'],
        },
        strict: true,
    };

    const result = await callStructuredLlm({
        schema: normalizeSchema,
        systemPrompt: 'You normalize ingredient strings. Return JSON with normalized_name and canonical_base.',
        userPrompt: 'Normalize: 2 cups fat free milk',
        purpose: 'normalize',
    });

    console.log(`    Status: ${result.status}`);
    console.log(`    Provider: ${result.provider}`);
    console.log(`    Model: ${result.model}`);
    console.log(`    Duration: ${result.durationMs}ms`);

    if (result.status === 'success') {
        console.log(`    Content:`, JSON.stringify(result.content, null, 2));
        console.log('\n✅ Test passed!');
    } else {
        console.log(`    Error: ${result.error}`);
        console.log('\n❌ Test failed!');
    }

    // Test 3: Serving estimation call
    console.log('\n[3] Testing ambiguous serving call (1 egg):');

    const servingSchema = {
        name: 'test_serving',
        schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                estimatedGrams: { type: 'number' },
                confidence: { type: 'number' },
                reasoning: { type: 'string' },
                error: { type: ['string', 'null'] },
            },
            required: ['estimatedGrams', 'confidence', 'reasoning', 'error'],
        },
        strict: true,
    };

    const servingResult = await callStructuredLlm({
        schema: servingSchema,
        systemPrompt: 'You estimate serving weights. Given a food and unit, estimate grams.',
        userPrompt: 'What is the typical weight in grams for 1 egg?',
        purpose: 'ambiguous',
    });

    console.log(`    Status: ${servingResult.status}`);
    console.log(`    Provider: ${servingResult.provider}`);
    console.log(`    Model: ${servingResult.model}`);
    console.log(`    Duration: ${servingResult.durationMs}ms`);

    if (servingResult.status === 'success') {
        console.log(`    Estimated grams: ${servingResult.content?.estimatedGrams}`);
        console.log(`    Confidence: ${servingResult.content?.confidence}`);
        console.log(`    Reasoning: ${servingResult.content?.reasoning}`);
        console.log('\n✅ Test passed!');
    } else {
        console.log(`    Error: ${servingResult.error}`);
        console.log('\n❌ Test failed!');
    }

    console.log('\n' + '='.repeat(60));
    console.log('All tests completed!');
    console.log('='.repeat(60));
}

main().catch(console.error);
