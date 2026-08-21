/**
 * /api/foods/[id] GET — WHO may call it.
 *
 * This GET was PUBLIC until the alpha. It now goes through authenticateRequest()
 * accepting all three credentials: key (dev/eval), bearer (mobile) and cookie —
 * the last because src/components/recipe/IngredientMappingModal.tsx fetches this
 * route from the web app with nothing but its Supabase session. What is pinned:
 * the 401 happens BEFORE any DB read, a bad bearer never falls through to the
 * cookie session, and an authenticated caller still gets the route's own 404.
 *
 * DELETE is untouched and not exercised here.
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
      findUnique: jest.fn(),
    },
  },
}));

jest.mock('@/lib/auth', () => ({
  getCurrentUser: jest.fn(),
}));

jest.mock('@/lib/mapping/config', () => ({
  FATSECRET_CACHE_MODE: 'legacy',
}));

jest.mock('@/lib/mapping/cache-search', () => ({
  getCachedFoodWithRelations: jest.fn(async () => null),
  buildCacheFoodResponse: jest.fn(),
}));

const KEY = 'test-food-id-key';
process.env.DEV_API_KEY = KEY;
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://unit.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-test';

const FOOD = {
  id: 'seed_olive_oil',
  name: 'Olive Oil',
  brand: null,
  categoryId: 'oil',
  source: 'template',
  verification: 'verified',
  densityGml: 0.91,
  kcal100: 884,
  protein100: 0,
  carbs100: 0,
  fat100: 100,
  fiber100: 0,
  sugar100: 0,
  popularity: 100,
  createdById: null,
  units: [{ label: '1 tbsp', grams: 13.6 }],
};

const USER = { id: 'user-1', email: 'someone@example.org' };

function call(headers: Record<string, string> = {}, id = 'seed_olive_oil') {
  const req = new NextRequest(`http://localhost:3000/api/foods/${id}`, { method: 'GET', headers });
  return GET(req, { params: Promise.resolve({ id }) });
}

describe('/api/foods/[id] GET auth', () => {
  const { prisma } = require('@/lib/db');
  const { getCurrentUser } = require('@/lib/auth');

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.food.findUnique.mockResolvedValue(FOOD);
    getCurrentUser.mockResolvedValue(null);
    mockGetUser.mockResolvedValue({ data: { user: USER }, error: null });
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('no credentials → 401 before any DB read', async () => {
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: 'Unauthorized' });
    expect(prisma.food.findUnique).not.toHaveBeenCalled();
  });

  test('the dev key → 200 with the food', async () => {
    const res = await call({ 'x-api-key': KEY });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.id).toBe('seed_olive_oil');
    expect(body.data.servingOptions).toBeDefined();
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  test('a valid bearer → 200', async () => {
    const res = await call({ Authorization: 'Bearer good-token' });
    expect(res.status).toBe(200);
    expect((await res.json()).data.id).toBe('seed_olive_oil');
    expect(mockGetUser).toHaveBeenCalledWith('good-token');
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  test('a bad bearer → 401, and the cookie session is NOT consulted', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'expired' } });
    getCurrentUser.mockResolvedValue(USER); // a live web session that must not rescue the request
    const res = await call({ Authorization: 'Bearer stale' });
    expect(res.status).toBe(401);
    expect(getCurrentUser).not.toHaveBeenCalled();
    expect(prisma.food.findUnique).not.toHaveBeenCalled();
  });

  test('no credentials but a cookie session → 200 (the web app path)', async () => {
    getCurrentUser.mockResolvedValue(USER);
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).data.id).toBe('seed_olive_oil');
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  test('no credentials and no cookie session → 401', async () => {
    getCurrentUser.mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(401);
    expect(getCurrentUser).toHaveBeenCalledTimes(1);
  });

  test('authenticated but the id is unknown → the route’s own 404', async () => {
    prisma.food.findUnique.mockResolvedValue(null);
    const res = await call({ 'x-api-key': KEY }, 'nope');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Food not found' });
  });
});
