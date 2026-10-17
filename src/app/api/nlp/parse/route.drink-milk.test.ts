/**
 * /api/nlp/parse - a drink named with its milk bills the drink, not the drink and the milk.
 *
 * S202 row 3, 8(e) (seat C69), Diego's Option A (2026-10-17). The SHIPPED route layer with the mapper
 * mocked: it records every rawText it is called with. The pass runs on the SegmentationCache-hit AND the
 * fresh-LLM path (the cache upsert keeps the UNFOLDED split).
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

const LATTE = {
  text: 'a matcha latte with almond milk',
  key: 'a matcha latte with almond milk',
  split: [seg('a matcha latte', 'matcha latte'), seg('almond milk', 'almond milk')],
};
const COFFEE = {
  text: 'coffee with milk',
  split: [seg('coffee', 'coffee'), seg('milk', 'milk')],
};

function parseRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/nlp/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'adminAPI_dev_key_bypass' },
    body: JSON.stringify(body),
  });
}

describe('/api/nlp/parse drink milk fold', () => {
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

  const mapperNormalized = (): Array<string | undefined> =>
    mapIngredientWithFallback.mock.calls.map((c: unknown[]) => (c[1] as { normalizedForm?: string }).normalizedForm);

  test('SegmentationCache HIT: the latte and its milk reach the mapper as ONE item', async () => {
    prisma.segmentationCache.findUnique.mockResolvedValue({
      lineKey: LATTE.key,
      parserVersion: SEG_PARSER_VERSION,
      segmentsJson: LATTE.split,
      hitCount: 3,
    });
    const response = await POST(parseRequest({ text: LATTE.text }));
    expect(response.status).toBe(200);
    expect(callStructuredLlm).not.toHaveBeenCalled();
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(1);
    expect(aiCalls()).toEqual(['a matcha latte with almond milk']);
  });

  test('fresh LLM: same reading, and the cache upsert carries the UNFOLDED split', async () => {
    llmReturns(LATTE.split);
    const response = await POST(parseRequest({ text: LATTE.text }));
    expect(response.status).toBe(200);
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(1);
    expect(aiCalls()).toEqual(['a matcha latte with almond milk']);
    expect(prisma.segmentationCache.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.segmentationCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { lineKey_parserVersion: { lineKey: LATTE.key, parserVersion: SEG_PARSER_VERSION } },
        create: expect.objectContaining({ segmentsJson: LATTE.split }),
      }),
    );
  });

  test('the folded item carries the milk in its normalizedForm', async () => {
    llmReturns(LATTE.split);
    await POST(parseRequest({ text: LATTE.text }));
    expect(mapperNormalized()).toContain('matcha latte almond milk');
  });

  test('one logger line per folding request: event and count only - no user text', async () => {
    llmReturns(LATTE.split);
    await POST(parseRequest({ text: LATTE.text }));
    const lines = infoSpy.mock.calls.filter((c: unknown[]) => c[0] === 'nlp_parse.drink_milk_fold');
    expect(lines).toHaveLength(1);
    expect(lines[0][1]).toEqual({ count: 1 });
  });

  test('"coffee with milk" is not a milk-bearing drink: both items still reach the mapper, no fold line', async () => {
    llmReturns(COFFEE.split);
    await POST(parseRequest({ text: COFFEE.text }));
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(2);
    expect(infoSpy.mock.calls.filter((c: unknown[]) => c[0] === 'nlp_parse.drink_milk_fold')).toHaveLength(0);
  });
});
