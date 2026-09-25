/**
 * /api/nlp/parse — the per-request input bounds (review H1; constants in
 * src/lib/nlp/parse-bounds.ts, whose own test pins each bound at N and N+1).
 *
 * What is pinned HERE is the wiring: a refused body is a 413 with the exact user copy and
 * reaches nothing paid — not the mapper, not the segmenter's model call, not the limiter's
 * write; the bounds hold for the dev key too (they sit ahead of the bypass); on `?stream=1`
 * a refusal is still a plain JSON 413 with no SSE frame; and a segmentation's fan-out is
 * sliced before the SegmentationCache write and the `segments` frame.
 *
 * Harness: route.rate-limit.test.ts's mocks, driven through a JWT caller.
 */

import { NextRequest } from 'next/server';
import { POST } from './route';
import { decodeSseFrames, type ParseStreamFrame } from '@/lib/nlp/parse-stream';
import {
  MAX_PARSE_TEXT_CHARS,
  MAX_PARSE_ITEMS,
  MAX_PARSE_ITEM_CHARS,
  MAX_SEGMENTED_ITEMS,
  MAX_PARSE_BODY_BYTES,
} from '@/lib/nlp/parse-bounds';

const mockGetUser = jest.fn();
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ auth: { getUser: (...a: unknown[]) => mockGetUser(...a) } })),
}));

