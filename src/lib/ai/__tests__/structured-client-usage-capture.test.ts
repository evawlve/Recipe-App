/**
 * The counter is wired at the HTTP chokepoint, not at the logical-success branch.
 *
 * WHY THAT DISTINCTION IS THE WHOLE TEST: `makeRequest()` returns `success:false` for three
 * separate shapes of HTTP 200 — an empty `choices` array, an `error` field inside the model's own
 * JSON, and content that fails `JSON.parse`. ALL THREE WERE BILLED. A counter in
 * `callStructuredLlm()`'s `if (result.success)` branch would miss every one of them and rebuild
 * exactly the structural undercount this item exists to close. The "empty choices" and "model said
 * error" cases below are the ones that die if the counter is moved.
 *
 * HOW THIS FILE GETS A PROVIDER CHAIN WITHOUT AN ENV BYPASS
 * `jest.setup.no-llm.js` (setupFiles, runs before this file loads) blanks every provider
 * credential, so `getProviderChain()` returns [] and `callStructuredLlm()` would short-circuit
 * before `makeRequest()` is ever reached. This file therefore assigns a FAKE key into
 * `process.env` and then `require()`s the modules — the credentials are captured into module-scope
 * consts at import time, so the assignment has to precede the require, which is why there is not a
 * single ES `import` statement below (TypeScript hoists those above plain statements).
 *
 * That is safe and is NOT a hole in the gate: `global.fetch` is replaced with a mock for every test
 * here, and the base URLs are left pointed at the gate's blackhole (127.0.0.1:1). No request can
 * leave the process. Deliberately NOT done: adding a `JEST_ALLOW_LIVE_LLM`-style bypass to `src/`.
 * `setupFiles` re-runs per test file, so these assignments cannot leak into another suite.
 *
 * Every case uses `forceProvider: 'openai'`, which yields a ONE-entry provider chain. Without it a
 * chain of two OpenRouter entries would make a "one failure" assertion read 2, and the test would
 * be measuring the fallback chain rather than the counter.
 */

process.env.OPENAI_API_KEY = 'jest-fake-key-never-dialled';

const { callStructuredLlm } =
    require('../structured-client') as typeof import('../structured-client');
const { getLlmUsageSnapshot, resetLlmUsageMetrics } =
    require('../llm-usage-metrics') as typeof import('../llm-usage-metrics');
const { FATSECRET_CACHE_AI_MODEL } =
    require('../../mapping/config') as typeof import('../../mapping/config');

/** The model `forceProvider: 'openai'` resolves to — what `byModel` must be keyed by. */
const MODEL = FATSECRET_CACHE_AI_MODEL;

const REAL_USAGE = { prompt_tokens: 41, completion_tokens: 6, total_tokens: 47, cost: 9.6525e-6 };

function okBody(body: unknown): Response {
    return {
        ok: true,
        status: 200,
        json: async () => body,
        text: async () => JSON.stringify(body),
    } as unknown as Response;
}

function errBody(status: number): Response {
    return {
        ok: false,
        status,
        json: async () => ({}),
        text: async () => `rate limited`,
    } as unknown as Response;
}

/** A well-formed OpenRouter success: usage block plus JSON content the caller can use. */
function goodResponse(): Response {
    return okBody({
        choices: [{ message: { content: JSON.stringify({ canonicalBase: 'chicken' }) } }],
        usage: REAL_USAGE,
    });
}

const CALL = {
    schema: { name: 'test', schema: { type: 'object' } },
    systemPrompt: 'system',
    userPrompt: 'user',
    purpose: 'normalize' as const,
    forceProvider: 'openai' as const,
    timeout: 5000,
};

let fetchMock: jest.Mock;
const realFetch = global.fetch;

beforeEach(() => {
    resetLlmUsageMetrics();
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
    global.fetch = realFetch;
});

