/**
 * /api/nlp/parse — segmentation-cache flow tests.
 *
 * Covers: cache hit skips the LLM entirely; miss runs AI + writes through;
 * failed AI parse falls back to the heuristic and is NEVER cached; cache
 * errors are fail-open (request still succeeds via the AI path); and
 * segCacheHit telemetry stamping (true / false / null).
 *
 * The AI client (structured-client) and prisma are mocked; the segmentation
 * cache module, canonicalizer, ai-segmenter, and heuristic segmenter run real.
 */

import { NextRequest } from 'next/server';
import { POST } from './route';
import { SEG_PARSER_VERSION } from '@/lib/nlp/ai-segmenter';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ auth: { getUser: jest.fn() } })),
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
  mapIngredientWithFallback: jest.fn().mockResolvedValue({ status: 'no_match' }),
}));

jest.mock('@/lib/nlp/resolve-payload', () => ({
  resolveFoodDetails: jest.fn(),
}));

const validItems = [
  { rawText: '2 eggs', mealType: 'breakfast', brand: '', normalizedForm: 'eggs' },
  { rawText: 'wheat toast', mealType: 'breakfast', brand: '', normalizedForm: 'wheat toast' },
];

const MULTI_ITEM_TEXT = '2 Eggs and wheat toast for breakfast.';
const MULTI_ITEM_KEY = '2 eggs and wheat toast for breakfast';

function parseRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/nlp/parse', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': 'adminAPI_dev_key_bypass', // dev bypass: skips Supabase auth + rate limiting
    },
    body: JSON.stringify(body),
  });
}

describe('/api/nlp/parse segmentation cache', () => {
  const { prisma } = require('@/lib/db');
  const { callStructuredLlm } = require('@/lib/ai/structured-client');

  const telemetryRows = () => prisma.mappingEventLog.createMany.mock.calls[0][0].data;

  beforeAll(() => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
    delete process.env.DEV_API_KEY;
    delete process.env.MAPPING_EVENT_LOG_ENABLED;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    prisma.segmentationCache.findUnique.mockResolvedValue(null);
    prisma.segmentationCache.update.mockResolvedValue({});
    prisma.segmentationCache.upsert.mockResolvedValue({});
    prisma.mappingEventLog.createMany.mockResolvedValue({ count: 0 });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('cache HIT serves cached segments, skips the LLM, stamps segCacheHit=true', async () => {
    prisma.segmentationCache.findUnique.mockResolvedValue({
      lineKey: MULTI_ITEM_KEY,
      parserVersion: SEG_PARSER_VERSION,
      segmentsJson: validItems,
      hitCount: 7,
    });

    const response = await POST(parseRequest({ text: MULTI_ITEM_TEXT }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveLength(2);
    expect(data.map((d: { rawText: string }) => d.rawText)).toEqual(['2 eggs', 'wheat toast']);

    // The whole point: no LLM call on a hit.
    expect(callStructuredLlm).not.toHaveBeenCalled();
    // Canonicalized key + current version were used for the read.
    expect(prisma.segmentationCache.findUnique).toHaveBeenCalledWith({
      where: { lineKey_parserVersion: { lineKey: MULTI_ITEM_KEY, parserVersion: SEG_PARSER_VERSION } },
    });
    // Usage bump fired; no write-through on a hit.
    expect(prisma.segmentationCache.update).toHaveBeenCalledTimes(1);
    expect(prisma.segmentationCache.upsert).not.toHaveBeenCalled();

    const rows = telemetryRows();
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.segCacheHit).toBe(true);
  });

  test('cache MISS runs AI, writes through on success, stamps segCacheHit=false', async () => {
    callStructuredLlm.mockResolvedValue({
      status: 'success',
      content: { items: validItems },
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
    });

    const response = await POST(parseRequest({ text: MULTI_ITEM_TEXT }));
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveLength(2);

    expect(callStructuredLlm).toHaveBeenCalledTimes(1);
    expect(callStructuredLlm).toHaveBeenCalledWith(expect.objectContaining({ purpose: 'parse' }));
    expect(prisma.segmentationCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { lineKey_parserVersion: { lineKey: MULTI_ITEM_KEY, parserVersion: SEG_PARSER_VERSION } },
        create: expect.objectContaining({ segmentsJson: validItems }),
      }),
    );

    for (const row of telemetryRows()) expect(row.segCacheHit).toBe(false);
  });

  test('failed AI parse falls back to heuristic split and is NEVER cached', async () => {
    callStructuredLlm.mockResolvedValue({
      status: 'error',
      error: 'provider exploded',
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
    });

    const response = await POST(parseRequest({ text: MULTI_ITEM_TEXT }));
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.length).toBeGreaterThan(0); // heuristic forceSegmentText result

    expect(prisma.segmentationCache.upsert).not.toHaveBeenCalled();
    // AI ran (and failed) — still a seg-cache miss for telemetry.
    for (const row of telemetryRows()) expect(row.segCacheHit).toBe(false);
  });

  test('empty AI item list is treated as failure: heuristic fallback, no write-through', async () => {
    callStructuredLlm.mockResolvedValue({
      status: 'success',
      content: { items: [] },
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
    });

    const response = await POST(parseRequest({ text: MULTI_ITEM_TEXT }));
    expect(response.status).toBe(200);
    expect(prisma.segmentationCache.upsert).not.toHaveBeenCalled();
  });

  test('fail-open: cache read AND write both throwing still yields a successful AI-path response', async () => {
    prisma.segmentationCache.findUnique.mockRejectedValue(new Error('db down'));
    prisma.segmentationCache.upsert.mockRejectedValue(new Error('db still down'));
    callStructuredLlm.mockResolvedValue({
      status: 'success',
      content: { items: validItems },
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
    });

    const response = await POST(parseRequest({ text: MULTI_ITEM_TEXT }));
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveLength(2);
    for (const row of telemetryRows()) expect(row.segCacheHit).toBe(false);
  });

  test('single-item fast path never touches the seg cache, stamps segCacheHit=null', async () => {
    const response = await POST(parseRequest({ text: 'apple' }));
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveLength(1);

    expect(prisma.segmentationCache.findUnique).not.toHaveBeenCalled();
    expect(callStructuredLlm).not.toHaveBeenCalled();
    for (const row of telemetryRows()) expect(row.segCacheHit).toBeNull();
  });

  test('item-form input never touches the seg cache, stamps segCacheHit=null', async () => {
    const response = await POST(parseRequest({ items: ['apple', 'banana'] }));
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveLength(2);

    expect(prisma.segmentationCache.findUnique).not.toHaveBeenCalled();
    expect(callStructuredLlm).not.toHaveBeenCalled();
    for (const row of telemetryRows()) expect(row.segCacheHit).toBeNull();
  });

  test('admin nocache cold-run bypasses the seg cache in both directions', async () => {
    callStructuredLlm.mockResolvedValue({
      status: 'success',
      content: { items: validItems },
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
    });

    const response = await POST(parseRequest({ text: MULTI_ITEM_TEXT, nocache: true }));
    expect(response.status).toBe(200);

    expect(prisma.segmentationCache.findUnique).not.toHaveBeenCalled();
    expect(prisma.segmentationCache.upsert).not.toHaveBeenCalled();
    expect(callStructuredLlm).toHaveBeenCalledTimes(1);
    for (const row of telemetryRows()) {
      expect(row.segCacheHit).toBe(false);
      expect(row.noCache).toBe(true);
    }
  });
});
