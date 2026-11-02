/**
 * The Anthropic Messages leg at the head of the structured LLM chain (s432).
 *
 * The leg is DORMANT while ANTHROPIC_API_KEY is empty: chains are byte-identical to the
 * OpenRouter -> OpenAI ones. These tests pin the chain shape, the wire the leg sends, the
 * counters it feeds (through the SAME countResponse()/countFailure() closures as the OpenAI-shaped
 * path), and the fall-through to the next leg.
 *
 * HOW THIS FILE GETS A CHAIN: `jest.setup.no-llm.js` blanks every credential, so this file assigns
 * FAKE keys, then `require()`s the modules inside `jest.isolateModules` (an ES import would hoist
 * above the assignment) and restores the keys right after. `global.fetch` is replaced with a mock
 * for every test and the base URLs stay on the gate's blackhole, so nothing can leave the process.
 * ANTHROPIC_API_BASE_URL is never assigned here: the blackhole is `.../jest-no-llm-gate`, so the
 * Anthropic URL under test is `.../jest-no-llm-gate/messages`.
 */

type Client = typeof import('../structured-client');
type Usage = typeof import('../llm-usage-metrics');

const BLACKHOLE = 'http://127.0.0.1:1/jest-no-llm-gate';

function loadWith(keys: { anthropic: string; openrouter: string; purposes?: string | null }): {
    sc: Client;
    usage: Usage;
    maxRetries: number;
} {
    const priorA = process.env.ANTHROPIC_API_KEY;
    const priorO = process.env.OPENROUTER_API_KEY;
    const priorP = process.env.ANTHROPIC_PURPOSES;
    process.env.ANTHROPIC_API_KEY = keys.anthropic;
    if (keys.purposes === null) delete process.env.ANTHROPIC_PURPOSES;
    else process.env.ANTHROPIC_PURPOSES = keys.purposes ?? '';
    process.env.OPENROUTER_API_KEY = keys.openrouter;
    let out!: { sc: Client; usage: Usage; maxRetries: number };
    try {
        jest.isolateModules(() => {
            out = {
                sc: require('../structured-client') as Client,
                usage: require('../llm-usage-metrics') as Usage,
                maxRetries: (require('../../mapping/config') as typeof import('../../mapping/config'))
                    .STRUCTURED_LLM_MAX_RETRIES,
            };
        });
    } finally {
        process.env.ANTHROPIC_API_KEY = priorA ?? '';
        process.env.OPENROUTER_API_KEY = priorO ?? '';
        if (priorP === undefined) delete process.env.ANTHROPIC_PURPOSES;
        else process.env.ANTHROPIC_PURPOSES = priorP;
    }
    return out;
}

const armed = loadWith({ anthropic: 'sk-ant-jest-fake', openrouter: 'jest-fake-key-never-dialled', purposes: '' });
const dormant = loadWith({ anthropic: '', openrouter: 'jest-fake-key-never-dialled', purposes: '' });

const INNER_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    properties: { a: { type: 'number' } },
    required: ['a'],
};
const WRAPPER = { name: 'test', schema: INNER_SCHEMA, strict: true };

const CALL = {
    schema: WRAPPER,
    systemPrompt: 'system text',
    userPrompt: 'user text',
    purpose: 'ambiguous' as const,
    timeout: 5000,
};

function json(status: number, body: unknown): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    } as unknown as Response;
}

function anthropicOk(extra: Record<string, unknown> = {}): Response {
    return json(200, {
        content: [
            { type: 'thinking', thinking: '' },
            { type: 'text', text: '{"a":1}' },
        ],
        stop_reason: 'end_turn',
        usage: { input_tokens: 40, output_tokens: 7 },
        ...extra,
    });
}

function openrouterOk(): Response {
    return json(200, {
        choices: [{ message: { content: '{"a":2}' } }],
        usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
    });
}

let fetchMock: jest.Mock;
const realFetch = global.fetch;

beforeEach(() => {
    armed.usage.resetLlmUsageMetrics();
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
    jest.restoreAllMocks();
});

afterAll(() => {
    global.fetch = realFetch;
});

