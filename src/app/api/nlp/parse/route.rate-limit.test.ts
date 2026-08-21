/**
 * /api/nlp/parse — the per-user rate limit, both halves.
 *
 * COUNT (preamble): `>= perMinute` / `>= perDay` NlpRequestLog rows in the window is
 * a 429, limits read from the env per request and failing closed to 10 / 100.
 * CHARGE (end of runParse): one NlpRequestLog row, written AFTER the mapper and ONLY
 * when the request did paid work — a request whose every line came from the
 * FoodMapping cache or the zero-calorie fast path, with no AI segmentation call, is
 * free. What is pinned here is the wiring: which requests are counted, which are
 * charged, in what order, and that neither a 429, a 400 nor a 500 is ever billed.
 *
 * Harness: route.debug-echo.test.ts's mocks, driven through a JWT caller.
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

const MINUTE_MSG = 'Too many requests. Please wait a minute before making another food log attempt.';
const USER = { id: 'user-1', email: 'someone@example.org' };

function jwtRequest(body: object, query = '', token = 'real-user-token'): NextRequest {
  return new NextRequest(`http://localhost:3000/api/nlp/parse${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

function devRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/nlp/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'adminAPI_dev_key_bypass' },
    body: JSON.stringify(body),
  });
}

type Telemetry = { cacheHit?: string; funnelStage?: string };
type StagePicker = string | undefined | ((index: number) => string | undefined);

describe('/api/nlp/parse rate limit', () => {
  const { prisma } = require('@/lib/db');
  const { mapIngredientWithFallback } = require('@/lib/mapping/map-ingredient-with-fallback');
  const { resolveFoodDetails } = require('@/lib/nlp/resolve-payload');
  const { callStructuredLlm } = require('@/lib/ai/structured-client');

  /** `count` is awaited minute-first then day (Promise.all order), so Once-chain in that order. */
  function counts(minute: number, day: number) {
    prisma.nlpRequestLog.count.mockResolvedValueOnce(minute).mockResolvedValueOnce(day);
  }

  /** The mapper stamps telemetry through the options object; mirror that per line. */
  function stubMapper(stage: StagePicker) {
    let i = 0;
    mapIngredientWithFallback.mockImplementation(async (_line: string, opts: { telemetry?: Telemetry }) => {
      const picked = typeof stage === 'function' ? stage(i++) : stage;
      if (opts?.telemetry) {
        opts.telemetry.cacheHit = 'early';
        if (picked !== undefined) opts.telemetry.funnelStage = picked;
      }
      return { ...MAPPED };
    });
  }

  const savedMinute = process.env.NLP_PARSE_LIMIT_PER_MINUTE;
  const savedDay = process.env.NLP_PARSE_LIMIT_PER_DAY;

  beforeAll(() => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
    process.env.DEV_API_KEY = 'adminAPI_dev_key_bypass';
    process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://unit.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-test';
    delete process.env.MAPPING_EVENT_LOG_ENABLED;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.NLP_PARSE_LIMIT_PER_MINUTE;
    delete process.env.NLP_PARSE_LIMIT_PER_DAY;
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    prisma.mappingEventLog.createMany.mockResolvedValue({ count: 0 });
    prisma.nlpRequestLog.count.mockResolvedValue(0);
    prisma.nlpRequestLog.create.mockResolvedValue({});
    prisma.segmentationCache.findUnique.mockResolvedValue(null);
    prisma.segmentationCache.upsert.mockResolvedValue({});
    resolveFoodDetails.mockResolvedValue(DETAILS);
    mockGetUser.mockResolvedValue({ data: { user: USER }, error: null });
    stubMapper('saved');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    if (savedMinute === undefined) delete process.env.NLP_PARSE_LIMIT_PER_MINUTE;
    else process.env.NLP_PARSE_LIMIT_PER_MINUTE = savedMinute;
    if (savedDay === undefined) delete process.env.NLP_PARSE_LIMIT_PER_DAY;
    else process.env.NLP_PARSE_LIMIT_PER_DAY = savedDay;
  });

  // ------------------------------------------------------------------
  // COUNT half — the 429s, default limits 10/min · 100/day.
  // ------------------------------------------------------------------
  test('[9 this minute, 50 today] → 200 and exactly one charge for the user', async () => {
    counts(9, 50);
    const res = await POST(jwtRequest({ items: ['some cereal'] }));
    expect(res.status).toBe(200);
    expect(prisma.nlpRequestLog.count).toHaveBeenCalledTimes(2);
    expect(prisma.nlpRequestLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.nlpRequestLog.create).toHaveBeenCalledWith({ data: { userId: 'user-1' } });
  });

  test('[10 this minute] → 429 with the minute message; the mapper never runs and nothing is charged', async () => {
    counts(10, 50);
    const res = await POST(jwtRequest({ items: ['some cereal'] }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe(MINUTE_MSG);
    expect(mapIngredientWithFallback).not.toHaveBeenCalled();
    expect(prisma.nlpRequestLog.create).not.toHaveBeenCalled();
  });

  test('[100 today] → 429 with the daily message, which now interpolates the limit', async () => {
    counts(0, 100);
    const res = await POST(jwtRequest({ items: ['some cereal'] }));
    expect(res.status).toBe(429);
    const { error } = await res.json();
    expect(error).toBe('Daily NLP log limit reached (100 logs). Please try again tomorrow!');
    expect(prisma.nlpRequestLog.create).not.toHaveBeenCalled();
  });

  test('[99 today] → 200', async () => {
    counts(0, 99);
    const res = await POST(jwtRequest({ items: ['some cereal'] }));
    expect(res.status).toBe(200);
  });

  test('NLP_PARSE_LIMIT_PER_MINUTE=2 is read per request: [2, 0] → 429', async () => {
    process.env.NLP_PARSE_LIMIT_PER_MINUTE = '2';
    counts(2, 0);
    const res = await POST(jwtRequest({ items: ['some cereal'] }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe(MINUTE_MSG);
  });

  test('NLP_PARSE_LIMIT_PER_DAY=30: [0, 30] → 429 and the message says 30', async () => {
    process.env.NLP_PARSE_LIMIT_PER_DAY = '30';
    counts(0, 30);
    const res = await POST(jwtRequest({ items: ['some cereal'] }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toContain('(30 logs)');
  });

  test.each(['abc', '0', '-5', '1.5', ''])(
    'NLP_PARSE_LIMIT_PER_MINUTE=%p falls back to 10: [9,0] passes, [10,0] is refused',
    async (bad) => {
      process.env.NLP_PARSE_LIMIT_PER_MINUTE = bad;
      counts(9, 0);
      expect((await POST(jwtRequest({ items: ['some cereal'] }))).status).toBe(200);
      counts(10, 0);
      expect((await POST(jwtRequest({ items: ['some cereal'] }))).status).toBe(429);
    },
  );

  test.each(['abc', '0', '-5', '1.5', ''])(
    'NLP_PARSE_LIMIT_PER_DAY=%p falls back to 100: [0,99] passes, [0,100] is refused',
    async (bad) => {
      process.env.NLP_PARSE_LIMIT_PER_DAY = bad;
      counts(0, 99);
      expect((await POST(jwtRequest({ items: ['some cereal'] }))).status).toBe(200);
      counts(0, 100);
      expect((await POST(jwtRequest({ items: ['some cereal'] }))).status).toBe(429);
    },
  );

  // ------------------------------------------------------------------
  // CHARGE half — what is billed.
  // ------------------------------------------------------------------
  test('every line a cache hit → 200, counted (the limit still applies) but NOT charged', async () => {
    stubMapper('cache_hit');
    counts(9, 50);
    const res = await POST(jwtRequest({ items: ['some cereal', 'a banana'] }));
    expect(res.status).toBe(200);
    expect(prisma.nlpRequestLog.count).toHaveBeenCalledTimes(2);
    expect(prisma.nlpRequestLog.create).not.toHaveBeenCalled();
  });

  test('every line the zero-calorie fast path → not charged', async () => {
    stubMapper('fast_path');
    const res = await POST(jwtRequest({ items: ['water', 'ice'] }));
    expect(res.status).toBe(200);
    expect(prisma.nlpRequestLog.create).not.toHaveBeenCalled();
  });

  test('one cache hit beside one fresh save → charged exactly once', async () => {
    stubMapper(i => (i === 0 ? 'cache_hit' : 'saved'));
    const res = await POST(jwtRequest({ items: ['some cereal', 'a new thing'] }));
    expect(res.status).toBe(200);
    expect(prisma.nlpRequestLog.create).toHaveBeenCalledTimes(1);
  });

  test('a line the mapper never classified (no funnelStage) is charged', async () => {
    stubMapper(undefined);
    const res = await POST(jwtRequest({ items: ['some cereal'] }));
    expect(res.status).toBe(200);
    expect(prisma.nlpRequestLog.create).toHaveBeenCalledTimes(1);
  });

  test('an AI segmentation call is paid work: a seg-cache MISS is charged even when every line was cached', async () => {
    stubMapper('cache_hit');
    prisma.segmentationCache.findUnique.mockResolvedValue(null);
    callStructuredLlm.mockResolvedValue({
      status: 'success',
      content: {
        items: [
          { rawText: '2 eggs', mealType: 'breakfast', brand: '', normalizedForm: 'eggs' },
          { rawText: 'wheat toast', mealType: 'breakfast', brand: '', normalizedForm: 'wheat toast' },
        ],
      },
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
    });
    const res = await POST(jwtRequest({ text: '2 Eggs and wheat toast for breakfast.' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(2);
    expect(callStructuredLlm).toHaveBeenCalledTimes(1);
    expect(prisma.nlpRequestLog.create).toHaveBeenCalledTimes(1);
  });

  test('the mapper throwing → 500 and nothing is charged', async () => {
    mapIngredientWithFallback.mockRejectedValue(new Error('mapper down'));
    const res = await POST(jwtRequest({ items: ['some cereal'] }));
    expect(res.status).toBe(500);
    expect(prisma.nlpRequestLog.create).not.toHaveBeenCalled();
  });

  test('a 400 (no text, no items) is not charged', async () => {
    const res = await POST(jwtRequest({}));
    expect(res.status).toBe(400);
    expect(prisma.nlpRequestLog.create).not.toHaveBeenCalled();
  });

  test('the charge failing → still 200 (fail open)', async () => {
    prisma.nlpRequestLog.create.mockRejectedValue(new Error('db down'));
    const res = await POST(jwtRequest({ items: ['some cereal'] }));
    expect(res.status).toBe(200);
    expect(prisma.nlpRequestLog.create).toHaveBeenCalledTimes(1);
  });

  test('the charge is written AFTER the mapper ran, not before', async () => {
    const res = await POST(jwtRequest({ items: ['some cereal'] }));
    expect(res.status).toBe(200);
    const mapperOrder = mapIngredientWithFallback.mock.invocationCallOrder[0];
    const chargeOrder = prisma.nlpRequestLog.create.mock.invocationCallOrder[0];
    expect(chargeOrder).toBeGreaterThan(mapperOrder);
  });

  // ------------------------------------------------------------------
  // Exemptions and the 401 legs.
  // ------------------------------------------------------------------
  test('an allowlisted email (diego@example.com) is neither counted nor charged', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'diego-id', email: 'diego@example.com' } }, error: null });
    const res = await POST(jwtRequest({ items: ['some cereal'] }));
    expect(res.status).toBe(200);
    expect(prisma.nlpRequestLog.count).not.toHaveBeenCalled();
    expect(prisma.nlpRequestLog.create).not.toHaveBeenCalled();
  });

  test('the dev key is neither counted nor charged', async () => {
    const res = await POST(devRequest({ items: ['some cereal'] }));
    expect(res.status).toBe(200);
    expect(prisma.nlpRequestLog.count).not.toHaveBeenCalled();
    expect(prisma.nlpRequestLog.create).not.toHaveBeenCalled();
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  test('a bearer GoTrue rejects → 401 "Invalid authentication session", nothing counted', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: { message: 'invalid JWT' } });
    const res = await POST(jwtRequest({ items: ['some cereal'] }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized: Invalid authentication session' });
    expect(prisma.nlpRequestLog.count).not.toHaveBeenCalled();
  });

  test('GoTrue throwing → 401 "Auth service validation failed"', async () => {
    mockGetUser.mockRejectedValue(new Error('network down'));
    const res = await POST(jwtRequest({ items: ['some cereal'] }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized: Auth service validation failed' });
  });

  test('no credentials at all → 401 "Missing or invalid token"', async () => {
    const res = await POST(new NextRequest('http://localhost:3000/api/nlp/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: ['some cereal'] }),
    }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized: Missing or invalid token' });
    expect(mockGetUser).not.toHaveBeenCalled();
  });
});
