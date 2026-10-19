/**
 * /api/nlp/parse - a `no` before a bare negated part is not a swap (the host stays).
 *
 * S240 (seat C69), lone-no row. The SHIPPED route layer with the mapper mocked: it records every rawText it is
 * called with. The pass runs on the SegmentationCache-hit AND the fresh-LLM path.
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
  mapIngredientWithFallback: jest.fn(async (rawText: string) => {
    const { requestAiNutrition } = require('@/lib/mapping/ai-nutrition-backfill');
    await requestAiNutrition(rawText);
    return { status: 'no_match' };
  }),
}));

jest.mock('@/lib/nlp/resolve-payload', () => ({
  resolveFoodDetails: jest.fn(),
}));

type Seg = { rawText: string; mealType: string; brand: string; normalizedForm: string };
const seg = (rawText: string, normalizedForm = ''): Seg => ({ rawText, mealType: 'lunch', brand: '', normalizedForm });

const PIZZA = {
  text: 'pizza, no anchovies',
  split: [seg('pizza', 'pizza'), seg('anchovies', 'anchovies')],
};
const COFFEE = {
  text: 'a coffee, no, a tea',
  split: [seg('a coffee', 'coffee'), seg('a tea', 'tea')],
};

function parseRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/nlp/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'adminAPI_dev_key_bypass' },
    body: JSON.stringify(body),
  });
}

describe('/api/nlp/parse lone no', () => {
  const { prisma } = require('@/lib/db');
  const { callStructuredLlm } = require('@/lib/ai/structured-client');
  const { requestAiNutrition } = require('@/lib/mapping/ai-nutrition-backfill');
  const { mapIngredientWithFallback } = require('@/lib/mapping/map-ingredient-with-fallback');
  const { logger } = require('@/lib/logger');
  let spies: jest.SpyInstance[] = [];

  const aiCalls = (): string[] => requestAiNutrition.mock.calls.map((c: unknown[]) => c[0] as string);
  const llmReturns = (items: Seg[]) =>
    callStructuredLlm.mockResolvedValue({
      status: 'success',
      content: { items },
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
    });
  const cacheHit = (text: string, items: Seg[]) =>
    prisma.segmentationCache.findUnique.mockResolvedValue({
      lineKey: text,
      parserVersion: SEG_PARSER_VERSION,
      segmentsJson: items,
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

  describe.each([
    ['SegmentationCache HIT', true],
    ['fresh LLM', false],
  ] as const)('%s', (_label, hit) => {
    const arm = (c: { text: string; split: Seg[] }) => {
      if (hit) cacheHit(c.text, c.split);
      else llmReturns(c.split);
    };

    test('`pizza, no anchovies` keeps the host: both reach the mapper (the removal is the next PR)', async () => {
      arm(PIZZA);
      const response = await POST(parseRequest({ text: PIZZA.text }));
      expect(response.status).toBe(200);
      if (hit) expect(callStructuredLlm).not.toHaveBeenCalled();
      expect(mapIngredientWithFallback).toHaveBeenCalledTimes(2);
      expect(aiCalls()).toEqual(['pizza', 'anchovies']);
    });

    test('control: `a coffee, no, a tea` still swaps: the mapper is called once with `a tea`', async () => {
      arm(COFFEE);
      const response = await POST(parseRequest({ text: COFFEE.text }));
      expect(response.status).toBe(200);
      expect(mapIngredientWithFallback).toHaveBeenCalledTimes(1);
      expect(aiCalls()).toEqual(['a tea']);
    });
  });
});
