/**
 * /api/admin/food-stats is KEY-ONLY (review M3, 2026-09-24). A signed-in web user is not
 * an admin: the cookie path — and its `isAdmin = true; // TODO` — is gone.
 */
import { NextRequest } from 'next/server';
import { GET } from './route';

const mockGetCurrentUser = jest.fn();
jest.mock('@/lib/auth', () => ({
  getCurrentUser: (...a: unknown[]) => mockGetCurrentUser(...a),
}));

jest.mock('@/lib/db', () => ({
  prisma: {
    food: { count: jest.fn(), groupBy: jest.fn() },
    foodUnit: { count: jest.fn() },
    foodAlias: { count: jest.fn() },
    barcode: { count: jest.fn() },
  },
}));

const KEY = 'food-stats-test-key';

function req(headers: Record<string, string> = {}, query = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/admin/food-stats${query}`, { headers });
}

describe('/api/admin/food-stats auth', () => {
  const { prisma } = require('@/lib/db');
  const savedKey = process.env.DEV_API_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DEV_API_KEY = KEY;
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    prisma.food.count.mockResolvedValue(3);
    prisma.food.groupBy.mockResolvedValue([]);
    prisma.foodUnit.count.mockResolvedValue(0);
    prisma.foodAlias.count.mockResolvedValue(0);
    prisma.barcode.count.mockResolvedValue(0);
    mockGetCurrentUser.mockResolvedValue({ id: 'web-user', email: 'someone@example.org' });
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(() => {
    if (savedKey === undefined) delete process.env.DEV_API_KEY;
    else process.env.DEV_API_KEY = savedKey;
  });

  test('a signed-in web (cookie) user with no key → 401, and no stats are read', async () => {
    const res = await GET(req({ cookie: 'sb-access-token=web-session' }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Unauthorized');
    expect(prisma.food.count).not.toHaveBeenCalled();
    expect(mockGetCurrentUser).not.toHaveBeenCalled();
  });

  test('the key in x-api-key → 200 with the stats', async () => {
    const res = await GET(req({ 'x-api-key': KEY }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.totals.foods).toBe(3);
  });

  test('the key as ?api_key= → 200', async () => {
    const res = await GET(req({}, `?api_key=${KEY}`));
    expect(res.status).toBe(200);
  });

  test('a wrong key → 401', async () => {
    const res = await GET(req({ 'x-api-key': 'not-the-key' }));
    expect(res.status).toBe(401);
    expect(prisma.food.count).not.toHaveBeenCalled();
  });

  test('DEV_API_KEY unset → even an empty presented key is refused (fails closed)', async () => {
    delete process.env.DEV_API_KEY;
    const res = await GET(req({ 'x-api-key': '' }));
    expect(res.status).toBe(401);
  });
});
