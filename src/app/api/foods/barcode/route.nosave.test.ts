/**
 * `/api/foods/barcode?nosave=1` — a device sitting must be able to scan without leaving rows.
 *
 * This route's ENTIRE write surface is the OffFood + OffServing upsert pair inside
 * `hydrateOffCandidate()` (measured 2026-08-27: the FatSecret branch calls
 * `ensureFoodCached` with no `client`, and `upsertFoodFromDetails()` has no other door).
 * `nosave=1` puts the request in a write-policy scope suppressing `offMirror`, and the
 * writer consults it.
 *
 * These tests run the REAL `hydrateOffCandidate` over a mocked `@/lib/db` — deliberately,
 * because the behaviour under test is whether the writer sees the policy. Mocking the
 * hydrator would leave nothing but the route's own flag.
 *
 * The consequence that must not be papered over: `resolveFoodDetails()` reads OffFood, so
 * refusing the mirror makes a NEVER-SEEN barcode unanswerable. That is a 404 with
 * `code: 'nosave_not_persisted'`, distinct from the ordinary "nobody has this product" —
 * a sitting must not read its own suppression as a lookup defect.
 */

process.env.DEV_API_KEY = 'test-barcode-key';
process.env.NOSAVE_TESTER_EMAILS = 'google_test_user@kindahealthy.com';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://unit.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-test';

import { NextRequest } from 'next/server';
import { GET } from './route';

const mockGetUser = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ auth: { getUser: (...a: unknown[]) => mockGetUser(...a) } })),
}));

const offFindUnique = jest.fn();
const offUpsert = jest.fn().mockResolvedValue({});
const offServingUpsert = jest.fn().mockResolvedValue({});

jest.mock('@/lib/db', () => ({
  prisma: {
    fatSecretFood: { findUnique: jest.fn().mockResolvedValue(null) },
    offFood: {
      findUnique: (...a: unknown[]) => offFindUnique(...a),
      upsert: (...a: unknown[]) => offUpsert(...a),
    },
    offServing: { upsert: (...a: unknown[]) => offServingUpsert(...a) },
    fdcFood: { findUnique: jest.fn().mockResolvedValue(null) },
    aiGeneratedFood: { findUnique: jest.fn().mockResolvedValue(null) },
  },
}));

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