describe('structured-client counts LLM egress at the HTTP chokepoint', () => {
    it('a usable 200 counts one response and one logical success, keyed by model', async () => {
        fetchMock.mockResolvedValue(goodResponse());

        const result = await callStructuredLlm(CALL);
        expect(result.status).toBe('success');

        const snap = getLlmUsageSnapshot();
        expect(snap.byPurpose.normalize.responses).toBe(1);
        expect(snap.byPurpose.normalize.logicalSuccesses).toBe(1);
        expect(snap.byPurpose.normalize.usageReported).toBe(1);
        expect(snap.byPurpose.normalize.totalTokens).toBe(47);
        expect(snap.byModel[MODEL]).toMatchObject({
            responses: 1,
            logicalSuccesses: 1,
            totalTokens: 47,
        });
    });

    it('200 with empty choices is counted as a billed response', async () => {
        // MUTATION TARGET. Move recordLlmResponse() into callStructuredLlm()'s success branch and
        // this dies: the provider charged for this call and makeRequest() still returns
        // success:false.
        fetchMock.mockResolvedValue(okBody({ choices: [], usage: REAL_USAGE }));

        const result = await callStructuredLlm(CALL);
        expect(result.status).toBe('error');

        const snap = getLlmUsageSnapshot();
        expect(snap.byPurpose.normalize.responses).toBe(1);
        expect(snap.byPurpose.normalize.logicalSuccesses).toBe(0);
        expect(snap.byPurpose.normalize.usageReported).toBe(1);
        expect(snap.byPurpose.normalize.totalTokens).toBe(47);
    });

    it('200 whose content JSON carries an error field is counted as a billed response', async () => {
        // Real shape: 606 `[structured-llm]` lines on the box, and the model-said-error variants
        // are billed exactly like a usable answer.
        fetchMock.mockResolvedValue(
            okBody({
                choices: [
                    { message: { content: JSON.stringify({ error: 'Ingredient not recognized' }) } },
                ],
                usage: REAL_USAGE,
            })
        );

        const result = await callStructuredLlm(CALL);
        expect(result.status).toBe('error');

        const snap = getLlmUsageSnapshot();
        expect(snap.byPurpose.normalize.responses).toBe(1);
        expect(snap.byPurpose.normalize.logicalSuccesses).toBe(0);
    });

    it('a 429 followed by a 200 is one failure and one billed response', async () => {
        fetchMock.mockResolvedValueOnce(errBody(429)).mockResolvedValueOnce(goodResponse());

        const result = await callStructuredLlm(CALL);
        expect(result.status).toBe('success');

        const snap = getLlmUsageSnapshot();
        // The 429 never produced a body, so it is a failure and not billed. The retry did.
        expect(snap.byPurpose.normalize.failures).toBe(1);
        expect(snap.byPurpose.normalize.responses).toBe(1);
        // Two HTTP attempts, ONE logical call. This is why responses and logicalSuccesses are
        // both exposed: quoting either alone misstates a different question.
        expect(snap.byPurpose.normalize.logicalSuccesses).toBe(1);
    }, 20000);

    it('a network throw counts a failure and no billed response', async () => {
        fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

        const result = await callStructuredLlm(CALL);
        expect(result.status).toBe('error');

        const snap = getLlmUsageSnapshot();
        expect(snap.byPurpose.normalize.failures).toBe(1);
        expect(snap.byPurpose.normalize.responses).toBe(0);
        expect(snap.byPurpose.normalize.logicalSuccesses).toBe(0);
    });

    it('an AbortError counts a failure and no billed response', async () => {
        const abort = new Error('aborted');
        abort.name = 'AbortError';
        fetchMock.mockRejectedValue(abort);

        const result = await callStructuredLlm(CALL);
        expect(result.status).toBe('error');

        const snap = getLlmUsageSnapshot();
        expect(snap.byPurpose.normalize.failures).toBe(1);
        expect(snap.byPurpose.normalize.responses).toBe(0);
    });

    it('counts against the purpose it was called with, leaving the other six at zero', async () => {
        fetchMock.mockResolvedValue(goodResponse());
        await callStructuredLlm({ ...CALL, purpose: 'serving' });

        const snap = getLlmUsageSnapshot();
        expect(snap.byPurpose.serving.responses).toBe(1);
        expect(snap.byPurpose.normalize.responses).toBe(0);
        expect(snap.byPurpose.produce.responses).toBe(0);
    });
});
