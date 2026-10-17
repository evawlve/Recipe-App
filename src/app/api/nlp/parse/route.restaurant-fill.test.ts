/**
 * /api/nlp/parse - a restaurant's brand fills the later dishes (S192 row 5, F2).
 *
 * The SHIPPED route layer with the mapper mocked to record the options each item is mapped with.
 * Fill-positive on the SegmentationCache-hit AND the fresh-LLM path; the heuristic path is a pinned
 * KNOWN MISS (forceSegmentText() emits brand '' on every item); a P line gets no fill; a negated part
 * is dropped BEFORE the fill; the fresh path's cache upsert carries the UNFILLED split.
 */

import { NextRequest } from 'next/server';
import { POST } from './route';
import { SEG_PARSER_VERSION } from '@/lib/nlp/ai-segmenter';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({ auth: { getUser: jest.fn() } })),
}));

jest.mock('@/lib/db', () => ({
  prisma: {
    nlpRequestLog: { count: jest.fn(), create: jest.fn(), deleteMany: jest.fn(async () => ({ count: 0 })) },
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
  mapIngredientWithFallback: jest.fn(async () => ({ status: 'no_match' })),
}));

jest.mock('@/lib/nlp/resolve-payload', () => ({
  resolveFoodDetails: jest.fn(),
}));

type Seg = { rawText: string; mealType: string; brand: string; normalizedForm: string };
const seg = (rawText: string, normalizedForm = '', brand = ''): Seg => ({ rawText, mealType: 'lunch', brand, normalizedForm });

const R_TEXT = 'a chick-fil-a spicy chicken sandwich, waffle fries and a lemonade';
const R_SPLIT = [
  seg('a chick-fil-a spicy chicken sandwich', 'spicy chicken sandwich', 'chick-fil-a'),
  seg('waffle fries', 'waffle fries'),
  seg('a lemonade', 'lemonade'),
];
const P_TEXT = 'a banquet chicken pot pie and an apple';
const P_SPLIT = [seg('a banquet chicken pot pie', 'chicken pot pie', 'banquet'), seg('an apple', 'apple')];
const NEG_TEXT = 'a chick-fil-a sandwich, no pickles';
const NEG_SPLIT = [seg('a chick-fil-a sandwich', 'sandwich', 'chick-fil-a'), seg('no pickles', 'pickles')];

function parseRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/nlp/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'adminAPI_dev_key_bypass' },
    body: JSON.stringify(body),
  });
}

describe('/api/nlp/parse restaurant brand fill', () => {
  const { prisma } = require('@/lib/db');
  const { callStructuredLlm } = require('@/lib/ai/structured-client');
  const { mapIngredientWithFallback } = require('@/lib/mapping/map-ingredient-with-fallback');
  const { logger } = require('@/lib/logger');
  let spies: jest.SpyInstance[] = [];
  let infoSpy: jest.SpyInstance;

  const mapped = (): Array<{ raw: string; brand: unknown }> =>
    mapIngredientWithFallback.mock.calls.map((c: any[]) => ({ raw: c[0] as string, brand: c[1].brand }));
  const fillLines = () => infoSpy.mock.calls.filter((c: unknown[]) => c[0] === 'nlp_parse.restaurant_brand_fill');
  const llmReturns = (items: Seg[]) =>
    callStructuredLlm.mockResolvedValue({
      status: 'success', content: { items }, provider: 'openrouter', model: 'openai/gpt-4o-mini',
    });
  const cacheHit = (key: string, split: Seg[]) =>
    prisma.segmentationCache.findUnique.mockResolvedValue({
      lineKey: key, parserVersion: SEG_PARSER_VERSION, segmentsJson: split, hitCount: 3,
    });

  beforeAll(() => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
    process.env.DEV_API_KEY = 'adminAPI_dev_key_bypass';
    delete process.env.MAPPING_EVENT_LOG_ENABLED;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => undefined);
    spies = [
      infoSpy,
      jest.spyOn(console, 'log').mockImplementation(() => undefined),
      jest.spyOn(console, 'warn').mockImplementation(() => undefined),
    ];
    prisma.segmentationCache.findUnique.mockResolvedValue(null);
    prisma.segmentationCache.update.mockResolvedValue({});
    prisma.segmentationCache.upsert.mockResolvedValue({});
    prisma.mappingEventLog.createMany.mockResolvedValue({ count: 0 });
  });

  afterEach(() => {
    for (const s of spies) s.mockRestore();
  });

  test('R line, SegmentationCache HIT: items 2+ reach the mapper with brand chick-fil-a', async () => {
    cacheHit(R_TEXT, R_SPLIT);
    const response = await POST(parseRequest({ text: R_TEXT }));
    expect(response.status).toBe(200);
    expect(callStructuredLlm).not.toHaveBeenCalled();
    expect(mapped().map(m => m.brand)).toEqual(['chick-fil-a', 'chick-fil-a', 'chick-fil-a']);
    expect(fillLines()).toHaveLength(1);
    expect(fillLines()[0][1]).toEqual({ count: 2 });
  });

  test('R line, fresh LLM: items 2+ fill, and the cache upsert carries the UNFILLED split', async () => {
    llmReturns(R_SPLIT);
    const response = await POST(parseRequest({ text: R_TEXT }));
    expect(response.status).toBe(200);
    expect(mapped().map(m => m.brand)).toEqual(['chick-fil-a', 'chick-fil-a', 'chick-fil-a']);
    expect(prisma.segmentationCache.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.segmentationCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ segmentsJson: R_SPLIT }) }),
    );
    const upserted = prisma.segmentationCache.upsert.mock.calls[0][0].create.segmentsJson;
    expect(upserted.map((s: Seg) => s.brand)).toEqual(['chick-fil-a', '', '']);
  });

  test('heuristic path is a pinned KNOWN MISS: every item brand is empty/undefined', async () => {
    callStructuredLlm.mockResolvedValue({ status: 'error', error: 'provider exploded', provider: 'openrouter', model: 'openai/gpt-4o-mini' });
    const response = await POST(parseRequest({ text: R_TEXT }));
    expect(response.status).toBe(200);
    const calls = mapped();
    expect(calls.length).toBeGreaterThanOrEqual(2);
    for (const c of calls) expect(c.brand === undefined || c.brand === '').toBe(true);
    expect(fillLines()).toHaveLength(0);
  });

  test('P line (banquet pot pie + apple): no fill, the apple stays unbranded', async () => {
    llmReturns(P_SPLIT);
    const response = await POST(parseRequest({ text: P_TEXT }));
    expect(response.status).toBe(200);
    expect(mapped().map(m => m.brand)).toEqual(['banquet', undefined]);
    expect(fillLines()).toHaveLength(0);
  });

  test('negated part: "no pickles" never reaches the mapper, the sandwich keeps its brand, 0 fills', async () => {
    llmReturns(NEG_SPLIT);
    const response = await POST(parseRequest({ text: NEG_TEXT }));
    expect(response.status).toBe(200);
    expect(mapped()).toEqual([{ raw: 'a chick-fil-a sandwich', brand: 'chick-fil-a' }]);
    expect(fillLines()).toHaveLength(0);
  });
});
