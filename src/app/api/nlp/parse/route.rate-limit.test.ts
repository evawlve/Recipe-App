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
import { decodeSseFrames, type ParseStreamFrame } from '@/lib/nlp/parse-stream';

const mockGetUser = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ auth: { getUser: (...a: unknown[]) => mockGetUser(...a) } })),
}));

// `$transaction` is the interactive (callback) form the reservation uses. It SERIALISES —
// each call waits for the previous one on a promise chain — which is what the route's
// `pg_advisory_xact_lock` gives one user in Postgres, so concurrent requests reserve one
// after another. The `tx` it hands over shares `nlpRequestLog`'s mocks, and its
// `$executeRaw` (the lock) is a no-op.
jest.mock('@/lib/db', () => {
  const nlpRequestLog = { count: jest.fn(), create: jest.fn(), delete: jest.fn() };
  const executeRaw = jest.fn(async () => 0);
  let chain: Promise<unknown> = Promise.resolve();
  const $transaction = jest.fn((fn: (tx: unknown) => Promise<unknown>) => {
    const run = chain.then(() => fn({ nlpRequestLog, $executeRaw: executeRaw }));
    chain = run.catch(() => undefined);
    return run;
  });
  return {
    prisma: {
      nlpRequestLog,
      $transaction,
      mappingEventLog: { createMany: jest.fn() },
      segmentationCache: {
        findUnique: jest.fn(),
        update: jest.fn(),
        upsert: jest.fn(),
        deleteMany: jest.fn(),
      },
    },
  };
});

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
  const { _resetInflightForTests } = require('@/lib/nlp/parse-rate-limit');

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
    // The in-flight map and the reservation-error breaker are module state.
    _resetInflightForTests();
    delete process.env.NLP_PARSE_LIMIT_PER_MINUTE;
    delete process.env.NLP_PARSE_LIMIT_PER_DAY;
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    prisma.mappingEventLog.createMany.mockResolvedValue({ count: 0 });
    prisma.nlpRequestLog.count.mockResolvedValue(0);
    prisma.nlpRequestLog.create.mockResolvedValue({ id: 'reserved-1' });
    prisma.nlpRequestLog.delete.mockResolvedValue({});
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

// ======================================================================
// RESERVE THEN REFUND (review H2, 2026-09-24) — concurrency, the in-flight cap, the
// DB-error breaker, and the stream wire. The mock `$transaction` serialises (see the
// jest.mock above), and a STATEFUL count stands in for the table: `count` reads `rows`,
// `create` adds one — so a request that reserves is visible to the next reservation.
// ======================================================================
const INFLIGHT_MSG = 'You already have food logs being processed. Please wait for them to finish.';
const UNAVAILABLE_MSG = 'Food logging is temporarily unavailable. Please try again in a moment.';

async function readStreamFrames(response: Response): Promise<ParseStreamFrame[]> {
  const body = response.body;
  if (!body) throw new Error('no body');
  const decoder = new TextDecoder();
  const frames: ParseStreamFrame[] = [];
  let buffer = '';
  const reader = body.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const decoded = decodeSseFrames(buffer);
    frames.push(...decoded.frames);
    buffer = decoded.rest;
  }
  return frames;
}

/** Let every pending promise continuation run (the handlers interleave on these). */
async function settleMicrotasks(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r));
}

