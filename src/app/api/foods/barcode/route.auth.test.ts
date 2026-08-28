/**
 * `/api/foods/barcode` — WHO may call it.
 *
 * Key-only until 2026-08-27, which made it unreachable from the alpha client: the mobile
 * release build is keyless by design (B1), so every scan would have been a 401. Now key OR
 * a Supabase bearer through the shared authenticateRequest() chokepoint — the
 * /api/foods/search shape, with NO cookie leg, because nothing in the web app fetches this
 * route.
 *
 * What is pinned: the key path still works and never touches GoTrue, a valid bearer is a
 * 200, and every failure (nothing sent, a bad bearer, GoTrue unreachable) is a 401 with the
 * body this route has always sent.
 *
 * Harness: the supabase-js mock the parse and search auth suites use, plus enough of
 * route.test.ts's mocks to let a FatSecret hit resolve.
 */

process.env.DEV_API_KEY = 'test-barcode-key';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://unit.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-test';

import { NextRequest } from 'next/server';
import { GET } from './route';

const mockGetUser = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ auth: { getUser: (...a: unknown[]) => mockGetUser(...a) } })),
}));

/** The real FatSecretFood row for fsId 95103, abbreviated. */
const mockFsRow = {
  fsId: '95103',
  name: 'Original Potato Crisps',
  brandName: 'Pringles',
  nutrientsPer100g: {
    calories: 536, protein: 3.57, carbs: 60.71, fat: 32.14,
    fiber: 3.6, sugars: 0, sodium: 0.536, saturatedFat: 8.93,
  },
  defaultServingId: 'sv-crisps',
  fetchedAt: new Date(),
  servings: [
    { servingId: 'sv-crisps', description: '16 crisps', measurementDescription: 'crisps', grams: 28, volumeMl: null, numberOfUnits: 16, nutrients: {} },
  ],
};

/**
 * The macro-only restaurant record (fsId 68444899) — per-serving macros, no weight, empty
 * per-100g panel. The one branch of resolveFoodDetails() that can know a serving tier, and
 * so the only way this route ever ships portionEstimated / portionProvenance.
 */
const mockMacroOnlyRow = {
  fsId: '68444899',
  name: 'Whopper Jr.',
  brandName: 'Burger King',
  nutrientsPer100g: {},
  defaultServingId: '56035832',
  fetchedAt: new Date(),
  servings: [{
    servingId: '56035832', description: '1 serving', measurementDescription: null,
    grams: null, volumeMl: null, numberOfUnits: 1,
    nutrients: { calories: 340, protein: 15, carbohydrate: 30, fat: 18, fiber: 2, sugar: 7, sodium: 560 },
  }],
};

const mockFsRows: Record<string, unknown> = { '95103': mockFsRow, '68444899': mockMacroOnlyRow };

jest.mock('@/lib/db', () => ({
  prisma: {
    fatSecretFood: {
      findUnique: (args: { where: { fsId: string } }) =>
        Promise.resolve(mockFsRows[args.where.fsId] ?? null),
    },
    offFood: { findUnique: jest.fn().mockResolvedValue(null) },
    fdcFood: { findUnique: jest.fn().mockResolvedValue(null) },
    aiGeneratedFood: { findUnique: jest.fn().mockResolvedValue(null) },
  },
}));

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('@/lib/mapping/barcode', () => ({ lookupFatSecretBarcode: jest.fn() }));
jest.mock('@/lib/mapping/cache', () => ({ ensureFoodCached: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/openfoodfacts/client', () => ({ getOffProductByBarcode: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/openfoodfacts/hydrate', () => ({ hydrateOffCandidate: jest.fn().mockResolvedValue(null) }));

const { lookupFatSecretBarcode } = require('@/lib/mapping/barcode');

const KEY = 'test-barcode-key';
const CODE = '038000138416';

const req = (headers: Record<string, string> = {}, query = `code=${CODE}`) =>
  new NextRequest(`http://localhost:3000/api/foods/barcode?${query}`, { method: 'GET', headers });

describe('/api/foods/barcode auth', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lookupFatSecretBarcode.mockResolvedValue({
      foodId: '95103', name: 'whatever the API said', brandName: null,
      source: 'fatsecret' as const, servings: [],
    });
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'someone@example.org' } }, error: null,
    });
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  test('the dev key (header) is a 200 and never calls GoTrue', async () => {
    const res = await GET(req({ 'x-api-key': KEY }));
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe('Original Potato Crisps');
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  test('the dev key on ?api_key= is the same credential', async () => {
    const res = await GET(req({}, `code=${CODE}&api_key=${KEY}`));
    expect(res.status).toBe(200);
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  // The reason this PR exists: the keyless alpha client presents a Supabase JWT.
  test('a valid Supabase bearer is a 200 — the alpha client\'s path', async () => {
    const res = await GET(req({ authorization: 'Bearer good-jwt' }));
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe('fs_95103');
    expect(mockGetUser).toHaveBeenCalledWith('good-jwt');
  });

  test('an invalid bearer is a 401 and never becomes an anonymous read', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'bad jwt' } });
    const res = await GET(req({ authorization: 'Bearer stale-jwt' }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe('Unauthorized');
  });

  test('no credential at all is a 401 — the route is not public', async () => {
    const res = await GET(req());
    expect(res.status).toBe(401);
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  test('a wrong key with no bearer is a 401', async () => {
    const res = await GET(req({ 'x-api-key': 'not-the-key' }));
    expect(res.status).toBe(401);
  });

  // The payload block was not touched by the auth change, and this is what says so from the
  // outside: the two portion fields the client badges off are identical on both credentials.
  // Their omit-when-absent rule is pinned on the key path in route.test.ts; what is new here
  // is that a bearer — the alpha client — reads the same wire.
  test('portionEstimated / portionProvenance pass through a bearer exactly as through the key', async () => {
    lookupFatSecretBarcode.mockResolvedValue({
      foodId: '68444899', name: 'whatever the API said', brandName: null,
      source: 'fatsecret' as const, servings: [],
    });

    const viaBearer = await (await GET(req({ authorization: 'Bearer good-jwt' }, 'code=000000068444'))).json();
    const viaKey = await (await GET(req({ 'x-api-key': KEY }, 'code=000000068444'))).json();

    expect(viaBearer.portionEstimated).toBe(true);
    expect(viaBearer.portionProvenance).toBe('borrowed');
    expect(viaBearer).toEqual(viaKey);
  });
});
