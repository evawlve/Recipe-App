/**
 * /api/nlp/parse — `nosave=1` for a TESTER bearer account (NOSAVE_TESTER_EMAILS).
 *
 * WHAT THIS PINS. After H3 (#369) the shared sitting account is a normal rate-limited user, so
 * `nosave=1` — which used to ride `isDevBypass` — would be silently ignored for every device
 * sitting and each probe line would warm the production cache. A tester listed in
 * `NOSAVE_TESTER_EMAILS` gets exactly ONE thing: the request-scoped write policy behind
 * `nosave=1` (`skipSave` to the mapper + the `X-Write-Receipt` header). It is NOT a bypass:
 * the rate-limit COUNT half still runs for that user (test 1 asserts both halves in one request).
 *
 * The three controls keep the fail-closed shape: env unset ⇒ no tester; a non-listed bearer
 * user with the flag ⇒ no suppression; a listed tester WITHOUT the flag ⇒ ordinary writes.
 *
 * Harness: route.rate-limit.test.ts's mocks, driven through a JWT caller.
 */

import { NextRequest } from 'next/server';
import { POST } from './route';

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

const TESTER = { id: 'tester-1', email: 'sitting@kindahealthy.com' };
const STRANGER = { id: 'user-2', email: 'someone@example.org' };

function jwtRequest(body: object, query = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/nlp/parse${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer real-user-token' },
    body: JSON.stringify(body),
  });
}

describe('/api/nlp/parse nosave=1 for NOSAVE_TESTER_EMAILS accounts', () => {
  const { prisma } = require('@/lib/db');
  const { mapIngredientWithFallback } = require('@/lib/mapping/map-ingredient-with-fallback');
  const { resolveFoodDetails } = require('@/lib/nlp/resolve-payload');

  const savedTesters = process.env.NOSAVE_TESTER_EMAILS;

  /** The options object the route hands the mapper on the last call. */
  function lastMapperOptions(): { skipSave?: boolean } {
    const calls = mapIngredientWithFallback.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    return calls[calls.length - 1][1];
  }

  beforeAll(() => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
    process.env.DEV_API_KEY = 'adminAPI_dev_key_bypass';
    process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://unit.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-test';
    delete process.env.MAPPING_EVENT_LOG_ENABLED;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.NOSAVE_TESTER_EMAILS;
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    prisma.mappingEventLog.createMany.mockResolvedValue({ count: 0 });
    prisma.nlpRequestLog.count.mockResolvedValue(0);
    prisma.nlpRequestLog.create.mockResolvedValue({});
    prisma.segmentationCache.findUnique.mockResolvedValue(null);
    prisma.segmentationCache.upsert.mockResolvedValue({});
    resolveFoodDetails.mockResolvedValue(DETAILS);
    mapIngredientWithFallback.mockImplementation(async (_line: string, opts: { telemetry?: { cacheHit?: string; funnelStage?: string } }) => {
      if (opts?.telemetry) {
        opts.telemetry.cacheHit = 'early';
        opts.telemetry.funnelStage = 'saved';
      }
      return { ...MAPPED };
    });
    mockGetUser.mockResolvedValue({ data: { user: TESTER }, error: null });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    if (savedTesters === undefined) delete process.env.NOSAVE_TESTER_EMAILS;
    else process.env.NOSAVE_TESTER_EMAILS = savedTesters;
  });

  test('a listed tester with nosave=1 is suppressed AND still rate-limit counted', async () => {
    process.env.NOSAVE_TESTER_EMAILS = 'other@kindahealthy.com, Sitting@KindaHealthy.com ';

    const res = await POST(jwtRequest({ items: ['1 cup cereal'] }, '?nosave=1'));

    expect(res.status).toBe(200);
    expect(lastMapperOptions().skipSave).toBe(true);
    expect(res.headers.get('X-Write-Receipt')).toBeTruthy();
    // Not a bypass: the COUNT half (minute + day) ran for this user.
    expect(prisma.nlpRequestLog.count).toHaveBeenCalledTimes(2);
  });

  test('env unset ⇒ the same account is an ordinary user: nosave=1 is ignored', async () => {
    const res = await POST(jwtRequest({ items: ['1 cup cereal'] }, '?nosave=1'));

    expect(res.status).toBe(200);
    expect(lastMapperOptions().skipSave).toBe(false);
    expect(res.headers.get('X-Write-Receipt')).toBeNull();
  });

  test('a bearer user NOT on the list gets no suppression even with the flag', async () => {
    process.env.NOSAVE_TESTER_EMAILS = 'sitting@kindahealthy.com';
    mockGetUser.mockResolvedValue({ data: { user: STRANGER }, error: null });

    const res = await POST(jwtRequest({ items: ['1 cup cereal'] }, '?nosave=1'));

    expect(res.status).toBe(200);
    expect(lastMapperOptions().skipSave).toBe(false);
    expect(res.headers.get('X-Write-Receipt')).toBeNull();
  });

  test('a listed tester WITHOUT the flag writes normally', async () => {
    process.env.NOSAVE_TESTER_EMAILS = 'sitting@kindahealthy.com';

    const res = await POST(jwtRequest({ items: ['1 cup cereal'] }));

    expect(res.status).toBe(200);
    expect(lastMapperOptions().skipSave).toBe(false);
    expect(res.headers.get('X-Write-Receipt')).toBeNull();
  });

  test('the list is exact-match only: a domain suffix or substring never qualifies', async () => {
    process.env.NOSAVE_TESTER_EMAILS = '@kindahealthy.com,kindahealthy';

    const res = await POST(jwtRequest({ items: ['1 cup cereal'] }, '?nosave=1'));

    expect(res.status).toBe(200);
    expect(lastMapperOptions().skipSave).toBe(false);
    expect(res.headers.get('X-Write-Receipt')).toBeNull();
  });
});
