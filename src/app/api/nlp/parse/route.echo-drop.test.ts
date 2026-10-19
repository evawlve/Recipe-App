/**
 * /api/nlp/parse - a `with` part the host already names is not billed twice.
 *
 * S202 (30)(i) (seat C69 S240). The SHIPPED route layer with the mapper mocked: it records every rawText it is
 * called with. The pass runs on the SegmentationCache-hit AND the fresh-LLM path (the cache upsert keeps the
 * UNDROPPED split).
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

const SALAD = {
  text: 'salad with chicken',
  key: 'salad with chicken',
  split: [seg('salad with chicken', 'salad with chicken'), seg('chicken', 'chicken')],
};
const COFFEE = {
  text: 'coffee with milk',
  split: [seg('coffee with milk', 'coffee'), seg('milk', 'milk')],
};
const PASTA = {
  text: 'pasta with marinara, 2 cups',
  split: [seg('pasta with marinara', 'pasta with marinara'), seg('marinara', 'marinara'), seg('2 cups', '')],
};

function parseRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/nlp/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'adminAPI_dev_key_bypass' },
    body: JSON.stringify(body),
  });
}

describe('/api/nlp/parse segmenter echo drop', () => {
  const { prisma } = require('@/lib/db');
  const { callStructuredLlm } = require('@/lib/ai/structured-client');
  const { requestAiNutrition } = require('@/lib/mapping/ai-nutrition-backfill');
  const { mapIngredientWithFallback } = require('@/lib/mapping/map-ingredient-with-fallback');
  const { logger } = require('@/lib/logger');
  let spies: jest.SpyInstance[] = [];
  let infoSpy: jest.SpyInstance;

  const aiCalls = (): string[] => requestAiNutrition.mock.calls.map((c: unknown[]) => c[0] as string);
  const llmReturns = (items: Seg[]) =>
    callStructuredLlm.mockResolvedValue({
      status: 'success',
      content: { items },
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
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

  test('SegmentationCache HIT: the salad and its echoed chicken reach the mapper as ONE item', async () => {
    prisma.segmentationCache.findUnique.mockResolvedValue({
      lineKey: SALAD.key,
      parserVersion: SEG_PARSER_VERSION,
      segmentsJson: SALAD.split,
      hitCount: 3,
    });
    const response = await POST(parseRequest({ text: SALAD.text }));
    expect(response.status).toBe(200);
    expect(callStructuredLlm).not.toHaveBeenCalled();
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(1);
    expect(aiCalls()).toEqual(['salad with chicken']);
  });

  test('fresh LLM: same reading, and the cache upsert carries the UNDROPPED split', async () => {
    llmReturns(SALAD.split);
    const response = await POST(parseRequest({ text: SALAD.text }));
    expect(response.status).toBe(200);
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(1);
    expect(aiCalls()).toEqual(['salad with chicken']);
    expect(prisma.segmentationCache.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.segmentationCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { lineKey_parserVersion: { lineKey: SALAD.key, parserVersion: SEG_PARSER_VERSION } },
        create: expect.objectContaining({ segmentsJson: SALAD.split }),
      }),
    );
    expect(infoSpy.mock.calls.filter((c: unknown[]) => c[0] === 'nlp_parse.segmenter_echo_drop')).toHaveLength(1);
  });

  test('"coffee with milk" (host identity excludes the milk): both items still reach the mapper', async () => {
    llmReturns(COFFEE.split);
    await POST(parseRequest({ text: COFFEE.text }));
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(2);
    expect(infoSpy.mock.calls.filter((c: unknown[]) => c[0] === 'nlp_parse.segmenter_echo_drop')).toHaveLength(0);
  });

  test('ORDER PIN: the echo goes before the trailing-quantity fold, so "2 cups" joins the host', async () => {
    llmReturns(PASTA.split);
    await POST(parseRequest({ text: PASTA.text }));
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(1);
    expect(aiCalls()).toEqual(['2 cups of pasta with marinara']);
  });
});
