/**
 * Guard for the jest LLM-egress gate (`jest.setup.no-llm.js`, wired as `setupFiles`
 * in both projects of jest.config.js).
 *
 * The gate is an enumeration of today's provider list, so its failure mode is silent:
 * delete a line, or add a provider it does not know about, and nothing goes red — the
 * suite just starts making live, billable calls again on developer machines, while CI
 * (which has no key) stays green either way. This file is what makes that loud.
 *
 * MEASURED 2026-08-02, before the gate existed, by a temporary probe run under
 * `npx jest`: `getProviderChain()` returned `['openrouter','openrouter','openai']` for
 * all seven purposes and one `callStructuredLlm` reached OpenRouter for real
 * (`provider=openrouter, model=openai/gpt-4o-mini, duration=1114ms`). With
 * OLLAMA_ENABLED=true — the code default in `getFlag()` — the `parse` chain led with
 * a keyless `ollama` entry. After the gate every one of those chains is [].
 */

// FIRST import on purpose. `ai-parse`, `ai-normalize`, `ai-simplify`, `ai-rerank` and
// `ai-search-refine` each do exactly this at module scope, which is how the real
// `.env` gets into a jest process at all. Loading it here means the assertions below
// run against the worst case rather than a convenient one: if the gate ever switches
// from assigning '' to `delete`, dotenv repopulates the real keys at this line and
// every expectation in this file fails.
import 'dotenv/config';

import {
    getProviderChain,
    callStructuredLlm,
    isOpenRouterConfigured,
    type StructuredLlmPurpose,
    type StructuredLlmProvider,
} from '../structured-client';

// Written as exhaustive Records rather than arrays so that adding a purpose or a
// provider to structured-client.ts is a COMPILE error here (the api project runs
// ts-jest with type-checking on), not a silently unchecked new egress path.
const ALL_PURPOSES: Record<StructuredLlmPurpose, true> = {
    normalize: true,
    serving: true,
    ambiguous: true,
    produce: true,
    parse: true,
    simplify: true,
    nutrition: true,
};

const ALL_PROVIDERS: Record<StructuredLlmProvider, true> = {
    ollama: true,
    openrouter: true,
    openai: true,
};

const purposes = Object.keys(ALL_PURPOSES) as StructuredLlmPurpose[];
const providers = Object.keys(ALL_PROVIDERS) as StructuredLlmProvider[];

describe('no test may reach a live LLM provider', () => {
    it('leaves the credentials blank even after dotenv/config has run', () => {
        // '' and not undefined: the empty string is what stops dotenv from writing the
        // real value, because dotenv only fills keys absent from process.env.
        expect(process.env.OPENROUTER_API_KEY).toBe('');
        expect(process.env.OPENAI_API_KEY).toBe('');
    });

    it('disables the provider that needs no credential', () => {
        // OLLAMA_ENABLED defaults to TRUE in getFlag() (src/lib/mapping/config.ts) and
        // the Ollama branch supplies its own literal apiKey, so blanking keys alone
        // leaves localhost:11434 reachable.
        expect(process.env.OLLAMA_ENABLED).toBe('false');
    });

    it('points every provider base URL at a closed port', () => {
        // Defence in depth for a provider added without a key guard: every request in
        // this repo is `${baseUrl}/chat/completions`.
        for (const url of [
            process.env.OPENROUTER_BASE_URL,
            process.env.OPENAI_API_BASE_URL,
            process.env.OLLAMA_BASE_URL,
        ]) {
            expect(url).toBe('http://127.0.0.1:1/jest-no-llm-gate');
        }
    });

    it.each(purposes)('builds an empty provider chain for purpose %s', (purpose) => {
        expect(getProviderChain(purpose)).toEqual([]);
    });

    it.each(providers)('builds an empty provider chain when forced to %s', (provider) => {
        // forceProvider bypasses purpose routing, so it needs its own coverage — the
        // ollama case in particular short-circuits before any key is consulted.
        for (const purpose of purposes) {
            expect(getProviderChain(purpose, provider)).toEqual([]);
        }
    });

    it('reports OpenRouter as unconfigured', () => {
        expect(isOpenRouterConfigured()).toBe(false);
    });

    it('degrades callStructuredLlm to the same shape CI sees', async () => {
        // An empty chain returns before fetch() is ever reached, so this makes no
        // network call. The error text is the one CI has always produced.
        const result = await callStructuredLlm({
            schema: { type: 'object' },
            systemPrompt: 'unused',
            userPrompt: 'unused',
            purpose: 'simplify',
        });
        expect(result.status).toBe('error');
        expect(result.error).toContain('No API keys configured');
    });
});
