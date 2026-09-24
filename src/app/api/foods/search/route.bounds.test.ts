/**
 * /api/foods/search — the `s` ceiling (review M2's input half, 2026-09-24): the route had a
 * floor of 2 characters and no ceiling. Over 200 (after trim, like the floor) is a 400
 * before any search work.
 *
 * Harness: route.auth.test.ts's mocks (prisma.food.findMany, logger), driven by the key.
 */

import { NextRequest } from 'next/server';
import { GET } from './route';

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

function req(s: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/foods/search?s=${encodeURIComponent(s)}`, {
    method: 'GET',
    headers: { 'x-api-key': KEY },
  });
}

describe('/api/foods/search query bound', () => {
  const { prisma } = require('@/lib/db');

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.food.findMany.mockResolvedValue([]);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  test('201 characters → 400 with the ceiling message, and no search runs', async () => {
    const res = await GET(req('a'.repeat(201)));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Search query must be at most 200 characters' });
    expect(prisma.food.findMany).not.toHaveBeenCalled();
  });

  test('200 characters → searched (not a 400)', async () => {
    const res = await GET(req('a'.repeat(200)));
    expect(res.status).toBe(200);
  });

  test('the ceiling reads the TRIMMED query, like the floor: 200 chars + padding is admitted', async () => {
    const res = await GET(req(`  ${'a'.repeat(200)}  `));
    expect(res.status).toBe(200);
  });

  test('the floor is unchanged: 1 character → its own 400', async () => {
    const res = await GET(req('a'));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Search query must be at least 2 characters' });
  });
});
