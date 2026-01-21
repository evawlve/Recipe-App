/**
 * Structured LLM Client
 * 
 * Unified client for all structured JSON LLM calls with:
 * - Provider fallback chain: OpenRouter (cheap) → OpenAI (reliable)
 * - AbortController timeout
 * - Retry with exponential backoff
 * - Per-purpose concurrency limiters
 * - Metrics logging
 * 
 * @module structured-client
 * @since Jan 2026 - AI Cost Reduction Refactor
 */

import {
    FATSECRET_CACHE_AI_MODEL,
    OPENAI_API_BASE_URL,
    OPENROUTER_API_KEY,
    OPENROUTER_BASE_URL,
    CHEAP_AI_MODEL_PRIMARY,
    CHEAP_AI_MODEL_FALLBACK,
    STRUCTURED_LLM_TIMEOUT_MS,
    STRUCTURED_LLM_MAX_RETRIES,
    OLLAMA_ENABLED,
    OLLAMA_BASE_URL,
    OLLAMA_MODEL,
    OLLAMA_TIMEOUT_MS,
} from '../fatsecret/config';

// ============================================================
// Types
// ============================================================

export type StructuredLlmPurpose = 'normalize' | 'serving' | 'ambiguous' | 'produce';
export type StructuredLlmProvider = 'ollama' | 'openrouter' | 'openai';

export interface StructuredLlmOptions {
    /** JSON schema for response_format */
    schema: object;
    /** System prompt */
    systemPrompt: string;
    /** User prompt */
    userPrompt: string;
    /** Purpose category for concurrency limiting and metrics */
    purpose: StructuredLlmPurpose;
    /** Timeout in ms (default: STRUCTURED_LLM_TIMEOUT_MS from config) */
    timeout?: number;
}

export interface StructuredLlmResult {
    status: 'success' | 'error';
    content?: Record<string, unknown>;
    provider: StructuredLlmProvider;
    model: string;
    raw?: unknown;
    error?: string;
    durationMs?: number;
}

// ============================================================
// Simple Semaphore for Concurrency Limiting
// (Avoids ESM import issues with p-limit)
// ============================================================

class Semaphore {
    private permits: number;
    private waiting: Array<() => void> = [];
    private _activeCount = 0;

    constructor(permits: number) {
        this.permits = permits;
    }

    get activeCount(): number {
        return this._activeCount;
    }

    get pendingCount(): number {
        return this.waiting.length;
    }

    async acquire(): Promise<void> {
        if (this.permits > 0) {
            this.permits--;
            this._activeCount++;
            return;
        }

        return new Promise<void>((resolve) => {
            this.waiting.push(() => {
                this._activeCount++;
                resolve();
            });
        });
    }

    release(): void {
        this._activeCount--;
        const next = this.waiting.shift();
        if (next) {
            next();
        } else {
            this.permits++;
        }
    }

    async run<T>(fn: () => Promise<T>): Promise<T> {
        await this.acquire();
        try {
            return await fn();
        } finally {
            this.release();
        }
    }
}

// ============================================================
// Concurrency Limiters (per-purpose)
// ============================================================

const CONCURRENCY_LIMITS: Record<StructuredLlmPurpose, number> = {
    normalize: 10,
    serving: 5,
    ambiguous: 5,
    produce: 5,
};

const limiters: Record<StructuredLlmPurpose, Semaphore> = {
    normalize: new Semaphore(CONCURRENCY_LIMITS.normalize),
    serving: new Semaphore(CONCURRENCY_LIMITS.serving),
    ambiguous: new Semaphore(CONCURRENCY_LIMITS.ambiguous),
    produce: new Semaphore(CONCURRENCY_LIMITS.produce),
};

// ============================================================
// Provider Configuration
// ============================================================

