/**
 * /api/nlp/parse - a count stock whose unit is the food's own count noun re-counts (`6 eggs, had 2` -> `2 eggs`; S240,
 * cloud-38 D13). SegmentationCache-hit AND fresh-AI paths; the cache upsert carries the UNFOLDED split; a control is unchanged.
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

const EGGS = {
  text: '6 eggs, had 2',
  key: '6 eggs, had 2',
  split: [seg('6 eggs', 'eggs')],
  expected: ['2 eggs'],
};
const PIZZA = {
  text: '4 slices of pizza, ate 2',
  key: '4 slices of pizza, ate 2',
  split: [seg('4 slices of pizza', 'pizza')],
  expected: ['4 slices of pizza'],
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

describe('/api/nlp/parse count-noun stock fold', () => {
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
    ['eggs (the count noun is the stock)', EGGS],
    ['control: pizza slices (unchanged)', PIZZA],
  ])('%s', (_label, c) => {
    test('SegmentationCache HIT: the mapper is called once with the expected text', async () => {
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

    test('fresh LLM: the expected text, and the cache upsert carries the UNFOLDED split', async () => {
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
