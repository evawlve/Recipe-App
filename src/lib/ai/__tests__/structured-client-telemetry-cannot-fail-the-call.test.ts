/**
 * THE INSTRUMENT MUST NOT BE ABLE TO DEGRADE THE THING IT MEASURES.
 *
 * This repo's recurring instrument defect is fail-OPEN: an instrument reads 0 and the 0 is quoted
 * as a measurement (12+ recorded incidents). This file guards the INVERSION of it, which the
 * adversarial review of Phase 0.5(c) caught in the first cut: all three usage counters were called
 * from inside code paths owned by the request's own error handling, so a throw from telemetry
 * would have
 *   - in `makeRequest()`: landed in the `catch` that wraps the fetch, turning an ALREADY BILLED,
 *     perfectly good LLM answer into `{ success:false }` — and then into a retry that bills again;
 *   - in `callStructuredLlm()`: rejected the promise the caller is awaiting outright, because
 *     nothing catches around the success branch.
 * The counter would have been causing outages in the pipeline it exists to observe.
 *
 * WHAT IS BEING PROVED: with every counter throwing, `callStructuredLlm()` still returns the
 * model's answer, and the error text it reports on a genuine failure is still the REQUEST's error
 * and never the counter's. The fix under test is `countSafely()` in `structured-client.ts`.
 *
 * MUTATION TRANSCRIPT (2026-08-04): replacing `countSafely()`'s body with a bare `record()` call
 * kills ALL FOUR tests below — `Tests: 4 failed, 4 total`. The third one was expected to survive
 * (a `recordLlmFailure` throw looked like it would be swallowed by the very `catch` it fires
 * from); it does not, because a throw raised INSIDE a catch block propagates out of the function,
 * so that path does not degrade the answer — it rejects the caller's promise outright, which is
 * strictly worse. Written down because it is the one thing here that reading the code got wrong.
 *
 * HOW THIS FILE GETS A PROVIDER CHAIN: `jest.setup.no-llm.js` (setupFiles) blanks every provider
 * credential, so `getProviderChain()` returns [] and `makeRequest()` is never reached. This file
 * therefore assigns a FAKE key before `require()`ing the client — the credential is captured into
 * a module-scope const at import time, so the assignment must precede the require, which is why
 * there are no ES `import` statements below. `global.fetch` is mocked for every test and the
 * gate's blackhole base URLs are left in place, so nothing can leave the process.
 */

process.env.OPENAI_API_KEY = 'jest-fake-key-never-dialled';

// The counters are replaced wholesale: this file is not testing what they record, it is testing
// that what they do cannot reach the caller. Default implementations are no-ops so each test can
// arm exactly one of them and attribute the outcome.
jest.mock('../llm-usage-metrics', () => ({
    recordLlmResponse: jest.fn(),
    recordLlmFailure: jest.fn(),
    recordLlmLogicalSuccess: jest.fn(),
}));

const { callStructuredLlm } =
    require('../structured-client') as typeof import('../structured-client');
const metrics = require('../llm-usage-metrics') as {
    recordLlmResponse: jest.Mock;
    recordLlmFailure: jest.Mock;
    recordLlmLogicalSuccess: jest.Mock;
};

const COUNTER_BOOM = 'counter exploded — this must never reach the caller';

function explode(): never {
    throw new Error(COUNTER_BOOM);
}

/** A well-formed provider success carrying content the caller is entitled to receive. */
function goodResponse(): Response {
    return {
        ok: true,
        status: 200,
        json: async () => ({
            choices: [{ message: { content: JSON.stringify({ canonicalBase: 'chicken' }) } }],
            usage: { prompt_tokens: 41, completion_tokens: 6, total_tokens: 47 },
        }),
        text: async () => '',
    } as unknown as Response;
}

const CALL = {
    schema: { name: 'test', schema: { type: 'object' } },
    systemPrompt: 'system',
    userPrompt: 'user',
    purpose: 'normalize' as const,
    // One-entry provider chain: without it a retry/fallback could mask a rejection as "some other
    // provider answered".
    forceProvider: 'openai' as const,
    timeout: 5000,
};

let fetchMock: jest.Mock;
const realFetch = global.fetch;

beforeEach(() => {
    metrics.recordLlmResponse.mockReset();
    metrics.recordLlmFailure.mockReset();
    metrics.recordLlmLogicalSuccess.mockReset();
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
    global.fetch = realFetch;
});

describe('a throwing usage counter cannot change the outcome of the call it measures', () => {
    it('still returns the model answer when recordLlmResponse throws', async () => {
        // MUTATION TARGET for countSafely(). Un-guarded, this throw lands in makeRequest()'s catch
        // and a billed, usable answer is reported as an error.
        metrics.recordLlmResponse.mockImplementation(explode);
        fetchMock.mockResolvedValue(goodResponse());

        const result = await callStructuredLlm(CALL);

        expect(result.status).toBe('success');
        expect(result.content).toEqual({ canonicalBase: 'chicken' });
        expect(metrics.recordLlmResponse).toHaveBeenCalledTimes(1);
        // One fetch: the swallowed throw must not have provoked a retry, which would bill twice.
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('still returns the model answer when the logical-success counter throws', async () => {
        // MUTATION TARGET for countSafely(). This one is the worse half: the call site in
        // callStructuredLlm() has NO surrounding catch, so un-guarded this rejects the caller's
        // promise instead of merely mis-reporting it.
        metrics.recordLlmLogicalSuccess.mockImplementation(explode);
        fetchMock.mockResolvedValue(goodResponse());

        const result = await callStructuredLlm(CALL);

        expect(result.status).toBe('success');
        expect(result.content).toEqual({ canonicalBase: 'chicken' });
        expect(metrics.recordLlmLogicalSuccess).toHaveBeenCalledTimes(1);
    });

    it('reports the REQUEST error, not the counter error, when recordLlmFailure throws', async () => {
        // MUTATION TARGET for countSafely(). This one is thrown from inside makeRequest()'s own
        // catch block, so it is NOT swallowed there — it propagates out of makeRequest() and
        // rejects the promise callStructuredLlm()'s caller is awaiting. The `await` below throws
        // instead of returning, which is why this test dies with the guard removed.
        metrics.recordLlmFailure.mockImplementation(explode);
        fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

        const result = await callStructuredLlm(CALL);

        expect(result.status).toBe('error');
        // The caller must be told what actually went wrong with the request.
        expect(result.error).toContain('ECONNREFUSED');
        expect(result.error).not.toContain(COUNTER_BOOM);
    });

    it('still returns the model answer when all three counters throw', async () => {
        metrics.recordLlmResponse.mockImplementation(explode);
        metrics.recordLlmFailure.mockImplementation(explode);
        metrics.recordLlmLogicalSuccess.mockImplementation(explode);
        fetchMock.mockResolvedValue(goodResponse());

        const result = await callStructuredLlm(CALL);

        expect(result.status).toBe('success');
        expect(result.content).toEqual({ canonicalBase: 'chicken' });
    });
});
