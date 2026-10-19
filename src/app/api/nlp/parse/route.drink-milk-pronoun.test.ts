/**
 * /api/nlp/parse - `a latte and oat milk in it`: the pronoun object is the latte's own milk, not a second use.
 *
 * S240 (seat C69), cloud-36 C11. The SHIPPED route layer with the mapper mocked. Both the SegmentationCache-hit
 * AND the fresh-LLM path; the control (`for my cereal`) is a real second use and keeps both items.
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

const SPLIT = [seg('a latte', 'latte'), seg('oat milk', 'oat milk')];
const PRONOUN = { text: 'a latte and oat milk in it', key: 'a latte and oat milk in it' };
const CONTROL = { text: 'a latte and oat milk for my cereal', key: 'a latte and oat milk for my cereal' };

function parseRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/nlp/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'adminAPI_dev_key_bypass' },
    body: JSON.stringify(body),
  });
}

describe('/api/nlp/parse drink milk pronoun', () => {
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
  const cacheHit = (key: string) =>
    prisma.segmentationCache.findUnique.mockResolvedValue({
      lineKey: key,
      parserVersion: SEG_PARSER_VERSION,
      segmentsJson: SPLIT,
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

  test('SegmentationCache HIT: `in it` reaches the mapper once, as the latte', async () => {
    cacheHit(PRONOUN.key);
    const response = await POST(parseRequest({ text: PRONOUN.text }));
    expect(response.status).toBe(200);
    expect(callStructuredLlm).not.toHaveBeenCalled();
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(1);
    expect(aiCalls()).toEqual(['a latte']);
  });

  test('fresh LLM: `in it` reaches the mapper once, as the latte', async () => {
    llmReturns(SPLIT);
    const response = await POST(parseRequest({ text: PRONOUN.text }));
    expect(response.status).toBe(200);
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(1);
    expect(aiCalls()).toEqual(['a latte']);
  });

  test('control, cache hit: `for my cereal` is a second use - both items reach the mapper', async () => {
    cacheHit(CONTROL.key);
    await POST(parseRequest({ text: CONTROL.text }));
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(2);
  });

  test('control, fresh LLM: `for my cereal` is a second use - both items reach the mapper', async () => {
    llmReturns(SPLIT);
    await POST(parseRequest({ text: CONTROL.text }));
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(2);
  });
});
