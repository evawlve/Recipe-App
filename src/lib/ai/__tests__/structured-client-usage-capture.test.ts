/**
 * The counter is wired at the HTTP chokepoint, not at the logical-success branch.
 *
 * WHY THAT DISTINCTION IS THE WHOLE TEST: `makeRequest()` returns `success:false` for FOUR
 * separate shapes of billed 2xx — an envelope that fails `response.json()`, an empty `choices`
 * array, an `error` field inside the model's own JSON, and content that fails `JSON.parse`. ALL
 * FOUR WERE BILLED. A counter in `callStructuredLlm()`'s `if (result.success)` branch would miss
 * every one of them and rebuild exactly the structural undercount this item exists to close. The
 * "empty choices" and "model said error" cases below are the ones that die if the counter is moved.
 *
 * The fourth shape is here because the first cut of this branch got it wrong in the other
 * direction: `response.json()` threw into the outer catch, so a billed call was recorded ONLY as a
 * failure and `responses` was a LOWER BOUND while its docstring read as an exact count. Two tests
 * below pin the repair — the invariant is that exactly one outcome is counted per HTTP attempt, so
 * `responses + failures === attempts`.
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

/** A 2xx whose body is not JSON at all — a proxy error page, a truncated stream. Still billed. */
function unparseableEnvelope(): Response {
    return {
        ok: true,
        status: 200,
        json: async () => {
            throw new SyntaxError('Unexpected token < in JSON at position 0');
        },
        text: async () => '<html>502</html>',
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

    it('a 200 whose envelope will not parse is still counted as a billed response', async () => {
        // MUTATION TARGET, and the reason `responses` is EXACT rather than a lower bound. Restore
        // the un-guarded `const payload = (await response.json())` and this dies: the throw goes
        // to makeRequest()'s catch, so a call the provider charged for reads failures=1,
        // responses=0. That is the same shape as SERVING_AI_TIERS being quoted as a count.
        fetchMock.mockResolvedValue(unparseableEnvelope());

        const result = await callStructuredLlm(CALL);
        expect(result.status).toBe('error');

        const snap = getLlmUsageSnapshot();
        expect(snap.byPurpose.normalize.responses).toBe(1);
        expect(snap.byPurpose.normalize.failures).toBe(0);
        expect(snap.byPurpose.normalize.logicalSuccesses).toBe(0);
        // Billed, but there is no usage block to read — a different statement from "the provider
        // omitted usage", which is why it gets its own field rather than vanishing into
        // usageReported's shortfall.
        expect(snap.byPurpose.normalize.unparseableEnvelopes).toBe(1);
        expect(snap.byPurpose.normalize.usageReported).toBe(0);
        expect(snap.byPurpose.normalize.totalTokens).toBe(0);
    });

    it('a 200 whose body is the JSON literal null is a clean parse, NOT an unparseable envelope', async () => {
        // MUTATION TARGET for the discriminator in makeRequest(). `response.json()` returns null
        // here and throws nothing, so `payload === null` and `envelopeError === null` — the two
        // predicates disagree, and only `envelopeError` means "the envelope would not parse".
        // Restore `countResponse(payload?.usage, payload === null)` and this dies twice over:
        // unparseableEnvelopes reads 1 for a body that parsed fine, and the caller's error string
        // interpolates `envelopeError?.message` on a null error, emitting a literal "undefined".
        // A null body is a billed, parsed response with no content — the Empty-response guard owns
        // it, which is what keeps unparseableEnvelopes honest as the subtrahend for spend.
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => null,
            text: async () => 'null',
        } as unknown as Response);

        const result = await callStructuredLlm(CALL);
        expect(result.status).toBe('error');
        expect(result.error).toContain('Empty response');
        expect(result.error).not.toContain('undefined');

        const snap = getLlmUsageSnapshot();
        expect(snap.byPurpose.normalize.responses).toBe(1);
        expect(snap.byPurpose.normalize.failures).toBe(0);
        expect(snap.byPurpose.normalize.unparseableEnvelopes).toBe(0);
    });

    it('an abort DURING the body read is a billed response to the counter and a timeout to the caller', async () => {
        // The two views differ on purpose and both must hold: the provider produced a 2xx and
        // billed for it, but the caller's error string is what the retry/fallback logs read, so it
        // must stay the timeout text this path produced before the envelope guard existed.
        const abort = new Error('aborted');
        abort.name = 'AbortError';
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => {
                throw abort;
            },
            text: async () => '',
        } as unknown as Response);

        const result = await callStructuredLlm(CALL);
        expect(result.status).toBe('error');
        expect(result.error).toContain('Request timeout');

        const snap = getLlmUsageSnapshot();
        expect(snap.byPurpose.normalize.responses).toBe(1);
        expect(snap.byPurpose.normalize.unparseableEnvelopes).toBe(1);
        expect(snap.byPurpose.normalize.failures).toBe(0);
    });

    it('a 200 whose CONTENT will not parse counts one response and NOT also a failure', async () => {
        // MUTATION TARGET for the `outcomeCounted` guard in makeRequest(). `JSON.parse(rawContent)`
        // throws into the outer catch; without the guard that attempt increments both `responses`
        // and `failures`, and the two stop summing to attempts. One HTTP attempt, one outcome.
        fetchMock.mockResolvedValue(
            okBody({ choices: [{ message: { content: 'not json at all' } }], usage: REAL_USAGE })
        );

        const result = await callStructuredLlm(CALL);
        expect(result.status).toBe('error');

        const snap = getLlmUsageSnapshot();
        expect(snap.byPurpose.normalize.responses).toBe(1);
        expect(snap.byPurpose.normalize.failures).toBe(0);
        expect(snap.byPurpose.normalize.unparseableEnvelopes).toBe(0);
        expect(fetchMock).toHaveBeenCalledTimes(1);
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