jest.mock('@/lib/db', () => {
  const nlpRequestLog = { count: jest.fn(), create: jest.fn(), delete: jest.fn() };
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

const TOO_LARGE = 'That log is too long — up to 1,000 characters or 30 foods at a time.';
const USER = { id: 'user-1', email: 'someone@example.org', email_confirmed_at: '2026-01-01T00:00:00Z' };

function jwtRequest(body: object | string, query = '', headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`http://localhost:3000/api/nlp/parse${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer real-user-token', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

function devRequest(body: object, query = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/nlp/parse${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'adminAPI_dev_key_bypass' },
    body: JSON.stringify(body),
  });
}

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
  return frames;
}

/** `n` distinct foods as the segmenter would answer them. */
function aiSplit(n: number) {
  return {
    status: 'success',
    content: {
      items: Array.from({ length: n }, (_, i) => ({
        rawText: `food ${i}`, mealType: 'snacks', brand: '', normalizedForm: `food ${i}`,
      })),
    },
    provider: 'openrouter',
    model: 'openai/gpt-4o-mini',
  };
}

/** A multi-item line (commas defeat the single-item fast path) of `n` foods. */
function listLine(n: number): string {
  return Array.from({ length: n }, (_, i) => `food ${i}`).join(', ');
}

describe('/api/nlp/parse input bounds', () => {
  const { prisma } = require('@/lib/db');
  const { mapIngredientWithFallback } = require('@/lib/mapping/map-ingredient-with-fallback');
  const { resolveFoodDetails } = require('@/lib/nlp/resolve-payload');
  const { callStructuredLlm } = require('@/lib/ai/structured-client');
  const { _resetInflightForTests } = require('@/lib/nlp/parse-rate-limit');

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
    mapIngredientWithFallback.mockImplementation(async (_line: string, opts: { telemetry?: { funnelStage?: string } }) => {
      if (opts?.telemetry) opts.telemetry.funnelStage = 'saved';
      return { ...MAPPED };
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ------------------------------------------------------------------
  // Refused: 413, the exact copy, and nothing paid ran.
  // ------------------------------------------------------------------
  test(`${MAX_PARSE_ITEMS + 1} items → 413 with the exact message; the mapper and the limiter write never run`, async () => {
    const res = await POST(jwtRequest({ items: Array(MAX_PARSE_ITEMS + 1).fill('egg') }));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: TOO_LARGE });
    expect(mapIngredientWithFallback).not.toHaveBeenCalled();
    expect(prisma.nlpRequestLog.create).not.toHaveBeenCalled();
  });

  test(`a ${MAX_PARSE_TEXT_CHARS + 1}-char text → 413 and the segmenter's model call never runs`, async () => {
    const res = await POST(jwtRequest({ text: 'a, '.repeat(400).slice(0, MAX_PARSE_TEXT_CHARS + 1) }));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: TOO_LARGE });
    expect(callStructuredLlm).not.toHaveBeenCalled();
    expect(mapIngredientWithFallback).not.toHaveBeenCalled();
    expect(prisma.nlpRequestLog.create).not.toHaveBeenCalled();
  });

  test(`an item whose rawText is ${MAX_PARSE_ITEM_CHARS + 1} chars → 413`, async () => {
    const res = await POST(jwtRequest({ items: ['egg', { rawText: 'x'.repeat(MAX_PARSE_ITEM_CHARS + 1) }] }));
    expect(res.status).toBe(413);
    expect(mapIngredientWithFallback).not.toHaveBeenCalled();
  });

  test('the bounds sit AHEAD of the dev-key bypass: a keyed oversized body is 413 too', async () => {
    const res = await POST(devRequest({ items: Array(MAX_PARSE_ITEMS + 1).fill('egg') }));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: TOO_LARGE });
    expect(mapIngredientWithFallback).not.toHaveBeenCalled();
  });

  test('a content-length over the byte cap → 413 before the body is read', async () => {
    const res = await POST(jwtRequest({ items: ['egg'] }, '', { 'content-length': String(MAX_PARSE_BODY_BYTES + 1) }));
    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: TOO_LARGE });
    expect(mapIngredientWithFallback).not.toHaveBeenCalled();
  });

  test('a body over the byte cap sent WITHOUT a usable content-length → 413 from the bounded read', async () => {
    const big = JSON.stringify({ items: ['egg'], pad: 'p'.repeat(MAX_PARSE_BODY_BYTES) });
    const req = jwtRequest(big);
    expect(Number(req.headers.get('content-length') ?? '0')).toBeLessThanOrEqual(MAX_PARSE_BODY_BYTES);
    const res = await POST(req);
    expect(res.status).toBe(413);
    expect(mapIngredientWithFallback).not.toHaveBeenCalled();
  });

  test('the ?stream=1 arm: a refused body is a JSON 413 and NO SSE frame', async () => {
    const res = await POST(jwtRequest({ items: Array(MAX_PARSE_ITEMS + 1).fill('egg') }, '?stream=1'));
    expect(res.status).toBe(413);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    const raw = await res.text();
    expect(raw).not.toMatch(/^data:|event:/m);
    expect(JSON.parse(raw)).toEqual({ error: TOO_LARGE });
    expect(mapIngredientWithFallback).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // The existing 400 keeps its shapes.
  // ------------------------------------------------------------------
  test.each([[{}], [{ text: 5 }], [{ items: 'nope' }]])('%p → 400, not 413', async (body) => {
    const res = await POST(jwtRequest(body));
    expect(res.status).toBe(400);
    expect(prisma.nlpRequestLog.create).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // Admitted: at the bound, the request proceeds.
  // ------------------------------------------------------------------
  test(`exactly ${MAX_PARSE_ITEMS} items proceed: 200 and one mapper run per item`, async () => {
    const res = await POST(jwtRequest({ items: Array.from({ length: MAX_PARSE_ITEMS }, (_, i) => `food ${i}`) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(MAX_PARSE_ITEMS);
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(MAX_PARSE_ITEMS);
  });

  test(`exactly ${MAX_PARSE_TEXT_CHARS} chars of text proceed to the segmenter`, async () => {
    callStructuredLlm.mockResolvedValue(aiSplit(2));
    const text = `egg, toast${' '.repeat(MAX_PARSE_TEXT_CHARS - 'egg, toast'.length - 1)}.`;
    expect(text).toHaveLength(MAX_PARSE_TEXT_CHARS);
    const res = await POST(jwtRequest({ text }));
    expect(res.status).toBe(200);
    expect(callStructuredLlm).toHaveBeenCalledTimes(1);
    expect(await res.json()).toHaveLength(2);
  });

  // ------------------------------------------------------------------
  // The segmented cap: sliced before the cache write and the frame.
  // ------------------------------------------------------------------
  test(`an AI split of ${MAX_SEGMENTED_ITEMS + 1} → ${MAX_SEGMENTED_ITEMS} mapped, and the cache row carries ${MAX_SEGMENTED_ITEMS}`, async () => {
    callStructuredLlm.mockResolvedValue(aiSplit(MAX_SEGMENTED_ITEMS + 1));
    const res = await POST(jwtRequest({ text: listLine(MAX_SEGMENTED_ITEMS + 1) }));
    expect(res.status).toBe(200);
    expect(await res.json()).toHaveLength(MAX_SEGMENTED_ITEMS);
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(MAX_SEGMENTED_ITEMS);
    expect(prisma.segmentationCache.upsert).toHaveBeenCalledTimes(1);
    const written = prisma.segmentationCache.upsert.mock.calls[0][0].create.segmentsJson;
    const segments = typeof written === 'string' ? JSON.parse(written) : written;
    expect(segments).toHaveLength(MAX_SEGMENTED_ITEMS);
    expect(console.warn).toHaveBeenCalledWith(
      `[nlp-parse] ai split capped: ${MAX_SEGMENTED_ITEMS + 1} items -> ${MAX_SEGMENTED_ITEMS}`,
    );
  });

  test('the heuristic fallback stays within the cap (it already slices itself, tighter, at 12)', async () => {
    // forceSegmentText() has its own MAX_ITEMS = 12 in heuristic-segmenter.ts, so the
    // route's slice on this branch is belt-and-braces; what is pinned is the outcome.
    callStructuredLlm.mockResolvedValue({ status: 'error', error: 'down' });
    const res = await POST(jwtRequest({ text: listLine(MAX_SEGMENTED_ITEMS + 5) }));
    expect(res.status).toBe(200);
    const items = await res.json();
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThanOrEqual(MAX_SEGMENTED_ITEMS);
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(items.length);
    expect(prisma.segmentationCache.upsert).not.toHaveBeenCalled();
  });

  test(`a SegmentationCache row written before the cap existed is sliced on read`, async () => {
    const { SEG_PARSER_VERSION } = require('@/lib/nlp/ai-segmenter');
    const old = aiSplit(MAX_SEGMENTED_ITEMS + 3).content.items;
    prisma.segmentationCache.findUnique.mockResolvedValue({
      lineKey: 'k', parserVersion: SEG_PARSER_VERSION, segmentsJson: old, lastUsedAt: new Date(),
    });
    prisma.segmentationCache.update.mockResolvedValue({});
    const res = await POST(jwtRequest({ text: listLine(MAX_SEGMENTED_ITEMS + 3) }));
    expect(res.status).toBe(200);
    expect(callStructuredLlm).not.toHaveBeenCalled();
    expect(await res.json()).toHaveLength(MAX_SEGMENTED_ITEMS);
  });

  test('on ?stream=1 the `segments` frame carries the capped split', async () => {
    callStructuredLlm.mockResolvedValue(aiSplit(MAX_SEGMENTED_ITEMS + 1));
    const res = await POST(jwtRequest({ text: listLine(MAX_SEGMENTED_ITEMS + 1) }, '?stream=1'));
    expect(res.status).toBe(200);
    const frames = await readFrames(res);
    const segments = frames.find((f) => f.type === 'segments') as { items: unknown[] } | undefined;
    expect(segments?.items).toHaveLength(MAX_SEGMENTED_ITEMS);
    expect(frames.filter((f) => f.type === 'item')).toHaveLength(MAX_SEGMENTED_ITEMS);
    expect(frames[frames.length - 1]).toEqual({ type: 'done', count: MAX_SEGMENTED_ITEMS, receipt: null });
  });
});
