/**
 * /api/nlp/parse - a protein shake dosed `with N scoops` bills N scoops of protein powder (S240, MGR 16:36Z).
 * SegmentationCache-hit AND fresh-AI paths; the cache upsert carries the UNFOLDED split; a control line is unchanged.
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
const AND = {
  text: 'a protein shake with 2 scoops and almond milk',
  split: [seg('a protein shake', 'protein shake'), seg('2 scoops', 'scoops'), seg('almond milk', 'almond milk')],
  expected: [
    { text: '2 scoops of protein powder', nf: 'protein powder' },
    { text: 'almond milk', nf: 'almond milk' },
  ] as Call[],
};
const IN = {
  text: 'a protein shake with two scoops in milk',
  split: [seg('a protein shake', 'protein shake'), seg('two scoops in milk', 'scoops in milk')],
  expected: [
    { text: '2 scoops of protein powder', nf: 'protein powder' },
    { text: 'milk', nf: 'milk' },
  ] as Call[],
};
const CONTROL = {
  text: 'a sundae with 3 scoops and hot fudge',
  split: [seg('a sundae', 'sundae'), seg('3 scoops', 'scoops'), seg('hot fudge', 'hot fudge')],
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

describe('/api/nlp/parse dose fold', () => {
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
    ['2 scoops and almond milk', AND],
    ['two scoops in milk', IN],
  ])('%s', (_label, c) => {
    test('SegmentationCache HIT: the mapper is called twice, powder first', async () => {
      prisma.segmentationCache.findUnique.mockResolvedValue({
        lineKey: key(c.text),
        parserVersion: SEG_PARSER_VERSION,
        segmentsJson: c.split,
        hitCount: 3,
      });
      const response = await POST(parseRequest({ text: c.text }));
      expect(response.status).toBe(200);
      expect(callStructuredLlm).not.toHaveBeenCalled();
      expect(mapIngredientWithFallback).toHaveBeenCalledTimes(2);
      expect(calls()).toEqual(expect.arrayContaining(c.expected));
      expect(calls()).toHaveLength(2);
    });

    test('fresh LLM: powder + liquid, and the cache upsert carries the UNFOLDED split', async () => {
      llm(c.split);
      const response = await POST(parseRequest({ text: c.text }));
      expect(response.status).toBe(200);
      expect(mapIngredientWithFallback).toHaveBeenCalledTimes(2);
      expect(calls()).toEqual(expect.arrayContaining(c.expected));
      expect(prisma.segmentationCache.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.segmentationCache.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ segmentsJson: c.split }),
        }),
      );
    });
  });

  test('control: a sundae with 3 scoops and hot fudge - three calls, unchanged', async () => {
    llm(CONTROL.split);
    const response = await POST(parseRequest({ text: CONTROL.text }));
    expect(response.status).toBe(200);
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(3);
    expect(calls().map(x => x.text).sort()).toEqual(['3 scoops', 'a sundae', 'hot fudge']);
  });
});
