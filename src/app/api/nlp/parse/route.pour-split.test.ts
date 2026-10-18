/**
 * /api/nlp/parse - a pour onto a second food is two foods.
 *
 * S202 (cloud-35 F9, seat C69). `a splash of syrup on pancakes` is 6 words with no separator, so the short-line
 * fast path used to answer it as ONE item and the pancakes vanished. isPourOntoSecondFood() now sends it to the
 * segmenter; restoreLeadingPour() puts the line's own `a splash of` back on the liquid. Same harness as
 * route.drink-milk.test.ts: prisma / structured-client / mapper mocked, the mapper records every rawText.
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

const LINE = 'a splash of syrup on pancakes';
// The segmenter lost the pour count and put the foods in the other order (the refuter's observed draw).
const LOST_COUNT_SPLIT = [seg('pancakes', 'pancakes'), seg('syrup', 'syrup')];

function parseRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/nlp/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'adminAPI_dev_key_bypass' },
    body: JSON.stringify(body),
  });
}

describe('/api/nlp/parse pour onto a second food', () => {
  const { prisma } = require('@/lib/db');
  const { callStructuredLlm } = require('@/lib/ai/structured-client');
  const { mapIngredientWithFallback } = require('@/lib/mapping/map-ingredient-with-fallback');
  const { logger } = require('@/lib/logger');
  let spies: jest.SpyInstance[] = [];

  const mapperRawTexts = (): string[] => mapIngredientWithFallback.mock.calls.map((c: unknown[]) => c[0] as string);
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

  test('the segmenter is reached (the fast path would not call it)', async () => {
    llmReturns(LOST_COUNT_SPLIT);
    const response = await POST(parseRequest({ text: LINE }));
    expect(response.status).toBe(200);
    expect(callStructuredLlm).toHaveBeenCalled();
  });

  test('fresh split [pancakes, syrup]: the mapper receives pancakes and `a splash of syrup`', async () => {
    llmReturns(LOST_COUNT_SPLIT);
    await POST(parseRequest({ text: LINE }));
    expect(mapperRawTexts().slice().sort()).toEqual(['a splash of syrup', 'pancakes']);
  });

  test('SegmentationCache HIT holding [pancakes, syrup]: the same two reach the mapper, the LLM is NOT called', async () => {
    prisma.segmentationCache.findUnique.mockResolvedValue({
      lineKey: LINE,
      parserVersion: SEG_PARSER_VERSION,
      segmentsJson: LOST_COUNT_SPLIT,
      hitCount: 1,
    });
    const response = await POST(parseRequest({ text: LINE }));
    expect(response.status).toBe(200);
    expect(callStructuredLlm).not.toHaveBeenCalled();
    expect(mapperRawTexts().slice().sort()).toEqual(['a splash of syrup', 'pancakes']);
  });

  test('control: `a splash of milk` is one item and the LLM is not called', async () => {
    const response = await POST(parseRequest({ text: 'a splash of milk' }));
    expect(response.status).toBe(200);
    expect(callStructuredLlm).not.toHaveBeenCalled();
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(1);
  });
});