interface ProviderConfig {
    name: StructuredLlmProvider;
    baseUrl: string;
    apiKey: string;
    model: string;
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? '';

function getProviderChain(): ProviderConfig[] {
    const chain: ProviderConfig[] = [];

    // Local Ollama first (free, fast, no rate limits - RTX 3090)
    if (OLLAMA_ENABLED) {
        chain.push({
            name: 'ollama',
            baseUrl: OLLAMA_BASE_URL,
            apiKey: 'ollama',  // Ollama doesn't require an API key
            model: OLLAMA_MODEL,
        });
    }

    // OpenRouter primary (cheap cloud fallback)
    if (OPENROUTER_API_KEY) {
        chain.push({
            name: 'openrouter',
            baseUrl: OPENROUTER_BASE_URL,
            apiKey: OPENROUTER_API_KEY,
            model: CHEAP_AI_MODEL_PRIMARY,
        });

        // OpenRouter fallback (also cheap, different model)
        chain.push({
            name: 'openrouter',
            baseUrl: OPENROUTER_BASE_URL,
            apiKey: OPENROUTER_API_KEY,
            model: CHEAP_AI_MODEL_FALLBACK,
        });
    }

    // OpenAI fallback (reliable but more expensive)
    if (OPENAI_API_KEY) {
        chain.push({
            name: 'openai',
            baseUrl: OPENAI_API_BASE_URL,
            apiKey: OPENAI_API_KEY,
            model: FATSECRET_CACHE_AI_MODEL,
        });
    }

    return chain;
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if error is retryable (rate limit or server error)
 */
function isRetryableError(status: number): boolean {
    return status === 429 || (status >= 500 && status < 600);
}

/**
 * Get backoff delay with exponential increase + jitter
 */
function getBackoffDelay(attempt: number): number {
    const baseDelay = 1000; // 1 second
    const maxDelay = 10000; // 10 seconds
    const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
    const jitter = Math.random() * 500; // 0-500ms jitter
    return exponentialDelay + jitter;
}

// ============================================================
// Core Request Function
// ============================================================

interface RequestResult {
    success: boolean;
    content?: Record<string, unknown>;
    raw?: unknown;
    error?: string;
    status?: number;
}

async function makeRequest(
    provider: ProviderConfig,
    schema: object,
    systemPrompt: string,
    userPrompt: string,
    timeout: number
): Promise<RequestResult> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${provider.apiKey}`,
        };

        // OpenRouter requires additional headers
        if (provider.name === 'openrouter') {
            headers['HTTP-Referer'] = 'https://recipe-app.local';
            headers['X-Title'] = 'Recipe App Ingredient Mapping';
        }

        const response = await fetch(`${provider.baseUrl}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: provider.model,
                response_format: { type: 'json_schema', json_schema: schema },
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
            }),
            signal: controller.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorBody = await response.text();
            return {
                success: false,
                error: `HTTP ${response.status}: ${errorBody}`,
                status: response.status,
            };
        }

        const payload = (await response.json()) as {
            choices?: Array<{ message?: { content?: string } }>;
        };

        const rawContent = payload.choices?.[0]?.message?.content;
        if (!rawContent) {
            return { success: false, error: 'Empty response from LLM', raw: payload };
        }

        const parsed = JSON.parse(rawContent) as Record<string, unknown>;

        // Check for error field in response
        if (typeof parsed.error === 'string' && parsed.error.length > 0) {
            return { success: false, error: parsed.error, raw: parsed };
        }

        return { success: true, content: parsed, raw: parsed };
    } catch (err) {
        clearTimeout(timeoutId);

        if ((err as Error).name === 'AbortError') {
            return { success: false, error: `Request timeout (${timeout}ms)` };
        }

        return { success: false, error: (err as Error).message };
    }
}

// ============================================================
// Main Entry Point
// ============================================================

/**
 * Call a structured LLM with provider fallback chain.
 * 
 * Tries providers in order (OpenRouter → OpenAI) with retry on rate limits.
 * Respects per-purpose concurrency limits.
 * 
 * @example
 * ```typescript
 * const result = await callStructuredLlm({
 *   schema: MY_JSON_SCHEMA,
 *   systemPrompt: 'You are a nutrition assistant...',
 *   userPrompt: 'Normalize: 2 cups chopped onions',
 *   purpose: 'normalize',
 * });
 * 
 * if (result.status === 'success') {
 *   console.log(result.content); // Parsed JSON object
 *   console.log(`Used ${result.provider}/${result.model}`);
 * }
 * ```
 */
export async function callStructuredLlm(
    options: StructuredLlmOptions
): Promise<StructuredLlmResult> {
    const { schema, systemPrompt, userPrompt, purpose, timeout = STRUCTURED_LLM_TIMEOUT_MS } = options;
    const limiter = limiters[purpose];
    const startTime = Date.now();

    return limiter.run(async () => {
        const providerChain = getProviderChain();

        if (providerChain.length === 0) {
            return {
                status: 'error',
                error: 'No API keys configured (need OPENROUTER_API_KEY or OPENAI_API_KEY)',
                provider: 'openai',
                model: 'none',
                durationMs: Date.now() - startTime,
            };
        }

        let lastError: string | undefined;
        let lastProvider: ProviderConfig = providerChain[0];

        for (const provider of providerChain) {
            lastProvider = provider;

            for (let attempt = 0; attempt < STRUCTURED_LLM_MAX_RETRIES; attempt++) {
                const result = await makeRequest(provider, schema, systemPrompt, userPrompt, timeout);

                if (result.success) {
                    const durationMs = Date.now() - startTime;

                    // Log successful call for metrics
                    console.log(
                        `[structured-llm] ${purpose} call successful: provider=${provider.name}, model=${provider.model}, duration=${durationMs}ms`
                    );

                    // Increment session metrics
                    incrementAiCall(purpose);

                    return {
                        status: 'success',
                        content: result.content,
                        provider: provider.name,
                        model: provider.model,
                        raw: result.raw,
                        durationMs,
                    };
                }

                lastError = result.error;

                // If retryable error, backoff and retry with same provider
                if (result.status && isRetryableError(result.status) && attempt < STRUCTURED_LLM_MAX_RETRIES - 1) {
                    const delay = getBackoffDelay(attempt);
                    console.warn(
                        `[structured-llm] Retryable error (${result.status}) from ${provider.name}/${provider.model}, ` +
                        `retrying in ${delay}ms (attempt ${attempt + 1}/${STRUCTURED_LLM_MAX_RETRIES})`
                    );
                    await sleep(delay);
                    continue;
                }

                // Non-retryable error or max retries reached - try next provider
                console.warn(
                    `[structured-llm] ${provider.name}/${provider.model} failed: ${result.error}`
                );
                break;
            }
        }

        // All providers failed
        const durationMs = Date.now() - startTime;
        console.error(
            `[structured-llm] All providers failed for ${purpose} call. Last error: ${lastError}`
        );

        return {
            status: 'error',
            error: lastError ?? 'All providers failed',
            provider: lastProvider.name,
            model: lastProvider.model,
            durationMs,
        };
    });
}

