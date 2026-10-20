/**
 * /api/nlp/parse - a corrected dose (`two scoops, ok, three scoops`) on a protein shake still bills powder (S240, cloud-38 D3).
 * SegmentationCache-hit AND fresh-AI paths; the cache upsert carries the UNFOLDED split.
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
const seg = (rawText: string, normalizedForm = ''): Seg => ({ rawText, mealType: 'lunch', brand: '', normalizedForm });

type Call = { text: string; nf: string | undefined };
const C = {
  text: 'a protein shake with two scoops, ok, three scoops',
  split: [seg('a protein shake', 'protein shake'), seg('two scoops', 'two scoops'), seg('three scoops', 'three scoops')],
  expected: [{ text: '3 scoops of protein powder', nf: 'protein powder' }] as Call[],
};

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

describe('/api/nlp/parse dose correction', () => {
  const { prisma } = require('@/lib/db');
  const { callStructuredLlm } = require('@/lib/ai/structured-client');
  const { mapIngredientWithFallback } = require('@/lib/mapping/map-ingredient-with-fallback');
  const { logger } = require('@/lib/logger');
  let spies: jest.SpyInstance[] = [];

  const calls = (): Call[] =>
    mapIngredientWithFallback.mock.calls.map((c: unknown[]) => ({
      text: c[0] as string,
      nf: (c[1] as { normalizedForm?: string }).normalizedForm,
    }));

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

  test('SegmentationCache HIT: the mapper is called once with the powder', async () => {
    prisma.segmentationCache.findUnique.mockResolvedValue({
      lineKey: C.text,
      parserVersion: SEG_PARSER_VERSION,
      segmentsJson: C.split,
      hitCount: 3,
    });
    const response = await POST(parseRequest({ text: C.text }));
    expect(response.status).toBe(200);
    expect(callStructuredLlm).not.toHaveBeenCalled();
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(1);
    expect(calls()).toEqual(C.expected);
  });

  test('fresh LLM: the mapper is called once with the powder, and the cache upsert carries the UNFOLDED split', async () => {
    callStructuredLlm.mockResolvedValue({
      status: 'success',
      content: { items: C.split },
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
    });
    const response = await POST(parseRequest({ text: C.text }));
    expect(response.status).toBe(200);
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(1);
    expect(calls()).toEqual(C.expected);
    expect(prisma.segmentationCache.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.segmentationCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ segmentsJson: C.split }) }),
    );
  });
});
