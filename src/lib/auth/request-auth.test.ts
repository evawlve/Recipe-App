/**
 * authenticateRequest() — the one auth chokepoint for API routes.
 *
 * What is pinned: the FIXED evaluation order (key → bearer → cookie), that the key
 * path touches no network, that an invalid bearer never reaches the cookie path,
 * that a missing Supabase env is `auth_unavailable` (not a throw and not a silent
 * pass), and that the lazy client is built once.
 */

import { NextRequest } from 'next/server';

const mockGetUser = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ auth: { getUser: (...a: unknown[]) => mockGetUser(...a) } })),
}));

jest.mock('@/lib/auth', () => ({ getCurrentUser: jest.fn() }));

import { createClient } from '@supabase/supabase-js';
import { getCurrentUser } from '@/lib/auth';
import { resetSupabaseAuthClientForTests } from '@/lib/supabase/admin';
import {
  authenticateRequest,
  matchesDevApiKey,
  readBearerToken,
  readDevApiKey,
} from './request-auth';

const KEY = 'test-dev-key';
const ALL = ['key', 'bearer', 'cookie'] as const;

function req(headers: Record<string, string> = {}, url = 'http://localhost:3000/api/x'): NextRequest {
  return new NextRequest(url, { method: 'GET', headers });
}

const USER = { id: 'user-123', email: 'someone@example.org' };

