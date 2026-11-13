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
 * Every case in the first describe uses `forceProvider: 'openai'`, which yields a ONE-entry provider chain. Without it a
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

/**
 * callStructuredLlm()'s optional `signal` (C70, S239). Once it aborts:
 *   - a call still QUEUED for its purpose's semaphore slot leaves the queue (pending back to 0)
 *     and never fetches;
 *   - an in-flight fetch is aborted through its own signal;
 *   - no retry and no provider fallback starts (the fetch count stays flat);
 *   - the call resolves to { status: 'error', error: STRUCTURED_LLM_ABORTED_ERROR }.
 * Without a signal nothing changes. The last case is deadline-refute §4's measurement (11
 * concurrent aiNormalizeIngredient() calls) and pins MGR's two readings: pending returns to 0,
 * and the fetch count does not grow after expiry.
 *
 * WHY A SEPARATE MODULE REGISTRY. Unlike the cases above, these need the real normalize chain
 * with a FALLBACK in it, so a fallback fetch after an abort is visible: this block also assigns a
 * fake OPENROUTER_API_KEY and re-requires the client inside jest.isolateModules(), giving
 * THREE entries (OpenRouter primary, OpenRouter fallback, OpenAI), no forceProvider, its own
 * semaphores and its own counters. The key is restored as soon as the modules are loaded, the
 * modules above keep the one-entry chain they were loaded with, and global.fetch is still the
 * file's per-test mock with the blackhole base URLs left in place.
 */
