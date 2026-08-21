/**
 * /api/foods/search — WHO may call it.
 *
 * Key-only until the alpha; now key OR a Supabase bearer (the mobile client's path),
 * through the shared authenticateRequest() chokepoint. What is pinned: the key path
 * still works and never touches GoTrue, a valid bearer is a 200, and every failure
 * (nothing sent, a bad bearer, GoTrue unreachable) is a 401 — there is no cookie
 * fallback on this route.
 *
 * Harness: route.test.ts's mocks (prisma.food.findMany, logger) plus the supabase-js
 * mock the parse suites use.
 */

import { NextRequest } from 'next/server';
import { GET } from './route';

const mockGetUser = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ auth: { getUser: (...a: unknown[]) => mockGetUser(...a) } })),
}));

jest.mock('@/lib/db', () => ({
  prisma: {
    food: {
      findMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/logger', () => ({
  logger: {
    info: jest.fn(),
  },
}));

const KEY = 'test-search-key';
process.env.DEV_API_KEY = KEY;
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://unit.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-test';

function req(headers: Record<string, string> = {}, query = 's=olive'): NextRequest {
  return new NextRequest(`http://localhost:3000/api/foods/search?${query}`, { method: 'GET', headers });
}

describe('/api/foods/search auth', () => {
  const { prisma } = require('@/lib/db');

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.food.findMany.mockResolvedValue([]);
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'someone@example.org' } }, error: null });
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('the dev key (header) is a 200 and never calls GoTrue', async () => {
    const res = await GET(req({ 'x-api-key': KEY }));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  test('the dev key on ?api_key= is the same credential', async () => {
    const res = await GET(req({}, `s=olive&api_key=${KEY}`));
    expect(res.status).toBe(200);
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  test('a valid bearer is a 200', async () => {
    const res = await GET(req({ Authorization: 'Bearer good-token' }));
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
    expect(mockGetUser).toHaveBeenCalledWith('good-token');
  });

  test('neither credential is a 401 and the DB is never touched', async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
    expect(prisma.food.findMany).not.toHaveBeenCalled();
  });

  test('a bearer GoTrue rejects is a 401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid JWT' } });
    const res = await GET(req({ Authorization: 'Bearer bad' }));
    expect(res.status).toBe(401);
    expect(prisma.food.findMany).not.toHaveBeenCalled();
  });

  test('GoTrue throwing is a 401, not a 500', async () => {
    mockGetUser.mockRejectedValue(new Error('network down'));
    const res = await GET(req({ Authorization: 'Bearer tok' }));
    expect(res.status).toBe(401);
  });

  test('a wrong key beside a valid bearer: the bearer carries the request', async () => {
    const res = await GET(req({ 'x-api-key': 'not-the-key', Authorization: 'Bearer good-token' }));
    expect(res.status).toBe(200);
    expect(mockGetUser).toHaveBeenCalledTimes(1);
  });

  test('DEV_API_KEY unset: a valid bearer still authenticates', async () => {
    const saved = process.env.DEV_API_KEY;
    try {
      delete process.env.DEV_API_KEY;
      const res = await GET(req({ Authorization: 'Bearer good-token' }));
      expect(res.status).toBe(200);
    } finally {
      process.env.DEV_API_KEY = saved as string;
    }
  });
});