// ============================================================
// Utility Exports
// ============================================================

/**
 * Check if OpenRouter is configured (for conditional logic)
 */
export function isOpenRouterConfigured(): boolean {
    return !!OPENROUTER_API_KEY;
}

/**
 * Get current concurrency limit for a purpose
 */
export function getConcurrencyLimit(purpose: StructuredLlmPurpose): number {
    return CONCURRENCY_LIMITS[purpose];
}

/**
 * Get pending count for a purpose limiter
 */
export function getPendingCount(purpose: StructuredLlmPurpose): number {
    return limiters[purpose].pendingCount;
}

/**
 * Get active count for a purpose limiter
 */
export function getActiveCount(purpose: StructuredLlmPurpose): number {
    return limiters[purpose].activeCount;
}

// ============================================================
// AI Call Metrics Tracking (Step 9: Cost Metrics)
// ============================================================

export interface AiCallMetrics {
    /** Count of normalize calls made */
    normalize: number;
    /** Count of serving estimation calls */
    serving: number;
    /** Count of ambiguous unit estimation calls */
    ambiguous: number;
    /** Count of produce size estimation calls */
    produce: number;
    /** Total LLM calls made */
    total: number;
    /** Count of LLM calls skipped by normalize gate */
    skippedByGate: number;
    /** Count of early cache hits (no pipeline run) */
    cacheHits: number;
}

// Session metrics - accumulated during a batch run
let sessionMetrics: AiCallMetrics = {
    normalize: 0,
    serving: 0,
    ambiguous: 0,
    produce: 0,
    total: 0,
    skippedByGate: 0,
    cacheHits: 0,
};

/**
 * Get current AI call metrics for the session
 */
export function getAiCallMetrics(): AiCallMetrics {
    return { ...sessionMetrics };
}

/**
 * Reset AI call metrics for a new session
 */
export function resetAiCallMetrics(): void {
    sessionMetrics = {
        normalize: 0,
        serving: 0,
        ambiguous: 0,
        produce: 0,
        total: 0,
        skippedByGate: 0,
        cacheHits: 0,
    };
}

/**
 * Increment the call counter for a specific purpose
 * Called automatically by callStructuredLlm on success
 */
export function incrementAiCall(purpose: StructuredLlmPurpose): void {
    sessionMetrics[purpose]++;
    sessionMetrics.total++;
}

/**
 * Record that an LLM call was skipped by the normalize gate
 */
export function incrementSkippedByGate(): void {
    sessionMetrics.skippedByGate++;
}

/**
 * Record a cache hit (no pipeline run needed)
 */
export function incrementCacheHit(): void {
    sessionMetrics.cacheHits++;
}

/**
 * Get a summary string for logging
 */
export function getAiCallSummary(): string {
    const m = sessionMetrics;
    const totalIngredients = m.total + m.skippedByGate + m.cacheHits;
    const skipRate = totalIngredients > 0
        ? ((m.skippedByGate + m.cacheHits) / totalIngredients * 100).toFixed(1)
        : 0;

    return [
        `AI Call Summary:`,
        `  Total Ingredients: ${totalIngredients}`,
        `  Cache Hits: ${m.cacheHits}`,
        `  Gate Skipped: ${m.skippedByGate}`,
        `  LLM Calls: ${m.total}`,
        `    - Normalize: ${m.normalize}`,
        `    - Serving: ${m.serving}`,
        `    - Ambiguous: ${m.ambiguous}`,
        `    - Produce: ${m.produce}`,
        `  Skip Rate: ${skipRate}%`,
    ].join('\n');
}