jest.mock('@/lib/mapping/barcode', () => ({ lookupFatSecretBarcode: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/mapping/cache', () => ({ ensureFoodCached: jest.fn().mockResolvedValue(null) }));
jest.mock('@/lib/openfoodfacts/client', () => ({ getOffProductByBarcode: jest.fn() }));
// NOT mocked, on purpose: @/lib/openfoodfacts/hydrate is the code under test.

const { getOffProductByBarcode } = require('@/lib/openfoodfacts/client');

const BARCODE = '021130126026';
const TESTER = 'google_test_user@kindahealthy.com';

/** A live OFF product shape (`nutriments` present ⇒ hydrate treats it as live). */
const liveProduct = {
  code: BARCODE,
  product_name: 'Greek Nonfat Yogurt (Strawberry)',
  brands: 'Lucerne',
  serving_size: '150 g',
  serving_quantity: 150,
  nutriments: {
    'energy-kcal_100g': 53.3, 'proteins_100g': 5.3, 'carbohydrates_100g': 8,
    'fat_100g': 0, 'fiber_100g': 0, 'sugars_100g': 7.3, 'sodium_100g': 0.05,
  },
};

/** The same product as an OffFood row, for the already-mirrored case. */
const mirroredRow = {
  barcode: BARCODE,
  name: 'Greek Nonfat Yogurt (Strawberry)',
  brandName: 'Lucerne',
  nutrientsPer100g: { calories: 53.3, protein: 5.3, carbs: 8, fat: 0, fiber: 0, sugars: 7.3, sodium: 0.05 },
  servingGrams: 150,
  servingSize: '1 container (150g)',
  packageQuantity: null,
  packageQuantityUnit: null,
  servings: [],
};

const call = (query: string, headers: Record<string, string> = {}) =>
  GET(new NextRequest(`http://localhost:3000/api/foods/barcode?${query}`, { method: 'GET', headers }));

const receiptOf = (res: { headers: Headers }) => {
  const raw = res.headers.get('X-Write-Receipt');
  return raw ? JSON.parse(raw) : null;
};

describe('/api/foods/barcode nosave=1', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    offFindUnique.mockResolvedValue(null);
    offUpsert.mockResolvedValue({});
    offServingUpsert.mockResolvedValue({});
    getOffProductByBarcode.mockResolvedValue(liveProduct);
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', email: TESTER } }, error: null });
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  test('a listed tester scanning a never-seen barcode writes NOTHING and is told why', async () => {
    const res = await call(`code=${BARCODE}&nosave=1`, { authorization: 'Bearer tester-jwt' });

    // The behaviour the sitting needs.
    expect(offUpsert).not.toHaveBeenCalled();
    expect(offServingUpsert).not.toHaveBeenCalled();

    // And the honest answer, not a lookup failure it would chase.
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe('nosave_not_persisted');
    expect(body.error).not.toBe('Food not found for barcode');

    // The writer really did see the policy — consulted, then refused.
    const receipt = receiptOf(res);
    expect(receipt.suppress).toEqual(['offMirror']);
    expect(receipt.consulted).toBe(1);
    expect(receipt.refusedTotal).toBeGreaterThanOrEqual(1);
    expect(receipt.refused.some((r: { table: string }) => r.table === 'OffFood')).toBe(true);
  });

  test('a listed tester scanning an ALREADY-mirrored barcode gets the real card, still writing nothing', async () => {
    offFindUnique.mockResolvedValue(mirroredRow);

    const res = await call(`code=${BARCODE}&nosave=1`, { authorization: 'Bearer tester-jwt' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(`off_${BARCODE}`);
    expect(body.name).toBe('Greek Nonfat Yogurt (Strawberry)');
    expect(body.nutritionPer100g.kcal100).toBeGreaterThan(0);
    expect(offUpsert).not.toHaveBeenCalled();

    // hydrateOffCandidate returns cache-first, BEFORE the guard, so nothing consults the
    // policy on this path. That is the normal reading here and not the fail-open — see the
    // withReceipt() header in route.ts for the falsifier that does work.
    expect(receiptOf(res).consulted).toBe(0);
  });

  test('a signed-in user who is NOT a listed tester cannot suppress — fail closed', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u2', email: 'friend@example.com' } }, error: null });

    const res = await call(`code=${BARCODE}&nosave=1`, { authorization: 'Bearer friend-jwt' });

    // The row is written exactly as it would be without the flag, and no receipt is echoed:
    // an ordinary alpha user asking for nosave is silently ignored, the parse route's rule.
    expect(offUpsert).toHaveBeenCalledTimes(1);
    expect(res.headers.get('X-Write-Receipt')).toBeNull();
  });

  test('the dev key may suppress without being a listed tester', async () => {
    const res = await call(`code=${BARCODE}&nosave=1&api_key=test-barcode-key`);
    expect(offUpsert).not.toHaveBeenCalled();
    expect(receiptOf(res).suppress).toEqual(['offMirror']);
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  test('WITHOUT nosave the mirror is written and no header appears — control', async () => {
    const res = await call(`code=${BARCODE}&api_key=test-barcode-key`);
    expect(offUpsert).toHaveBeenCalledTimes(1);
    expect(offServingUpsert).toHaveBeenCalledTimes(1);
    expect(res.headers.get('X-Write-Receipt')).toBeNull();
    // The write is what makes the answer possible: OffFood was empty when the request
    // started, so this 404 is the mocked findUnique, not a suppression. What matters for
    // the control is that both upserts fired.
    expect(getOffProductByBarcode).toHaveBeenCalledWith(BARCODE);
  });

  test('a genuine miss keeps its own 404, with no nosave code', async () => {
    getOffProductByBarcode.mockResolvedValue(null);

    const res = await call(`code=000000000000&nosave=1`, { authorization: 'Bearer tester-jwt' });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe('Food not found for barcode');
    expect(body.code).toBeUndefined();
  });
});