beforeEach(() => {
  jest.clearAllMocks();
  resetSupabaseAuthClientForTests();
  process.env.DEV_API_KEY = KEY;
  process.env.SUPABASE_URL = 'https://unit.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  mockGetUser.mockResolvedValue({ data: { user: USER }, error: null });
  (getCurrentUser as jest.Mock).mockResolvedValue(null);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('readers', () => {
  test('readDevApiKey: header first, then ?api_key', () => {
    expect(readDevApiKey(req({ 'x-api-key': 'h' }, 'http://localhost/x?api_key=q'))).toBe('h');
    expect(readDevApiKey(req({}, 'http://localhost/x?api_key=q'))).toBe('q');
    expect(readDevApiKey(req())).toBeNull();
  });

  test('matchesDevApiKey: fails closed on an unset or empty DEV_API_KEY', () => {
    delete process.env.DEV_API_KEY;
    expect(matchesDevApiKey(req({ 'x-api-key': 'dev-key-123' }))).toBe(false);
    process.env.DEV_API_KEY = '';
    expect(matchesDevApiKey(req({}, 'http://localhost/x?api_key='))).toBe(false);
    process.env.DEV_API_KEY = KEY;
    expect(matchesDevApiKey(req({ 'x-api-key': KEY }))).toBe(true);
    expect(matchesDevApiKey(req({ 'x-api-key': 'wrong' }))).toBe(false);
  });

  test('readBearerToken: Bearer prefix only, trimmed, empty is null', () => {
    expect(readBearerToken(req({ Authorization: 'Bearer abc' }))).toBe('abc');
    expect(readBearerToken(req({ authorization: 'Bearer   abc  ' }))).toBe('abc');
    expect(readBearerToken(req({ Authorization: 'Bearer ' }))).toBeNull();
    expect(readBearerToken(req({ Authorization: 'Basic abc' }))).toBeNull();
    expect(readBearerToken(req())).toBeNull();
  });
});

describe('key path', () => {
  test('x-api-key header → via:key, no user, and the Supabase client is never built', async () => {
    const out = await authenticateRequest(req({ 'x-api-key': KEY }), { accept: ALL });
    expect(out).toEqual({ via: 'key', userId: null, email: null });
    expect(createClient).not.toHaveBeenCalled();
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  test('?api_key= is the same credential', async () => {
    const out = await authenticateRequest(req({}, `http://localhost/x?api_key=${KEY}`), { accept: ['key'] });
    expect(out).toEqual({ via: 'key', userId: null, email: null });
    expect(createClient).not.toHaveBeenCalled();
  });

  test('a matching key wins even when a bearer is also sent', async () => {
    const out = await authenticateRequest(req({ 'x-api-key': KEY, Authorization: 'Bearer tok' }), { accept: ALL });
    expect(out.via).toBe('key');
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  test('wrong key and no bearer → missing_credentials', async () => {
    const out = await authenticateRequest(req({ 'x-api-key': 'wrong' }), { accept: ['key', 'bearer'] });
    expect(out).toEqual({ via: null, reason: 'missing_credentials' });
  });

  test('DEV_API_KEY unset: the literal that used to be the fallback is refused', async () => {
    delete process.env.DEV_API_KEY;
    const out = await authenticateRequest(req({ 'x-api-key': 'adminAPI_dev_key_bypass' }), { accept: ['key'] });
    expect(out).toEqual({ via: null, reason: 'missing_credentials' });
  });

  test('key not in accept: a matching key is ignored', async () => {
    const out = await authenticateRequest(req({ 'x-api-key': KEY }), { accept: ['bearer'] });
    expect(out).toEqual({ via: null, reason: 'missing_credentials' });
  });
});

describe('bearer path', () => {
  test('valid bearer → via:bearer with the user, getUser called with the bare token', async () => {
    const out = await authenticateRequest(req({ Authorization: 'Bearer good-token' }), { accept: ['key', 'bearer'] });
    expect(out).toEqual({ via: 'bearer', userId: 'user-123', email: 'someone@example.org' });
    expect(mockGetUser).toHaveBeenCalledTimes(1);
    expect(mockGetUser).toHaveBeenCalledWith('good-token');
  });

  test('getUser returns an error → invalid_bearer', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid JWT' } });
    const out = await authenticateRequest(req({ Authorization: 'Bearer bad' }), { accept: ['bearer'] });
    expect(out).toEqual({ via: null, reason: 'invalid_bearer' });
  });

  test('getUser returns no user and no error → invalid_bearer', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const out = await authenticateRequest(req({ Authorization: 'Bearer bad' }), { accept: ['bearer'] });
    expect(out).toEqual({ via: null, reason: 'invalid_bearer' });
  });

  test('getUser throws → auth_unavailable', async () => {
    mockGetUser.mockRejectedValue(new Error('network down'));
    const out = await authenticateRequest(req({ Authorization: 'Bearer tok' }), { accept: ['bearer'] });
    expect(out).toEqual({ via: null, reason: 'auth_unavailable' });
  });

  test('Supabase env absent → auth_unavailable, and createClient is not called', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const out = await authenticateRequest(req({ Authorization: 'Bearer tok' }), { accept: ['bearer'] });
    expect(out).toEqual({ via: null, reason: 'auth_unavailable' });
    expect(createClient).not.toHaveBeenCalled();
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  test('the NEXT_PUBLIC pair is accepted when the server pair is absent', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://pub.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-test';
    const out = await authenticateRequest(req({ Authorization: 'Bearer tok' }), { accept: ['bearer'] });
    expect(out.via).toBe('bearer');
    expect(createClient).toHaveBeenCalledWith('https://pub.supabase.co', 'anon-test');
  });

  test('an absent env is not latched: once the env appears the client is built', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect((await authenticateRequest(req({ Authorization: 'Bearer tok' }), { accept: ['bearer'] })).via).toBeNull();
    process.env.SUPABASE_URL = 'https://unit.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
    expect((await authenticateRequest(req({ Authorization: 'Bearer tok' }), { accept: ['bearer'] })).via).toBe('bearer');
    expect(createClient).toHaveBeenCalledTimes(1);
  });

  test('two bearer requests build the client once', async () => {
    await authenticateRequest(req({ Authorization: 'Bearer a' }), { accept: ['bearer'] });
    await authenticateRequest(req({ Authorization: 'Bearer b' }), { accept: ['bearer'] });
    expect(createClient).toHaveBeenCalledTimes(1);
    expect(mockGetUser).toHaveBeenCalledTimes(2);
  });

  test('a bearer the route does not accept is treated as not sent', async () => {
    const out = await authenticateRequest(req({ Authorization: 'Bearer tok' }), { accept: ['key'] });
    expect(out).toEqual({ via: null, reason: 'missing_credentials' });
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  test('an empty email on the Supabase user is null on the wire', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u9', email: '' } }, error: null });
    const out = await authenticateRequest(req({ Authorization: 'Bearer tok' }), { accept: ['bearer'] });
    expect(out).toEqual({ via: 'bearer', userId: 'u9', email: null });
  });
});

describe('cookie path', () => {
  test('invalid bearer + cookie accepted → invalid_bearer; the cookie session is NEVER consulted', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'expired' } });
    (getCurrentUser as jest.Mock).mockResolvedValue(USER);
    const out = await authenticateRequest(req({ Authorization: 'Bearer stale' }), { accept: ALL });
    expect(out).toEqual({ via: null, reason: 'invalid_bearer' });
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  test('no credentials + cookie accepted + a session → via:cookie', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(USER);
    const out = await authenticateRequest(req(), { accept: ALL });
    expect(out).toEqual({ via: 'cookie', userId: 'user-123', email: 'someone@example.org' });
    expect(createClient).not.toHaveBeenCalled();
  });

  test('no credentials + cookie accepted + no session → missing_credentials', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null);
    const out = await authenticateRequest(req(), { accept: ALL });
    expect(out).toEqual({ via: null, reason: 'missing_credentials' });
    expect(getCurrentUser).toHaveBeenCalledTimes(1);
  });

  test('cookie not in accept → getCurrentUser is not called', async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(USER);
    const out = await authenticateRequest(req(), { accept: ['key', 'bearer'] });
    expect(out).toEqual({ via: null, reason: 'missing_credentials' });
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  test('getCurrentUser throwing → auth_unavailable', async () => {
    (getCurrentUser as jest.Mock).mockRejectedValue(new Error('prisma down'));
    const out = await authenticateRequest(req(), { accept: ['cookie'] });
    expect(out).toEqual({ via: null, reason: 'auth_unavailable' });
  });
});
