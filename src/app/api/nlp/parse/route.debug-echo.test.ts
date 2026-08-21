/**
 * /api/nlp/parse — the dev-bypass `debug=1` echo (servingTier + cacheHit).
 *
 * WHAT IT PINS. `servingTier` is written to MappingEventLog and to nothing else;
 * the golden eval (scripts/eval/run-eval.ts) is dependency-free and cannot read
 * the table, so it asks the route to echo the tier — and ONLY when the caller is
 * the dev bypass AND says `debug=1`. Everything else here is the negative space:
 * without the flag the item is byte-identical to before the echo existed, and a
 * real (JWT) caller sending the flag still sees nothing. That negative space is
 * the whole contract — the client "may never say WHY" — so it is pinned harder
 * than the positive path.
 *
 * Harness: same mocks as route.seg-cache.test.ts (supabase, prisma, structured
 * LLM client), plus mapIngredientWithFallback and resolve-payload stubbed so the
 * MAPPED branch runs (seg-cache only exercises the no-match branch).
 */

import { NextRequest } from 'next/server';
import { POST } from './route';

// `mock`-prefixed so the factory may close over it; called through a thunk
// because `jest.mock` is hoisted above this const. The JWT test uses it to
// decide who the caller is.
const mockGetUser = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ auth: { getUser: (...a: unknown[]) => mockGetUser(...a) } })),
}));

jest.mock('@/lib/db', () => ({
  prisma: {
    nlpRequestLog: { count: jest.fn(), create: jest.fn() },
    mappingEventLog: { createMany: jest.fn() },
    segmentationCache: {
      findUnique: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
      deleteMany: jest.fn(),
    },
  },
}));

jest.mock('@/lib/ai/structured-client', () => ({
  callStructuredLlm: jest.fn(),
}));

jest.mock('@/lib/mapping/map-ingredient-with-fallback', () => ({
  mapIngredientWithFallback: jest.fn(),
}));

jest.mock('@/lib/nlp/resolve-payload', () => ({
  resolveFoodDetails: jest.fn(),
  isDegenerateNutrition: jest.fn(() => false),
  per100gFromBilledMacros: jest.fn(() => null),
  isPer100gInconsistentWithBilled: jest.fn(() => false),
}));

/** A mapped line as the mapper returns it: some cereal, label serving, early cache hit. */
const MAPPED = {
  foodId: 'off_0042400265177',
  foodName: 'Cereal',
  brandName: null,
  source: 'early_cache',
  confidence: 0.92,
  grams: 26,
  kcal: 100.1,
  protein: 2,
  carbs: 22,
  fat: 1,
  servingDescription: '1 serving',
  servingTier: 'bare_label_serving',
};

const DETAILS = {
  name: 'Cereal',
  brandName: null,
  source: 'openfoodfacts',
  nutritionPer100g: { kcal100: 385, protein100: 7.7, carbs100: 84.6, fat100: 3.8, fiber100: 0, sugar100: 0, sodium100: 0 },
  servingOptions: [{ label: '1 serving (26 g)', grams: 26, isDefault: true }],
};

const DEV_KEY = 'adminAPI_dev_key_bypass';

function devRequest(body: object, query = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/nlp/parse${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': DEV_KEY },
    body: JSON.stringify(body),
  });
}

/** A JWT caller — no api key, a Bearer token the (mocked) Supabase client accepts. */
function jwtRequest(body: object, query = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/nlp/parse${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer real-user-token' },
    body: JSON.stringify(body),
  });
}

