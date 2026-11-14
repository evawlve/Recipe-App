/**
 * /api/nlp/parse — `MappingEventLog.userHash` (s457 UID-1).
 *
 * Every telemetry row carries the keyed hash of the bearer's user id, 'dev' for the dev key,
 * or null when no secret is configured. Keyed on `auth.via`, never `isDevBypass`: an
 * @google.com bearer is a real account. The hash never rides a response body and the raw id
 * never reaches the createMany payload.
 *
 * Harness: route.stream.test.ts's, verbatim.
 */

import { NextRequest } from 'next/server';
import { POST } from './route';
import { decodeSseFrames, type ParseStreamFrame } from '@/lib/nlp/parse-stream';

const mockGetUser = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ auth: { getUser: (...a: unknown[]) => mockGetUser(...a) } })),
}));

// `$transaction` (the reservation's interactive form) hands the callback a `tx` that shares
// `nlpRequestLog`'s mocks, so the count/create assertions below read the same functions.
jest.mock('@/lib/db', () => {
  const nlpRequestLog = { count: jest.fn(), create: jest.fn(), delete: jest.fn(), deleteMany: jest.fn(async () => ({ count: 0 })) };
  return {
    prisma: {
      nlpRequestLog,
      $transaction: jest.fn(async (fn: (tx: unknown) => unknown) =>
        fn({ nlpRequestLog, $executeRaw: jest.fn(async () => 0) })),
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

// The segmenter seams, so the `segmenter` pins can drive each branch; the item-form and
// short-line tests above them never reach either module.
jest.mock('@/lib/nlp/segmentation-cache', () => ({
  lookupSegmentationCache: jest.fn(),
  writeSegmentationCache: jest.fn(),
}));

jest.mock('@/lib/nlp/ai-segmenter', () => ({
  segmentTextWithAi: jest.fn(),
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

const DEV_KEY = 'adminAPI_dev_key_bypass';
const LINES = ['a bowl of cereal', '2 eggs', 'toast with butter'];

function devRequest(body: object, query = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/nlp/parse${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': DEV_KEY },
    body: JSON.stringify(body),
  });
}

function jwtRequest(body: object, query = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/nlp/parse${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer real-user-token' },
    body: JSON.stringify(body),
  });
}

/** Drain a streamed Response into frames, feeding the decoder chunk by chunk as a client would. */
async function readFrames(response: Response): Promise<ParseStreamFrame[]> {
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
  expect(buffer).toBe('');
  return frames;
}

describe('/api/nlp/parse ?stream=1', () => {
  const { prisma } = require('@/lib/db');
  const { mapIngredientWithFallback } = require('@/lib/mapping/map-ingredient-with-fallback');
  const { resolveFoodDetails } = require('@/lib/nlp/resolve-payload');

  beforeAll(() => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
    process.env.DEV_API_KEY = 'adminAPI_dev_key_bypass';
    process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://unit.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-test';
    delete process.env.MAPPING_EVENT_LOG_ENABLED;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    prisma.mappingEventLog.createMany.mockResolvedValue({ count: 0 });
    prisma.nlpRequestLog.count.mockResolvedValue(0);
    prisma.nlpRequestLog.create.mockResolvedValue({});
    resolveFoodDetails.mockResolvedValue(DETAILS);
    // Lines resolve in REVERSE input order (the last line is the fastest), so a stream
    // that merely mirrored input order would fail the ordering assertion below.
    mapIngredientWithFallback.mockImplementation(async (line: string, opts: { telemetry?: { cacheHit?: string } }) => {
      if (opts?.telemetry) opts.telemetry.cacheHit = 'early';
      const idx = LINES.indexOf(line);
      await new Promise((resolve) => setTimeout(resolve, (LINES.length - idx) * 5));
      return { ...MAPPED, foodName: `Cereal ${idx}` };
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const ID = 'b3f1c2d4-0000-4000-8000-00000000abcd';
  const HASH = '3e2705a4de1d0d10';

  const rows = () => prisma.mappingEventLog.createMany.mock.calls.flatMap((c: any[]) => c[0].data);
  const asBearer = (email = 'friend@example.com', extra: object = {}) =>
    mockGetUser.mockResolvedValue({ data: { user: { id: ID, email, ...extra } }, error: null });

  beforeEach(() => {
    process.env.TELEMETRY_USER_HASH_SECRET = 'k'.repeat(32);
  });
  afterEach(() => {
    delete process.env.TELEMETRY_USER_HASH_SECRET;
  });

  test('p1: a one-shot bearer parse tags every row with the keyed hash, and the raw id never reaches createMany', async () => {
    asBearer();
    const res = await POST(jwtRequest({ items: LINES }));
    expect(res.status).toBe(200);
    await res.json();
    expect(rows()).toHaveLength(3);
    for (const r of rows()) expect(r.userHash).toBe(HASH);
    expect(JSON.stringify(prisma.mappingEventLog.createMany.mock.calls)).not.toContain(ID);
  });

  test('p2: the streamed wire tags the same way', async () => {
    asBearer();
    const res = await POST(jwtRequest({ items: LINES }, '?stream=1'));
    expect(res.status).toBe(200);
    await readFrames(res);
    expect(rows()).toHaveLength(3);
    for (const r of rows()) expect(r.userHash).toBe(HASH);
  });

  test("p3: a dev-key caller's rows read 'dev'", async () => {
    const res = await POST(devRequest({ items: LINES }));
    expect(res.status).toBe(200);
    await res.json();
    expect(rows()).toHaveLength(3);
    for (const r of rows()) expect(r.userHash).toBe('dev');
  });

  test('p4: an @google.com bearer (isDevBypass) is a real account and keeps its hash', async () => {
    asBearer('sitting@google.com', { email_confirmed_at: '2026-01-01T00:00:00Z' });
    const res = await POST(jwtRequest({ items: LINES }));
    expect(res.status).toBe(200);
    await res.json();
    expect(rows()).toHaveLength(3);
    for (const r of rows()) expect(r.userHash).toBe(HASH);
  });

  test("p5: with no secret, bearer rows are null and dev-key rows still read 'dev'", async () => {
    delete process.env.TELEMETRY_USER_HASH_SECRET;
    asBearer();
    await (await POST(jwtRequest({ items: LINES }))).json();
    const bearerRows = rows();
    expect(bearerRows).toHaveLength(3);
    for (const r of bearerRows) expect(r.userHash).toBeNull();

    prisma.mappingEventLog.createMany.mockClear();
    await (await POST(devRequest({ items: LINES }))).json();
    expect(rows()).toHaveLength(3);
    for (const r of rows()) expect(r.userHash).toBe('dev');
  });

  test('p6: the one-shot response body never carries userHash', async () => {
    asBearer();
    const body = await (await POST(jwtRequest({ items: LINES }))).json();
    expect(JSON.stringify(body)).not.toContain('userHash');
  });
});