describe('(a) chain shape', () => {
    it('with the key set, anthropic heads every cheap purpose and the rest is today\'s chain', () => {
        const withLeg = armed.sc.getProviderChain('ambiguous');
        expect(withLeg[0]).toMatchObject({ name: 'anthropic', model: 'claude-haiku-5-5' });
        expect(withLeg.slice(1)).toEqual(dormant.sc.getProviderChain('ambiguous'));
        expect(withLeg.slice(1).map((p) => p.name)).toEqual(['openrouter', 'openrouter']);
    });

    it('nutrition and cache_validate chains carry NO anthropic entry', () => {
        for (const purpose of ['nutrition', 'cache_validate'] as const) {
            expect(armed.sc.getProviderChain(purpose).map((p) => p.name)).not.toContain('anthropic');
            expect(armed.sc.getProviderChain(purpose)).toEqual(dormant.sc.getProviderChain(purpose));
        }
    });

    it('with the key empty, no purpose has an anthropic entry (dormant)', () => {
        for (const purpose of ['normalize', 'serving', 'ambiguous', 'produce', 'parse', 'simplify', 'nutrition', 'cache_validate'] as const) {
            expect(dormant.sc.getProviderChain(purpose).map((p) => p.name)).not.toContain('anthropic');
        }
        // A forced anthropic with an empty key falls through to purpose routing, like the other forces.
        expect(dormant.sc.getProviderChain('ambiguous', 'anthropic')).toEqual(dormant.sc.getProviderChain('ambiguous'));
    });
});

describe('(a2) ANTHROPIC_PURPOSES allowlist', () => {
    const CHEAP = ['normalize', 'serving', 'ambiguous', 'produce', 'parse', 'simplify'] as const;
    const names = (c: { getProviderChain: Client['getProviderChain'] }, p: (typeof CHEAP)[number]) =>
        c.getProviderChain(p).map((x) => x.name);

    it('a listed set heads only those purposes; the rest and the capable tier stay on today\'s chains', () => {
        const listed = loadWith({
            anthropic: 'sk-ant-jest-fake',
            openrouter: 'jest-fake-key-never-dialled',
            purposes: 'normalize,serving,parse,nutrition,cache_validate',
        });
        expect(listed.sc.getProviderChain('normalize')[0]).toMatchObject({ name: 'anthropic' });
        expect(listed.sc.getProviderChain('parse')[0]).toMatchObject({ name: 'anthropic' });
        expect(names(listed.sc, 'ambiguous')).not.toContain('anthropic');
        expect(listed.sc.getProviderChain('ambiguous')).toEqual(dormant.sc.getProviderChain('ambiguous'));
        for (const purpose of ['nutrition', 'cache_validate'] as const) {
            expect(listed.sc.getProviderChain(purpose)).toEqual(dormant.sc.getProviderChain(purpose));
        }
    });

    it('entries are trimmed, so spaces around names still match', () => {
        const spaced = loadWith({
            anthropic: 'sk-ant-jest-fake',
            openrouter: 'jest-fake-key-never-dialled',
            purposes: ' ambiguous , parse ',
        });
        expect(spaced.sc.getProviderChain('ambiguous')[0]).toMatchObject({ name: 'anthropic' });
        expect(names(spaced.sc, 'normalize')).not.toContain('anthropic');
    });

    it('empty and unset both mean every cheap purpose heads with anthropic', () => {
        for (const purposes of ['', null]) {
            const all = loadWith({ anthropic: 'sk-ant-jest-fake', openrouter: 'jest-fake-key-never-dialled', purposes });
            for (const purpose of CHEAP) {
                expect(all.sc.getProviderChain(purpose)[0]).toMatchObject({ name: 'anthropic' });
            }
        }
    });
});

describe('(b) request shape', () => {
    it('posts the Messages wire to ${ANTHROPIC_API_BASE_URL}/messages with the schema unwrapped', async () => {
        fetchMock.mockResolvedValue(anthropicOk());
        const r = await armed.sc.callStructuredLlm({ ...CALL, forceProvider: 'anthropic' });
        expect(r.status).toBe('success');

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toBe(`${BLACKHOLE}/messages`);
        const headers = init.headers as Record<string, string>;
        expect(headers['x-api-key']).toBe('sk-ant-jest-fake');
        expect(headers['anthropic-version']).toBe('2026-10-21');
        expect(headers.Authorization).toBeUndefined();

        const body = JSON.parse(init.body as string);
        expect(body.model).toBe('claude-haiku-5-5');
        expect(body.system).toBe('system text');
        expect(body.messages).toEqual([{ role: 'user', content: 'user text' }]);
        expect(body.output_config.format).toEqual({ type: 'json_schema', schema: INNER_SCHEMA });
        expect(body.output_config.format.name).toBeUndefined();
        expect(body.output_config.format.strict).toBeUndefined();
        expect(body).not.toHaveProperty('temperature');
        expect(body).not.toHaveProperty('top_p');
        expect(body).not.toHaveProperty('top_k');
        expect(body).not.toHaveProperty('response_format');
    });

    it('max_tokens is a floor of 2048, never a cap below it', async () => {
        fetchMock.mockResolvedValue(anthropicOk());
        await armed.sc.callStructuredLlm({ ...CALL, forceProvider: 'anthropic', maxTokens: 600 });
        await armed.sc.callStructuredLlm({ ...CALL, forceProvider: 'anthropic', maxTokens: 4000 });
        const sent = fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string).max_tokens);
        expect(sent).toEqual([2048, 4000]);
    });
});