describe('callStructuredLlm caller signal (C70 S239)', () => {
    const mockGetCache = jest.fn();
    const mockSaveCache = jest.fn();
    let sc: typeof import('../structured-client');
    let usage: typeof import('../llm-usage-metrics');
    let norm: typeof import('../../mapping/ai-normalize');
    let log: typeof import('../../logger');
    let maxRetries: number;

    beforeAll(() => {
        const prior = process.env.OPENROUTER_API_KEY;
        process.env.OPENROUTER_API_KEY = 'jest-fake-key-never-dialled';
        jest.isolateModules(() => {
            jest.doMock('../../mapping/validated-mapping-helpers', () => ({
                getAiNormalizeCache: (...a: unknown[]) => mockGetCache(...a),
                saveAiNormalizeCache: (...a: unknown[]) => mockSaveCache(...a),
            }));
            sc = require('../structured-client') as typeof import('../structured-client');
            usage = require('../llm-usage-metrics') as typeof import('../llm-usage-metrics');
            norm = require('../../mapping/ai-normalize') as typeof import('../../mapping/ai-normalize');
            log = require('../../logger') as typeof import('../../logger');
            maxRetries = (require('../../mapping/config') as typeof import('../../mapping/config'))
                .STRUCTURED_LLM_MAX_RETRIES;
        });
        process.env.OPENROUTER_API_KEY = prior ?? '';
    });

    const CHAIN_CALL = {
        schema: { name: 'test', schema: { type: 'object' } },
        systemPrompt: 'system',
        userPrompt: 'user',
        purpose: 'normalize' as const,
        timeout: 5000,
    };

    /** A fetch that never answers and rejects with an AbortError once its own signal aborts, as undici does. */
    function hangUntilAborted(_url: unknown, init?: RequestInit): Promise<Response> {
        return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener(
                'abort',
                () => {
                    const e = new Error('This operation was aborted');
                    e.name = 'AbortError';
                    reject(e);
                },
                { once: true },
            );
        });
    }

    /** The signal makeRequest() handed to fetch call `i`. */
    function sentSignal(i: number): AbortSignal | undefined {
        return (fetchMock.mock.calls[i]?.[1] as RequestInit | undefined)?.signal ?? undefined;
    }

    const flush = () => jest.advanceTimersByTimeAsync(0);

    beforeEach(() => {
        jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
        usage.resetLlmUsageMetrics();
        mockGetCache.mockReset().mockResolvedValue(null);
        mockSaveCache.mockReset().mockResolvedValue(undefined);
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
        jest.spyOn(console, 'error').mockImplementation(() => undefined);
        jest.spyOn(log.logger, 'warn').mockImplementation(() => undefined);
    });

    afterEach(async () => {
        // Drain anything a mutated client left running, so one case cannot leak into the next.
        fetchMock.mockImplementation(() => Promise.reject(new Error('drained')));
        await jest.advanceTimersByTimeAsync(10 * 60_000);
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    it('the normalize chain here is three providers and ten slots', () => {
        expect(sc.getProviderChain('normalize').map((p) => p.name)).toEqual(['openrouter', 'openrouter', 'openai']);
        expect(sc.getConcurrencyLimit('normalize')).toBe(10);
        // The backoff case needs a retry to exist (code default 3; jest sets no override).
        expect(maxRetries).toBeGreaterThan(1);
    });

    it('abort while queued: the waiter leaves the queue, pending returns to 0, and it never fetches', async () => {
        fetchMock.mockImplementation(hangUntilAborted);
        const holders = new AbortController();
        const held = Array.from({ length: 10 }, () => sc.callStructuredLlm({ ...CHAIN_CALL, signal: holders.signal }));
        const queued = new AbortController();
        let queuedResult: unknown;
        const q = sc.callStructuredLlm({ ...CHAIN_CALL, signal: queued.signal }).then((r) => { queuedResult = r; return r; });
        await flush();
        expect(sc.getActiveCount('normalize')).toBe(10);
        expect(sc.getPendingCount('normalize')).toBe(1);
        expect(fetchMock).toHaveBeenCalledTimes(10);

        queued.abort();
        await flush();
        expect(sc.getPendingCount('normalize')).toBe(0);
        expect(queuedResult).toMatchObject({ status: 'error', error: sc.STRUCTURED_LLM_ABORTED_ERROR });
        await q;

        holders.abort();
        await flush();
        await Promise.all(held);
        await jest.advanceTimersByTimeAsync(60_000);
        expect(fetchMock).toHaveBeenCalledTimes(10);
        expect(sc.getActiveCount('normalize')).toBe(0);
        expect(sc.getPendingCount('normalize')).toBe(0);
    });

    it('abort in flight: the fetch signal aborts, and no retry or fallback fetch follows', async () => {
        fetchMock.mockImplementation(hangUntilAborted);
        const c = new AbortController();
        let result: unknown;
        const p = sc.callStructuredLlm({ ...CHAIN_CALL, signal: c.signal }).then((r) => { result = r; return r; });
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(sentSignal(0)?.aborted).toBe(false);

        c.abort();
        await flush();
        expect(sentSignal(0)?.aborted).toBe(true);
        expect(result).toMatchObject({ status: 'error', error: sc.STRUCTURED_LLM_ABORTED_ERROR });
        await p;

        await jest.advanceTimersByTimeAsync(60_000);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(sc.getActiveCount('normalize')).toBe(0);
        expect(sc.getPendingCount('normalize')).toBe(0);
        // Not the provider-failed path: neither its warn nor its error line is logged.
        expect(jest.mocked(console.warn)).not.toHaveBeenCalled();
        expect(jest.mocked(console.error)).not.toHaveBeenCalled();
        // One attempt, no 2xx: one `failures`, exactly as a timed-out attempt. No logical success.
        const snap = usage.getLlmUsageSnapshot().byPurpose.normalize;
        expect(snap.failures).toBe(1);
        expect(snap.responses).toBe(0);
        expect(snap.logicalSuccesses).toBe(0);
    });

    it('abort during a retry backoff: it settles at once and no further attempt starts', async () => {
        fetchMock.mockImplementation(async () => errBody(429));
        const c = new AbortController();
        let settled = false;
        const p = sc.callStructuredLlm({ ...CHAIN_CALL, signal: c.signal }).then((r) => { settled = true; return r; });
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);   // 429, now sleeping 1.0-1.5 s before the retry

        c.abort();
        await flush();
        expect(settled).toBe(true);
        expect(jest.getTimerCount()).toBe(0);
        expect(await p).toMatchObject({ status: 'error', error: sc.STRUCTURED_LLM_ABORTED_ERROR });

        await jest.advanceTimersByTimeAsync(60_000);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('a signal already aborted takes no slot and never fetches', async () => {
        const c = new AbortController();
        c.abort();
        const r = await sc.callStructuredLlm({ ...CHAIN_CALL, signal: c.signal });
        expect(r).toMatchObject({ status: 'error', error: sc.STRUCTURED_LLM_ABORTED_ERROR });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(sc.getActiveCount('normalize')).toBe(0);
        expect(sc.getPendingCount('normalize')).toBe(0);
    });

    it('no signal: unchanged, a hung fetch times out per attempt and falls back through all three providers', async () => {
        fetchMock.mockImplementation(hangUntilAborted);
        let result: { status: string; error?: string } | undefined;
        const p = sc.callStructuredLlm(CHAIN_CALL).then((r) => { result = r; return r; });
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(3 * 5000);
        await p;
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(result).toMatchObject({ status: 'error', error: 'Request timeout (5000ms)' });
    });

    it('no signal: a good answer is unchanged', async () => {
        fetchMock.mockResolvedValue(goodResponse());
        const r = await sc.callStructuredLlm(CHAIN_CALL);
        expect(r).toMatchObject({ status: 'success', content: { canonicalBase: 'chicken' } });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(sentSignal(0)?.aborted).toBe(false);
    });

    it('a live signal changes nothing: a 429 still backs off its full delay, a failure still falls back, no listener is left', async () => {
        fetchMock
            .mockResolvedValueOnce(errBody(429))
            .mockResolvedValueOnce(errBody(400))
            .mockResolvedValueOnce(goodResponse());
        const c = new AbortController();
        const p = sc.callStructuredLlm({ ...CHAIN_CALL, signal: c.signal });
        await flush();
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await jest.advanceTimersByTimeAsync(999);
        expect(fetchMock).toHaveBeenCalledTimes(1);   // the first backoff is at least 1000 ms
        await jest.advanceTimersByTimeAsync(600);
        // 429, its retry a 400 (not retryable), then the OpenRouter fallback answers.
        expect(await p).toMatchObject({ status: 'success', provider: 'openrouter' });
        expect(fetchMock).toHaveBeenCalledTimes(3);
        const { getEventListeners } = require('events') as typeof import('events');
        expect(getEventListeners(c.signal, 'abort')).toHaveLength(0);
    });

    it('aiNormalizeIngredient: after expiry pending returns to 0, nothing stays active, and the fetch count does not grow', async () => {
        fetchMock.mockImplementation(hangUntilAborted);
        const lines = Array.from({ length: 11 }, (_, i) => `line ${i}`);
        const all = Promise.all(lines.map((l) => norm.aiNormalizeIngredient(l)));
        await flush();
        expect(sc.getActiveCount('normalize')).toBe(10);
        expect(sc.getPendingCount('normalize')).toBe(1);

        await jest.advanceTimersByTimeAsync(norm.AI_NORMALIZE_DEADLINE_MS);
        const results = await all;
        expect(results.every((r) => r.status === 'error' && r.reason === norm.AI_NORMALIZE_DEADLINE_REASON)).toBe(true);
        await flush();
        expect(sc.getPendingCount('normalize')).toBe(0);
        expect(sc.getActiveCount('normalize')).toBe(0);
        const atExpiry = fetchMock.mock.calls.length;

        await jest.advanceTimersByTimeAsync(120_000);
        expect(fetchMock.mock.calls.length).toBe(atExpiry);
        expect(sc.getPendingCount('normalize')).toBe(0);
        expect(mockSaveCache).not.toHaveBeenCalled();
    });
});