describe('/api/nlp/parse rate limit — reserve then refund', () => {
  const { prisma } = require('@/lib/db');
  const { mapIngredientWithFallback } = require('@/lib/mapping/map-ingredient-with-fallback');
  const { resolveFoodDetails } = require('@/lib/nlp/resolve-payload');
  const { _resetInflightForTests } = require('@/lib/nlp/parse-rate-limit');

  let rows = 0;
  let nextId = 0;

  function mapperStage(stage: string) {
    mapIngredientWithFallback.mockImplementation(async (_line: string, opts: { telemetry?: Telemetry }) => {
      if (opts?.telemetry) { opts.telemetry.cacheHit = 'early'; opts.telemetry.funnelStage = stage; }
      return { ...MAPPED };
    });
  }

  /** The mapper waits on the returned `open()` — holds requests in flight. */
  function gateMapper(stage = 'saved') {
    let open!: () => void;
    const gate = new Promise<void>((r) => { open = r; });
    mapIngredientWithFallback.mockImplementation(async (_line: string, opts: { telemetry?: Telemetry }) => {
      await gate;
      if (opts?.telemetry) { opts.telemetry.cacheHit = 'early'; opts.telemetry.funnelStage = stage; }
      return { ...MAPPED };
    });
    return open;
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
    _resetInflightForTests();
    delete process.env.NLP_PARSE_LIMIT_PER_MINUTE;
    delete process.env.NLP_PARSE_LIMIT_PER_DAY;
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    rows = 0;
    nextId = 0;
    prisma.nlpRequestLog.count.mockImplementation(async () => rows);
    prisma.nlpRequestLog.create.mockImplementation(async () => { rows += 1; nextId += 1; return { id: `res-${nextId}` }; });
    prisma.nlpRequestLog.delete.mockImplementation(async () => { rows -= 1; return {}; });
    prisma.mappingEventLog.createMany.mockResolvedValue({ count: 0 });
    prisma.segmentationCache.findUnique.mockResolvedValue(null);
    prisma.segmentationCache.upsert.mockResolvedValue({});
    resolveFoodDetails.mockResolvedValue(DETAILS);
    mockGetUser.mockResolvedValue({ data: { user: USER }, error: null });
    mapperStage('saved');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ------------------------------------------------------------------
  // The reservation.
  // ------------------------------------------------------------------
  test('the reservation locks THIS user inside the transaction before counting', async () => {
    const lock = jest.fn(async () => 0);
    prisma.$transaction.mockImplementationOnce(async (fn: (tx: unknown) => unknown) =>
      fn({ nlpRequestLog: prisma.nlpRequestLog, $executeRaw: lock }));
    const res = await POST(jwtRequest({ items: ['some cereal'] }));
    expect(res.status).toBe(200);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction.mock.calls[0][1]).toEqual({ maxWait: 2000, timeout: 5000 });
    // A tagged template: (strings, ...values) — the user id is BOUND, never spliced.
    const [strings, ...values] = lock.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
    expect(strings.join('?')).toBe('SELECT pg_advisory_xact_lock(hashtext(?::text))');
    expect(values).toEqual(['user-1']);
    expect(lock.mock.invocationCallOrder[0])
      .toBeLessThan(prisma.nlpRequestLog.count.mock.invocationCallOrder[0]);
    expect(prisma.nlpRequestLog.create.mock.invocationCallOrder[0])
      .toBeLessThan(mapIngredientWithFallback.mock.invocationCallOrder[0]);
  });

  test('two concurrent requests at 9 this minute → one reaches the mapper, the other is 429 (minute)', async () => {
    rows = 9;
    const [a, b] = await Promise.all([
      POST(jwtRequest({ items: ['some cereal'] })),
      POST(jwtRequest({ items: ['some cereal'] })),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 429]);
    const refused = a.status === 429 ? a : b;
    expect((await refused.json()).error).toBe(MINUTE_MSG);
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(1);
    expect(prisma.nlpRequestLog.create).toHaveBeenCalledTimes(1);
    expect(rows).toBe(10);
  });

  test('five concurrent requests at 0 with a limit of 2/min → exactly two run (reservation + in-flight cap)', async () => {
    process.env.NLP_PARSE_LIMIT_PER_MINUTE = '2';
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => POST(jwtRequest({ items: ['some cereal'] }))),
    );
    expect(responses.filter((r) => r.status === 200)).toHaveLength(2);
    expect(responses.filter((r) => r.status === 429)).toHaveLength(3);
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(2);
  });

  test('three concurrent at 0 → the third is 429 IN-FLIGHT before any DB call', async () => {
    const open = gateMapper();
    const settled: Array<Response | undefined> = [undefined, undefined, undefined];
    const pending = [0, 1, 2].map((i) =>
      POST(jwtRequest({ items: ['some cereal'] })).then((r) => { settled[i] = r; return r; }));
    await settleMicrotasks();
    const early = settled.filter((r): r is Response => r !== undefined);
    expect(early).toHaveLength(1);
    expect(early[0].status).toBe(429);
    expect((await early[0].json()).error).toBe(INFLIGHT_MSG);
    // Two reservations, not three: the refused request never reached the DB.
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    open();
    const all = await Promise.all(pending);
    expect(all.map((r) => r.status).sort()).toEqual([200, 200, 429]);
    // Slots came back: a fourth request now runs.
    expect((await POST(jwtRequest({ items: ['some cereal'] }))).status).toBe(200);
  });

  test('a 429 releases its in-flight slot: three refused requests in a row are all MINUTE, never IN-FLIGHT', async () => {
    rows = 10;
    for (let i = 0; i < 3; i++) {
      const res = await POST(jwtRequest({ items: ['some cereal'] }));
      expect(res.status).toBe(429);
      expect((await res.json()).error).toBe(MINUTE_MSG);
    }
  });

  test('a 413 reserves nothing and takes no slot', async () => {
    const res = await POST(jwtRequest({ items: Array(31).fill('egg') }));
    expect(res.status).toBe(413);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.nlpRequestLog.create).not.toHaveBeenCalled();
  });

  test('the dev key is exempt from the cap and the reservation: three concurrent keyed requests all run', async () => {
    const open = gateMapper();
    const pending = [0, 1, 2].map(() => POST(devRequest({ items: ['some cereal'] })));
    await settleMicrotasks();
    open();
    const all = await Promise.all(pending);
    expect(all.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // DB errors: fail open, then fail closed.
  // ------------------------------------------------------------------
  test('$transaction rejecting once → 200 and the mapper runs (fail open); nothing is charged', async () => {
    prisma.$transaction.mockRejectedValueOnce(new Error('db down'));
    const res = await POST(jwtRequest({ items: ['some cereal'] }));
    expect(res.status).toBe(200);
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(1);
    expect(prisma.nlpRequestLog.create).not.toHaveBeenCalled();
    expect(prisma.nlpRequestLog.delete).not.toHaveBeenCalled();
  });

  test('$transaction rejecting four times in a row → the first three fail open, the fourth is 503 and never maps', async () => {
    for (let i = 0; i < 4; i++) prisma.$transaction.mockRejectedValueOnce(new Error('db down'));
    const statuses: number[] = [];
    for (let i = 0; i < 3; i++) statuses.push((await POST(jwtRequest({ items: ['some cereal'] }))).status);
    expect(statuses).toEqual([200, 200, 200]);
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(3);
    const fourth = await POST(jwtRequest({ items: ['some cereal'] }));
    expect(fourth.status).toBe(503);
    expect((await fourth.json()).error).toBe(UNAVAILABLE_MSG);
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(3);
    // …until one succeeds.
    expect((await POST(jwtRequest({ items: ['some cereal'] }))).status).toBe(200);
  });

  test('a success resets the breaker: 3 errors, 1 success, 3 errors → never 503', async () => {
    const err = () => prisma.$transaction.mockRejectedValueOnce(new Error('db down'));
    err(); err(); err();
    for (let i = 0; i < 3; i++) expect((await POST(jwtRequest({ items: ['a'] }))).status).toBe(200);
    expect((await POST(jwtRequest({ items: ['a'] }))).status).toBe(200); // the real (mock) transaction
    err(); err(); err();
    for (let i = 0; i < 3; i++) expect((await POST(jwtRequest({ items: ['a'] }))).status).toBe(200);
  });

  test('a P2028 transaction timeout → 429, and it does not count toward the breaker', async () => {
    const timeout = Object.assign(new Error('Transaction API error'), { code: 'P2028' });
    for (let i = 0; i < 3; i++) prisma.$transaction.mockRejectedValueOnce(timeout);
    for (let i = 0; i < 3; i++) {
      const res = await POST(jwtRequest({ items: ['some cereal'] }));
      expect(res.status).toBe(429);
      expect((await res.json()).error).toBe(MINUTE_MSG);
    }
    expect(mapIngredientWithFallback).not.toHaveBeenCalled();
    // Had those counted, the next error would be the 4th in a row → 503. It fails open.
    prisma.$transaction.mockRejectedValueOnce(new Error('db down'));
    expect((await POST(jwtRequest({ items: ['some cereal'] }))).status).toBe(200);
  });

  test('a refund that FAILS is swallowed: still 200 (the user has paid one slot)', async () => {
    mapperStage('cache_hit');
    prisma.nlpRequestLog.delete.mockRejectedValueOnce(new Error('db down'));
    const res = await POST(jwtRequest({ items: ['some cereal'] }));
    expect(res.status).toBe(200);
    expect(prisma.nlpRequestLog.delete).toHaveBeenCalledTimes(1);
  });

  // ------------------------------------------------------------------
  // The stream wire: the run settles in the producer, after the handler returned.
  // ------------------------------------------------------------------
  test('streamed cache_hit → `done`, then the reservation is refunded (create 1, delete 1)', async () => {
    mapperStage('cache_hit');
    const res = await POST(jwtRequest({ items: ['some cereal'] }, '?stream=1'));
    expect(res.status).toBe(200);
    // The handler has returned; the run has not settled yet.
    const frames = await readStreamFrames(res);
    expect(frames[frames.length - 1].type).toBe('done');
    expect(prisma.nlpRequestLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.nlpRequestLog.delete).toHaveBeenCalledTimes(1);
    expect(prisma.nlpRequestLog.delete).toHaveBeenCalledWith({ where: { id: 'res-1' } });
    expect(prisma.nlpRequestLog.delete.mock.invocationCallOrder[0])
      .toBeGreaterThan(mapIngredientWithFallback.mock.invocationCallOrder[0]);
    expect(rows).toBe(0);
  });

  test('streamed paid work → reserved and kept (create 1, delete 0)', async () => {
    const res = await POST(jwtRequest({ items: ['some cereal'] }, '?stream=1'));
    const frames = await readStreamFrames(res);
    expect(frames[frames.length - 1].type).toBe('done');
    expect(prisma.nlpRequestLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.nlpRequestLog.delete).not.toHaveBeenCalled();
  });

  test('streamed mapper throw → an `error` frame AND the reservation is refunded', async () => {
    mapIngredientWithFallback.mockRejectedValue(new Error('mapper down'));
    const res = await POST(jwtRequest({ items: ['some cereal'] }, '?stream=1'));
    expect(res.status).toBe(200);
    const frames = await readStreamFrames(res);
    expect(frames[frames.length - 1]).toEqual({ type: 'error', message: 'Internal server error' });
    expect(prisma.nlpRequestLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.nlpRequestLog.delete).toHaveBeenCalledWith({ where: { id: 'res-1' } });
  });

  test('three streamed in flight → the third is a 429 before the first byte; slots return when the streams end', async () => {
    const open = gateMapper();
    const responses = await Promise.all(
      [0, 1, 2].map(() => POST(jwtRequest({ items: ['some cereal'] }, '?stream=1'))),
    );
    const refused = responses.filter((r) => r.status === 429);
    const streaming = responses.filter((r) => r.status === 200);
    expect(refused).toHaveLength(1);
    expect(refused[0].headers.get('content-type')).toMatch(/application\/json/);
    expect((await refused[0].json()).error).toBe(INFLIGHT_MSG);
    expect(streaming).toHaveLength(2);
    open();
    for (const r of streaming) {
      const frames = await readStreamFrames(r);
      expect(frames[frames.length - 1].type).toBe('done');
    }
    // Released in the producer, not in the handler: the next stream runs.
    const next = await POST(jwtRequest({ items: ['some cereal'] }, '?stream=1'));
    expect(next.status).toBe(200);
    await readStreamFrames(next);
  });
});
