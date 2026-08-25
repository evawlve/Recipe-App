/**
 * /api/nlp/parse `?stream=1` — the streamed response is the one-shot response, re-timed.
 *
 * WHAT THIS PINS. (1) Frame order: `segments` first, then one `item` per line, then
 * `done`, and nothing else. (2) Byte-identity: every `item.item` deep-equals the element
 * the one-shot array carries at that index for the SAME request — the builder is shared,
 * so a field added to one path cannot go missing from the other. (3) The `nosave` receipt
 * rides in `done`, and it is the same object the one-shot path puts in `X-Write-Receipt`.
 * (4) A mid-stream throw is an `error` frame with no `done` — the 500 the one-shot path
 * sends (pinned by route.rate-limit.test.ts) cannot be sent once the status has left.
 * (5) The rate-limit CHARGE still fires for a bearer caller, exactly as often as on the
 * one-shot path. (6) Without the flag nothing changed: the body is still a bare array.
 *
 * Harness: route.debug-echo.test.ts's mocks (supabase, prisma, structured client, mapper,
 * resolve-payload). Item-form input (`items: [...]`) is used so no segmentation LLM call
 * is reached; the `segments` frame is emitted for item-form input too.
 */

import { NextRequest } from 'next/server';
import { POST } from './route';
import { decodeSseFrames, type ParseStreamFrame } from '@/lib/nlp/parse-stream';

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

  test('control: without the flag the body is still a bare JSON array', async () => {
    const res = await POST(devRequest({ items: LINES }));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(3);
  });

  test('frame order is segments → item × N (resolution order) → done, and the items are the one-shot elements', async () => {
    const oneShot = await (await POST(devRequest({ items: LINES }))).json();

    const res = await POST(devRequest({ items: LINES }, '?stream=1'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/);
    expect(res.headers.get('cache-control')).toContain('no-transform');

    const frames = await readFrames(res);
    expect(frames.map((f) => f.type)).toEqual(['segments', 'item', 'item', 'item', 'done']);

    const segments = frames[0] as Extract<ParseStreamFrame, { type: 'segments' }>;
    expect(segments.items).toEqual([
      { index: 0, rawText: LINES[0], mealType: 'snacks' },
      { index: 1, rawText: LINES[1], mealType: 'snacks' },
      { index: 2, rawText: LINES[2], mealType: 'snacks' },
    ]);

    const items = frames.filter((f): f is Extract<ParseStreamFrame, { type: 'item' }> => f.type === 'item');
    // Resolution order, not input order — the fastest line (index 2) lands first.
    expect(items.map((f) => f.index)).toEqual([2, 1, 0]);
    for (const frame of items) {
      expect(frame.item).toEqual(oneShot[frame.index]);
    }

    const done = frames[frames.length - 1] as Extract<ParseStreamFrame, { type: 'done' }>;
    expect(done).toEqual({ type: 'done', count: 3, receipt: null });
  });

  test('body.stream === true is the same switch', async () => {
    const res = await POST(devRequest({ items: LINES, stream: true }));
    expect(res.headers.get('content-type')).toMatch(/^text\/event-stream/);
    const frames = await readFrames(res);
    expect(frames[0].type).toBe('segments');
    expect(frames[frames.length - 1].type).toBe('done');
  });

  test('a single text line still opens with a one-segment frame', async () => {
    const res = await POST(devRequest({ text: '2 eggs' }, '?stream=1'));
    const frames = await readFrames(res);
    expect(frames.map((f) => f.type)).toEqual(['segments', 'item', 'done']);
    expect((frames[0] as Extract<ParseStreamFrame, { type: 'segments' }>).items).toHaveLength(1);
  });

  test('nosave=1: the receipt rides in `done` and is the one-shot header, field for field', async () => {
    const oneShot = await POST(devRequest({ items: LINES }, '?nosave=1'));
    const header = oneShot.headers.get('X-Write-Receipt');
    expect(header).not.toBeNull();

    const res = await POST(devRequest({ items: LINES }, '?nosave=1&stream=1'));
    expect(res.headers.get('X-Write-Receipt')).toBeNull();
    const frames = await readFrames(res);
    const done = frames[frames.length - 1] as Extract<ParseStreamFrame, { type: 'done' }>;
    expect(done.type).toBe('done');
    expect(done.receipt).toEqual(JSON.parse(header as string));
  });

  test('a throw mid-stream is an `error` frame and no `done` — the status is already 200', async () => {
    mapIngredientWithFallback.mockImplementation(async (line: string) => {
      if (line === LINES[1]) throw new Error('mapper exploded');
      return { ...MAPPED };
    });
    const res = await POST(devRequest({ items: LINES }, '?stream=1'));
    expect(res.status).toBe(200);
    const frames = await readFrames(res);
    expect(frames[0].type).toBe('segments');
    expect(frames.some((f) => f.type === 'done')).toBe(false);
    expect(frames[frames.length - 1]).toEqual({ type: 'error', message: 'Internal server error' });
  });

  test('a bearer caller is charged exactly as on the one-shot path', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'friend@example.com' } },
      error: null,
    });
    await (await POST(jwtRequest({ items: LINES }))).json();
    const oneShotCharges = prisma.nlpRequestLog.create.mock.calls.length;
    expect(oneShotCharges).toBeGreaterThan(0);

    prisma.nlpRequestLog.create.mockClear();
    const res = await POST(jwtRequest({ items: LINES }, '?stream=1'));
    expect(res.status).toBe(200);
    const frames = await readFrames(res);
    expect(frames[frames.length - 1].type).toBe('done');
    expect(prisma.nlpRequestLog.create).toHaveBeenCalledTimes(oneShotCharges);
  });

  test('a 400 is still a 400 with the flag — nothing streams before validation', async () => {
    const res = await POST(devRequest({}, '?stream=1'));
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });
});