describe('(c) envelope and counters', () => {
    it('takes the first text block after a thinking block and counts one response with token usage', async () => {
        fetchMock.mockResolvedValue(anthropicOk());
        const r = await armed.sc.callStructuredLlm({ ...CALL, forceProvider: 'anthropic' });
        expect(r.status).toBe('success');
        if (r.status !== 'success') return;
        expect((r.content as { a: number }).a).toBe(1);
        expect(r.provider).toBe('anthropic');

        const snap = armed.usage.getLlmUsageSnapshot();
        expect(snap.byPurpose.ambiguous.responses).toBe(1);
        expect(snap.byPurpose.ambiguous.logicalSuccesses).toBe(1);
        expect(snap.byPurpose.ambiguous.promptTokens).toBe(40);
        expect(snap.byPurpose.ambiguous.completionTokens).toBe(7);
        expect(snap.byPurpose.ambiguous.totalTokens).toBe(47);
        expect(snap.byPurpose.ambiguous.costReported).toBe(0);
        expect(snap.byModel['claude-haiku-5-5']).toMatchObject({ responses: 1, totalTokens: 47 });
    });

    it('an unparseable 2xx envelope is a billed response, not a failure', async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            status: 200,
            json: async () => {
                throw new SyntaxError('Unexpected token <');
            },
            text: async () => '<html>',
        } as unknown as Response);
        const r = await armed.sc.callStructuredLlm({ ...CALL, forceProvider: 'anthropic' });
        expect(r.status).toBe('error');
        const snap = armed.usage.getLlmUsageSnapshot();
        expect(snap.byPurpose.ambiguous.responses).toBe(1);
        expect(snap.byPurpose.ambiguous.unparseableEnvelopes).toBe(1);
        expect(snap.byPurpose.ambiguous.failures).toBe(0);
    });
});

describe('(d) stop_reason refusal falls to the next leg', () => {
    it('is counted as a billed response, then OpenRouter answers', async () => {
        fetchMock.mockImplementation(async (url: string) =>
            url.endsWith('/messages') ? anthropicOk({ stop_reason: 'refusal' }) : openrouterOk()
        );
        const r = await armed.sc.callStructuredLlm(CALL);
        expect(r.status).toBe('success');
        if (r.status !== 'success') return;
        expect(r.provider).toBe('openrouter');
        expect((r.content as { a: number }).a).toBe(2);
        expect(fetchMock).toHaveBeenCalledTimes(2);
        const snap = armed.usage.getLlmUsageSnapshot();
        expect(snap.byModel['claude-haiku-5-5'].responses).toBe(1);
        expect(snap.byPurpose.ambiguous.logicalSuccesses).toBe(1);
    });
});

describe('(e) HTTP errors', () => {
    it('400 "credit balance is too low" is not retried and falls to the next leg', async () => {
        fetchMock.mockImplementation(async (url: string) =>
            url.endsWith('/messages')
                ? json(400, 'credit balance is too low')
                : openrouterOk()
        );
        const r = await armed.sc.callStructuredLlm(CALL);
        expect(r.status).toBe('success');
        if (r.status !== 'success') return;
        expect(r.provider).toBe('openrouter');
        const urls = fetchMock.mock.calls.map((c) => c[0] as string);
        expect(urls.filter((u) => u.endsWith('/messages'))).toHaveLength(1);
        expect(armed.usage.getLlmUsageSnapshot().byModel['claude-haiku-5-5'].failures).toBe(1);
    });

    describe('429', () => {
        beforeEach(() => {
            jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask'] });
        });
        afterEach(() => {
            jest.useRealTimers();
        });

        it('is retried MAX_RETRIES times on anthropic, then the openrouter call', async () => {
            fetchMock.mockImplementation(async (url: string) =>
                url.endsWith('/messages') ? json(429, 'rate limited') : openrouterOk()
            );
            const pending = armed.sc.callStructuredLlm(CALL);
            await jest.advanceTimersByTimeAsync(60_000);
            const r = await pending;
            expect(r.status).toBe('success');
            if (r.status !== 'success') return;
            expect(r.provider).toBe('openrouter');
            const urls = fetchMock.mock.calls.map((c) => c[0] as string);
            expect(urls.filter((u) => u.endsWith('/messages'))).toHaveLength(armed.maxRetries);
            expect(urls.filter((u) => !u.endsWith('/messages'))).toHaveLength(1);
        });
    });
});
