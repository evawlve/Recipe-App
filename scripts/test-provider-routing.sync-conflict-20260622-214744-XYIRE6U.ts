/**
 * Test script for AI Provider Routing
 * 
 * Verifies that:
 * 1. 'parse' purpose uses Ollama only (if available)
 * 2. Other purposes (normalize, serving) use cloud providers
 * 
 * Usage:
 *   npx ts-node --project tsconfig.scripts.json --transpile-only -r tsconfig-paths/register scripts/test-provider-routing.ts
 */

import 'dotenv/config';
import {
    callStructuredLlm,
    getAiCallMetrics,
    resetAiCallMetrics,
} from '../src/lib/ai/structured-client';
import { OLLAMA_ENABLED } from '../src/lib/fatsecret/config';

const TEST_SCHEMA = {
    name: 'test_response',
    schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            result: { type: 'string' },
            error: { type: ['string', 'null'] },
        },
        required: ['result', 'error'],
    },
    strict: true,
};

async function main() {
    console.log('='.repeat(60));
    console.log('AI Provider Routing Test');
    console.log('='.repeat(60));

    console.log('\n[Config]');
    console.log(`  OLLAMA_ENABLED: ${OLLAMA_ENABLED}`);
    console.log(`  OPENROUTER_API_KEY: ${process.env.OPENROUTER_API_KEY ? 'configured' : 'NOT SET'}`);
    console.log(`  OPENAI_API_KEY: ${process.env.OPENAI_API_KEY ? 'configured' : 'NOT SET'}`);

    resetAiCallMetrics();

    // Test 1: 'parse' purpose should use Ollama (if available)
    console.log('\n[1] Testing "parse" purpose (should use Ollama):');
    const parseResult = await callStructuredLlm({
        schema: TEST_SCHEMA,
        systemPrompt: 'You are a simple test assistant. Return JSON with result field.',
        userPrompt: 'Say "hello" in the result field.',
        purpose: 'parse',
    });

    console.log(`    Status: ${parseResult.status}`);
    console.log(`    Provider: ${parseResult.provider}`);
    console.log(`    Model: ${parseResult.model}`);
    console.log(`    Duration: ${parseResult.durationMs}ms`);

    if (OLLAMA_ENABLED) {
        if (parseResult.provider === 'ollama') {
            console.log('    ✅ PASS: parse purpose correctly routed to Ollama');
        } else {
            console.log(`    ❌ FAIL: Expected ollama, got ${parseResult.provider}`);
        }
    } else {
        if (parseResult.status === 'error') {
            console.log('    ✅ PASS: parse purpose correctly failed (Ollama disabled)');
        } else {
            console.log('    ⚠️  WARN: Ollama disabled but call succeeded (unexpected)');
        }
    }

    // Test 2: 'normalize' purpose should use cloud providers
    console.log('\n[2] Testing "normalize" purpose (should use OpenRouter/OpenAI):');
    const normalizeResult = await callStructuredLlm({
        schema: TEST_SCHEMA,
        systemPrompt: 'You are a simple test assistant. Return JSON with result field.',
        userPrompt: 'Say "world" in the result field.',
        purpose: 'normalize',
    });

    console.log(`    Status: ${normalizeResult.status}`);
    console.log(`    Provider: ${normalizeResult.provider}`);
    console.log(`    Model: ${normalizeResult.model}`);
    console.log(`    Duration: ${normalizeResult.durationMs}ms`);

    if (normalizeResult.provider === 'openrouter' || normalizeResult.provider === 'openai') {
        console.log('    ✅ PASS: normalize purpose correctly routed to cloud provider');
    } else if (normalizeResult.provider === 'ollama') {
        console.log(`    ❌ FAIL: Expected cloud provider, got ollama`);
    }

    // Test 3: 'serving' purpose should use cloud providers
    console.log('\n[3] Testing "serving" purpose (should use OpenRouter/OpenAI):');
    const servingResult = await callStructuredLlm({
        schema: TEST_SCHEMA,
        systemPrompt: 'You are a simple test assistant. Return JSON with result field.',
        userPrompt: 'Say "test" in the result field.',
        purpose: 'serving',
    });

    console.log(`    Status: ${servingResult.status}`);
    console.log(`    Provider: ${servingResult.provider}`);
    console.log(`    Model: ${servingResult.model}`);
    console.log(`    Duration: ${servingResult.durationMs}ms`);

    if (servingResult.provider === 'openrouter' || servingResult.provider === 'openai') {
        console.log('    ✅ PASS: serving purpose correctly routed to cloud provider');
    } else if (servingResult.provider === 'ollama') {
        console.log(`    ❌ FAIL: Expected cloud provider, got ollama`);
    }

    // Test 4: forceProvider override
    console.log('\n[4] Testing forceProvider override (normalize + forceProvider=openai):');
    const forceResult = await callStructuredLlm({
        schema: TEST_SCHEMA,
        systemPrompt: 'You are a simple test assistant. Return JSON with result field.',
        userPrompt: 'Say "forced" in the result field.',
        purpose: 'normalize',
        forceProvider: 'openai',
    });

    console.log(`    Status: ${forceResult.status}`);
    console.log(`    Provider: ${forceResult.provider}`);
    console.log(`    Model: ${forceResult.model}`);

    if (forceResult.provider === 'openai') {
        console.log('    ✅ PASS: forceProvider correctly overrode to OpenAI');
    } else if (forceResult.status === 'error') {
        console.log('    ⚠️  WARN: OpenAI not configured, cannot test forceProvider');
    } else {
        console.log(`    ❌ FAIL: Expected openai, got ${forceResult.provider}`);
    }

    // Print metrics summary
    const metrics = getAiCallMetrics();
    console.log('\n[Metrics Summary]');
    console.log(`    Parse calls: ${metrics.parse}`);
    console.log(`    Normalize calls: ${metrics.normalize}`);
    console.log(`    Serving calls: ${metrics.serving}`);
    console.log(`    Total calls: ${metrics.total}`);

    console.log('\n' + '='.repeat(60));
    console.log('Provider Routing Test Complete!');
    console.log('='.repeat(60));
}

main().catch(console.error);
