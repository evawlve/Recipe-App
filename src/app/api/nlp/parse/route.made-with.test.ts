/**
 * /api/nlp/parse - an item carrying its own personal made-with marker is the dish.
 *
 * S240 (MGR 18:44Z (2)). The SHIPPED route layer with the mapper mocked: it records every rawText and the
 * normalizedForm option it is called with. The pass runs on the SegmentationCache-hit AND the fresh-LLM path.
 * A bare label claim (`cookies made with almond flour`) stays as typed.
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

jest.mock('@/lib/mapping/ai-nutrition-backfill', () => ({
  ...jest.requireActual('@/lib/mapping/ai-nutrition-backfill'),
  requestAiNutrition: jest.fn(),
}));

jest.mock('@/lib/mapping/map-ingredient-with-fallback', () => ({
  mapIngredientWithFallback: jest.fn(async () => ({ status: 'no_match' })),
}));

jest.mock('@/lib/nlp/resolve-payload', () => ({
  resolveFoodDetails: jest.fn(),
}));

type Seg = { rawText: string; mealType: string; brand: string; normalizedForm: string };
const seg = (rawText: string, normalizedForm = ''): Seg => ({ rawText, mealType: 'lunch', brand: '', normalizedForm });

const PASTA = {
  text: 'pasta i made with olive oil',
  split: [seg('pasta i made with olive oil', 'pasta with olive oil')],
  expected: [['pasta i made with olive oil', 'pasta']],
};
const COOKIES = {
  text: 'cookies made with almond flour',
  split: [seg('cookies made with almond flour', 'cookies made with almond flour')],
  expected: [['cookies made with almond flour', 'cookies made with almond flour']],
};

function parseRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/nlp/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'adminAPI_dev_key_bypass' },
    body: JSON.stringify(body),
  });
}

describe('/api/nlp/parse made-with head', () => {
  const { prisma } = require('@/lib/db');
  const { callStructuredLlm } = require('@/lib/ai/structured-client');
  const { mapIngredientWithFallback } = require('@/lib/mapping/map-ingredient-with-fallback');
  const { logger } = require('@/lib/logger');
  let spies: jest.SpyInstance[] = [];

  const mapperCalls = (): Array<[string, string | undefined]> =>
    mapIngredientWithFallback.mock.calls.map((c: unknown[]) => [c[0] as string, (c[1] as { normalizedForm?: string } | undefined)?.normalizedForm]);
  const llmReturns = (items: Seg[]) =>
    callStructuredLlm.mockResolvedValue({
      status: 'success',
      content: { items },
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
    });
  const cacheHit = (key: string, split: Seg[]) =>
    prisma.segmentationCache.findUnique.mockResolvedValue({
      lineKey: key,
      parserVersion: SEG_PARSER_VERSION,
      segmentsJson: split,
      hitCount: 3,
    });

  beforeAll(() => {
    process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/test';
    process.env.DEV_API_KEY = 'adminAPI_dev_key_bypass';
    delete process.env.MAPPING_EVENT_LOG_ENABLED;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    spies = [
      jest.spyOn(logger, 'info').mockImplementation(() => undefined),
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

  test('SegmentationCache HIT: the personal made-with item reaches the mapper once, with the head', async () => {
    cacheHit(PASTA.text, PASTA.split);
    const response = await POST(parseRequest({ text: PASTA.text }));
    expect(response.status).toBe(200);
    expect(callStructuredLlm).not.toHaveBeenCalled();
    expect(mapperCalls()).toEqual(PASTA.expected);
  });

  test('fresh LLM: same reading', async () => {
    llmReturns(PASTA.split);
    const response = await POST(parseRequest({ text: PASTA.text }));
    expect(response.status).toBe(200);
    expect(mapperCalls()).toEqual(PASTA.expected);
  });

  test('control, cache hit: a label claim keeps its normalizedForm as typed', async () => {
    cacheHit(COOKIES.text, COOKIES.split);
    const response = await POST(parseRequest({ text: COOKIES.text }));
    expect(response.status).toBe(200);
    expect(mapperCalls()).toEqual(COOKIES.expected);
  });

  test('control, fresh LLM: a label claim keeps its normalizedForm as typed', async () => {
    llmReturns(COOKIES.split);
    const response = await POST(parseRequest({ text: COOKIES.text }));
    expect(response.status).toBe(200);
    expect(mapperCalls()).toEqual(COOKIES.expected);
  });
});
