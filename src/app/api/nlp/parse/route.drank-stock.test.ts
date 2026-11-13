/**
 * /api/nlp/parse - a drank / finished clause after a one-item STOCK line bills what was consumed (S240, cloud-38 D7).
 * SegmentationCache-hit AND fresh-AI paths; the cache upsert carries the UNFOLDED split; a valid-target control
 * (`a pitcher of beer, drank 2`) is unchanged.
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

const WINE = {
  text: 'a bottle of wine, drank half',
  key: 'a bottle of wine, drank half',
  split: [seg('a bottle of wine', 'wine')],
  expected: ['1/2 bottle of wine'],
};
const BEER = {
  text: 'a pitcher of beer, drank 2',
  key: 'a pitcher of beer, drank 2',
  split: [seg('a pitcher of beer', 'beer')],
  expected: ['a pitcher of beer'],
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

describe('/api/nlp/parse drank-stock fold', () => {
  const { prisma } = require('@/lib/db');
  const { callStructuredLlm } = require('@/lib/ai/structured-client');
  const { mapIngredientWithFallback } = require('@/lib/mapping/map-ingredient-with-fallback');
  const { logger } = require('@/lib/logger');
  let spies: jest.SpyInstance[] = [];

  const mapperTexts = (): string[] => mapIngredientWithFallback.mock.calls.map((c: unknown[]) => c[0] as string);

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

  const llm = (items: Seg[]) =>
    callStructuredLlm.mockResolvedValue({
      status: 'success',
      content: { items },
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
    });

  describe.each([
    ['wine (drank half scales the bottle)', WINE],
    ['beer (a pitcher is a valid target: unchanged)', BEER],
  ])('%s', (_label, c) => {
    test('SegmentationCache HIT: the mapper is called once with the consumed amount', async () => {
      prisma.segmentationCache.findUnique.mockResolvedValue({
        lineKey: c.key,
        parserVersion: SEG_PARSER_VERSION,
        segmentsJson: c.split,
        hitCount: 3,
      });
      const response = await POST(parseRequest({ text: c.text }));
      expect(response.status).toBe(200);
      expect(callStructuredLlm).not.toHaveBeenCalled();
      expect(mapIngredientWithFallback).toHaveBeenCalledTimes(1);
      expect(mapperTexts()).toEqual(c.expected);
    });

    test('fresh LLM: the consumed amount, and the cache upsert carries the UNFOLDED split', async () => {
      llm(c.split);
      const response = await POST(parseRequest({ text: c.text }));
      expect(response.status).toBe(200);
      expect(mapIngredientWithFallback).toHaveBeenCalledTimes(1);
      expect(mapperTexts()).toEqual(c.expected);
      expect(prisma.segmentationCache.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.segmentationCache.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { lineKey_parserVersion: { lineKey: c.key, parserVersion: SEG_PARSER_VERSION } },
          create: expect.objectContaining({ segmentsJson: c.split }),
        }),
      );
    });
  });
});
