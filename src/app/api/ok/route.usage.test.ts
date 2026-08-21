/**
 * `/api/ok` is the READ side of the Phase 0.5(c) counters, and its response SHAPE is the contract.
 *
 * The three properties asserted here are the ones that keep a reader honest:
 *  - `ok`/`ts`/`buildId` unconditional, so the deploy-verification curl and the #232 buildId reader
 *    are unchanged whether or not a key is supplied;
 *  - `llm` ALWAYS present, so "old build" (llm absent) and "wrong key" (`authorized:false`) are each
 *    distinguishable from "zero calls";
 *  - no token or cost number leaks into an unauthorized response.
 */

import { NextRequest } from 'next/server';
import { GET } from './route';
import {
    recordLlmResponse,
    resetLlmUsageMetrics,
} from '@/lib/ai/llm-usage-metrics';
import { STRUCTURED_LLM_PURPOSES } from '@/lib/ai/llm-purposes';

// The bearer path goes through the lazily built Supabase client; mock the SDK so a
// token is judged by `mockGetUser` and nothing dials GoTrue. Thunked: `jest.mock` is
// hoisted above this const.
const mockGetUser = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
    createClient: jest.fn(() => ({ auth: { getUser: (...a: unknown[]) => mockGetUser(...a) } })),
}));

// The route fails closed (2026-08-20): authorization needs DEV_API_KEY set in the env. The
// route reads it per-request, so this assignment governs every call below — including over
// whatever a transitive `dotenv/config` import may have loaded from a dev `.env`.
process.env.DEV_API_KEY = 'test-ok-key';
const KEY = 'test-ok-key';
// The lazy client needs SOME Supabase env or every bearer reads `auth_unavailable`.
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://unit.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-test';

function req(headers: Record<string, string> = {}, url = 'http://localhost:3000/api/ok') {
    return new NextRequest(url, { method: 'GET', headers });
}

beforeEach(() => {
    resetLlmUsageMetrics();
    mockGetUser.mockReset();
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'someone@example.org' } }, error: null });
});

describe('GET /api/ok', () => {
    it('without a key returns the health fields and an explicit authorized:false', async () => {
        recordLlmResponse({
            purpose: 'normalize',
            model: 'openai/gpt-4o-mini',
            usage: { total_tokens: 47, prompt_tokens: 41, completion_tokens: 6, cost: 1e-5 },
        });

        const res = await GET(req());
        const body = await res.json();

        expect(body.ok).toBe(true);
        expect(typeof body.ts).toBe('number');
        expect('buildId' in body).toBe(true);

        // Present, and unambiguous: this is "wrong/absent key", not "zero calls".
        expect(body.llm).toEqual({ authorized: false });

        // Nothing about spend leaks to an unauthenticated caller.
        const raw = JSON.stringify(body);
        expect(raw).not.toContain('totalTokens');
        expect(raw).not.toContain('costUsd');
        expect(raw).not.toContain('byPurpose');
    });

    it('with the dev key returns the full snapshot', async () => {
        const res = await GET(req({ 'x-api-key': KEY }));
        const body = await res.json();

        expect(body.ok).toBe(true);
        expect(typeof body.ts).toBe('number');
        expect('buildId' in body).toBe(true);

        expect(body.llm.authorized).toBe(true);
        expect(typeof body.llm.since).toBe('string');
        expect(body.llm.pid).toBe(process.pid);

        // All seven purposes present-and-zero. `produce` in particular: its counters are a
        // STRUCTURAL zero (no call site exists), which is a different claim from "no calls
        // happened" — and it must never be silently absent.
        for (const purpose of STRUCTURED_LLM_PURPOSES) {
            expect(body.llm.byPurpose[purpose]).toBeDefined();
        }
        expect(body.llm.byPurpose.produce).toBeDefined();
        expect(body.llm.byModel).toEqual({});
    });

    it('accepts the key on the api_key query param as well as the header', async () => {
        const res = await GET(req({}, `http://localhost:3000/api/ok?api_key=${KEY}`));
        const body = await res.json();
        expect(body.llm.authorized).toBe(true);
    });

    it('a wrong key is authorized:false, not an error', async () => {
        const res = await GET(req({ 'x-api-key': 'not-the-key' }));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.ok).toBe(true);
        expect(body.llm).toEqual({ authorized: false });
    });

    it('with DEV_API_KEY unset or empty nothing authorizes — the retired fallback literal included', async () => {
        const saved = process.env.DEV_API_KEY;
        try {
            // Unset: the string that used to be the fallback must no longer authorize.
            delete process.env.DEV_API_KEY;
            let body = await (await GET(req({ 'x-api-key': 'dev-key-123' }))).json();
            expect(body.llm).toEqual({ authorized: false });

            // Empty: an empty env value must not meet an empty caller key.
            process.env.DEV_API_KEY = '';
            body = await (await GET(req({}, 'http://localhost:3000/api/ok?api_key='))).json();
            expect(body.llm).toEqual({ authorized: false });
        } finally {
            process.env.DEV_API_KEY = saved as string;
        }
    });

    it('reports counters that were recorded, alongside the buildId that produced them', async () => {
        // buildId and the counters come back in ONE response so a counter can never be attributed
        // to the wrong build — the same reason #232 exists.
        recordLlmResponse({
            purpose: 'serving',
            model: 'openai/gpt-4o-mini',
            usage: { total_tokens: 47, prompt_tokens: 41, completion_tokens: 6, cost: 9.6525e-6 },
        });

        const body = await (await GET(req({ 'x-api-key': KEY }))).json();
        expect(body.llm.byPurpose.serving).toMatchObject({
            responses: 1,
            usageReported: 1,
            totalTokens: 47,
        });
        expect(body.llm.byModel['openai/gpt-4o-mini'].responses).toBe(1);
        expect('buildId' in body).toBe(true);
    });
});

/**
 * `auth` — the additive field that says HOW the caller authenticated. Always present,
 * never a 401: this is the post-deploy check for the bearer path ("did my token
 * authenticate?") without guessing from a 200. A bearer is reported, never trusted with
 * the counters — only the key unlocks `llm`.
 */
describe('GET /api/ok auth field', () => {
    it('no credentials → { via: null, reason: missing_credentials }, still a 200', async () => {
        const res = await GET(req());
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.auth).toEqual({ via: null, reason: 'missing_credentials' });
        expect(body.ok).toBe(true);
    });

    it('the dev key → { via: key }', async () => {
        const body = await (await GET(req({ 'x-api-key': KEY }))).json();
        expect(body.auth).toEqual({ via: 'key' });
        expect(body.llm.authorized).toBe(true);
        expect(mockGetUser).not.toHaveBeenCalled();
    });

    it('a valid bearer → { via: bearer } and the counters stay LOCKED', async () => {
        const body = await (await GET(req({ Authorization: 'Bearer good-token' }))).json();
        expect(body.auth).toEqual({ via: 'bearer' });
        expect(body.llm).toEqual({ authorized: false });
        expect(mockGetUser).toHaveBeenCalledWith('good-token');
        // No identity on the wire.
        const raw = JSON.stringify(body);
        expect(raw).not.toContain('user-1');
        expect(raw).not.toContain('someone@example.org');
    });

    it('a bad bearer → 200 with { via: null, reason: invalid_bearer }', async () => {
        mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid JWT' } });
        const res = await GET(req({ Authorization: 'Bearer bad' }));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.auth).toEqual({ via: null, reason: 'invalid_bearer' });
        expect(body.llm).toEqual({ authorized: false });
    });
});