describe('/api/nlp/parse debug echo (servingTier + cacheHit)', () => {
  const { prisma } = require('@/lib/db');
  const { mapIngredientWithFallback } = require('@/lib/mapping/map-ingredient-with-fallback');
  const { resolveFoodDetails } = require('@/lib/nlp/resolve-payload');

  beforeAll(() => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
    // Fail-closed route (2026-08-20): the bypass key must come from the env — there is no
    // fallback literal to fall back onto — so pin the exact key the requests below send.
    process.env.DEV_API_KEY = 'adminAPI_dev_key_bypass';
    // The bearer path builds its Supabase client lazily from the env; without these
    // the JWT case would read `auth_unavailable` (a 401) instead of reaching the mock.
    process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://unit.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-test';
    delete process.env.MAPPING_EVENT_LOG_ENABLED;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    prisma.mappingEventLog.createMany.mockResolvedValue({ count: 0 });
    prisma.nlpRequestLog.count.mockResolvedValue(0);
    prisma.nlpRequestLog.create.mockResolvedValue({});
    resolveFoodDetails.mockResolvedValue(DETAILS);
    // The mapper stamps telemetry through the options object; mirror that so the
    // echo has a cacheHit to carry.
    mapIngredientWithFallback.mockImplementation(async (_line: string, opts: { telemetry?: { cacheHit?: string } }) => {
      if (opts?.telemetry) opts.telemetry.cacheHit = 'early';
      return { ...MAPPED };
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ------------------------------------------------------------------
  // CONTROL — green on the pre-echo tree and on this one. The mapped shape
  // the client reads is unchanged: these keys are what a client depends on.
  // ------------------------------------------------------------------
  test('control: a mapped item still carries the client contract fields', async () => {
    const res = await POST(devRequest({ items: ['some cereal'] }));
    expect(res.status).toBe(200);
    const [item] = await res.json();
    expect(item.foodId).toBe('off_0042400265177');
    expect(item.grams).toBe(26);
    expect(item.nutrition.calories).toBe(100.1);
    expect(item.matchConfidence).toBeCloseTo(0.92, 5);
    expect(item.source).toBe('openfoodfacts');
    // and the telemetry row still records the tier the echo will read
    const rows = prisma.mappingEventLog.createMany.mock.calls[0][0].data;
    expect(rows[0].servingTier).toBe('bare_label_serving');
    expect(rows[0].cacheHit).toBe('early');
  });

  // ------------------------------------------------------------------
  // NEGATIVE SPACE — byte-identity without the flag.
  // ------------------------------------------------------------------
  test('without the flag a dev-bypass response carries NEITHER servingTier NOR cacheHit', async () => {
    const res = await POST(devRequest({ items: ['some cereal'] }));
    const [item] = await res.json();
    expect(item).not.toHaveProperty('servingTier');
    expect(item).not.toHaveProperty('cacheHit');
  });

  test('the flagged item is the unflagged item plus exactly {servingTier, cacheHit} — nothing else moves', async () => {
    const plain = (await (await POST(devRequest({ items: ['some cereal'] }))).json())[0];
    const flagged = (await (await POST(devRequest({ items: ['some cereal'] }, '?debug=1'))).json())[0];
    const { servingTier, cacheHit, ...rest } = flagged;
    expect(servingTier).toBe('bare_label_serving');
    expect(cacheHit).toBe('early');
    // Byte-identity of everything a real client can see: same keys, same values,
    // same order (JSON.stringify is order-sensitive, which is the point).
    expect(JSON.stringify(rest)).toBe(JSON.stringify(plain));
  });

  test('a REAL (JWT) caller sending debug=1 in the query AND the body sees no echo', async () => {
    // The mocked Supabase client accepts the token as a non-dev user, so the
    // request is authenticated but NOT dev bypass (rate limiting runs; the
    // mocked counters return 0).
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'someone@example.org' } },
      error: null,
    });
    // A fresh save, i.e. paid work — so this request is one the limiter charges.
    mapIngredientWithFallback.mockImplementation(async (_line: string, opts: { telemetry?: { cacheHit?: string; funnelStage?: string } }) => {
      if (opts?.telemetry) { opts.telemetry.cacheHit = 'early'; opts.telemetry.funnelStage = 'saved'; }
      return { ...MAPPED };
    });
    const res = await POST(jwtRequest({ items: ['some cereal'], debug: true }, '?debug=1'));
    expect(res.status).toBe(200);
    const [item] = await res.json();
    expect(item.foodId).toBe('off_0042400265177');   // it did map — this is not a 401
    expect(item).not.toHaveProperty('servingTier');
    expect(item).not.toHaveProperty('cacheHit');
    // and, having done paid work, the request was charged one NlpRequestLog row
    expect(prisma.nlpRequestLog.create).toHaveBeenCalledTimes(1);
  });

  // ------------------------------------------------------------------
  // POSITIVE — the echo, both spellings of the flag.
  // ------------------------------------------------------------------
  test('dev bypass + ?debug=1 echoes servingTier and cacheHit on the mapped item', async () => {
    const res = await POST(devRequest({ items: ['some cereal'] }, '?debug=1'));
    expect(res.status).toBe(200);
    const [item] = await res.json();
    expect(item.servingTier).toBe('bare_label_serving');
    expect(item.cacheHit).toBe('early');
  });

  test('dev bypass + body.debug === true is the same switch', async () => {
    const res = await POST(devRequest({ items: ['some cereal'], debug: true }));
    const [item] = await res.json();
    expect(item.servingTier).toBe('bare_label_serving');
    expect(item.cacheHit).toBe('early');
  });

  test('the echo carries the KEY with a null tier on the no-pick branch, and null cacheHit on a miss', async () => {
    mapIngredientWithFallback.mockResolvedValue({ status: 'no_match' });
    const res = await POST(devRequest({ items: ['zzz unmappable'] }, '?debug=1'));
    const [item] = await res.json();
    expect(item.foodId).toBeUndefined();          // the abstain shape
    expect(item).toHaveProperty('servingTier');   // key present: the echo is ON
    expect(item.servingTier).toBeNull();
    expect(item).toHaveProperty('cacheHit');
    expect(item.cacheHit).toBeNull();
  });

  test('the echo is per item on a multi-item request', async () => {
    let n = 0;
    mapIngredientWithFallback.mockImplementation(async (_line: string, opts: { telemetry?: { cacheHit?: string } }) => {
      n += 1;
      if (opts?.telemetry && n === 1) opts.telemetry.cacheHit = 'normalized';
      return { ...MAPPED, servingTier: n === 1 ? 'volume_unit' : 'weight_unit' };
    });
    const res = await POST(devRequest({ items: ['1 cup milk', '100 g chicken'] }, '?debug=1'));
    const items = await res.json();
    expect(items.map((i: { servingTier: string }) => i.servingTier)).toEqual(['volume_unit', 'weight_unit']);
    expect(items.map((i: { cacheHit: string | null }) => i.cacheHit)).toEqual(['normalized', null]);
  });
});
