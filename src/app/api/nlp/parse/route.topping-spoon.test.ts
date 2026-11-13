/**
 * /api/nlp/parse - a spoon after a dish named with its topping measures the topping, not the dish (S240, cloud-38 D4,
 * MGR 19:10Z). SegmentationCache-hit AND fresh-AI paths; a volume control (`2 cups`) still folds onto the host.
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
const OATMEAL = {
  text: 'oatmeal with peanut butter, 2 tbsp',
  split: [
    seg('oatmeal with peanut butter', 'oatmeal with peanut butter'),
    seg('peanut butter', 'peanut butter'),
    seg('2 tbsp', '2 tbsp'),
  ],
  expected: 'oatmeal with peanut butter',
};
const CONTROL = {
  text: 'pasta with marinara, 2 cups',
  split: [seg('pasta with marinara', 'pasta with marinara'), seg('marinara', 'marinara'), seg('2 cups', '2 cups')],
  expected: '2 cups of pasta with marinara',
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

describe('/api/nlp/parse topping-spoon fold', () => {
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
  const key = (text: string) => text;

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
    ['oatmeal with peanut butter, 2 tbsp (spoon: dropped)', OATMEAL],
    ['pasta with marinara, 2 cups (control: folds)', CONTROL],
  ])('%s', (_label, c) => {
    test('SegmentationCache HIT: the mapper is called once with the expected text', async () => {
      prisma.segmentationCache.findUnique.mockResolvedValue({
        lineKey: key(c.text),
        parserVersion: SEG_PARSER_VERSION,
        segmentsJson: c.split,
        hitCount: 3,
      });
      const response = await POST(parseRequest({ text: c.text }));
      expect(response.status).toBe(200);
      expect(callStructuredLlm).not.toHaveBeenCalled();
      expect(mapIngredientWithFallback).toHaveBeenCalledTimes(1);
      expect(calls().map(x => x.text)).toEqual([c.expected]);
    });

    test('fresh LLM: the mapper is called once, and the cache upsert carries the UNFOLDED split', async () => {
      llm(c.split);
      const response = await POST(parseRequest({ text: c.text }));
      expect(response.status).toBe(200);
      expect(mapIngredientWithFallback).toHaveBeenCalledTimes(1);
      expect(calls().map(x => x.text)).toEqual([c.expected]);
      expect(prisma.segmentationCache.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.segmentationCache.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ segmentsJson: c.split }),
        }),
      );
    });
  });
});
