/**
 * /api/nlp/parse - a split-off `double meat` reads as the host's protein.
 *
 * S240 (seat C69), MGR 17:30Z relay 1. The SHIPPED route layer with the mapper mocked: it records every
 * (rawText, opts.normalizedForm) it is called with. The pass runs on the SegmentationCache-hit AND the fresh-LLM path.
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
  mapIngredientWithFallback: jest.fn(async () => ({ status: 'no_match' })),
}));

jest.mock('@/lib/nlp/resolve-payload', () => ({
  resolveFoodDetails: jest.fn(),
}));

type Seg = { rawText: string; mealType: string; brand: string; normalizedForm: string };
const seg = (rawText: string, normalizedForm = ''): Seg => ({ rawText, mealType: 'lunch', brand: '', normalizedForm });

const TURKEY = {
  text: 'a turkey sub with double meat',
  split: [seg('a turkey sub', 'turkey sub'), seg('double meat', 'double meat')],
};
const TURKEY_TWO = {
  text: 'a turkey sub, two of them, with double meat',
  split: [seg('a turkey sub', 'turkey sub'), seg('two of them', 'two of them'), seg('double meat', 'double meat')],
};
const BURGER = {
  text: 'a burger with extra cheese',
  split: [seg('a burger', 'burger'), seg('extra cheese', 'extra cheese')],
};

function parseRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/nlp/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'adminAPI_dev_key_bypass' },
    body: JSON.stringify(body),
  });
}

describe('/api/nlp/parse extra portion', () => {
  const { prisma } = require('@/lib/db');
  const { callStructuredLlm } = require('@/lib/ai/structured-client');
  const { mapIngredientWithFallback } = require('@/lib/mapping/map-ingredient-with-fallback');
  const { logger } = require('@/lib/logger');
  let spies: jest.SpyInstance[] = [];

  const calls = (): Array<[string, string | undefined]> =>
    mapIngredientWithFallback.mock.calls.map((c: unknown[]) => [
      c[0] as string,
      (c[1] as { normalizedForm?: string } | undefined)?.normalizedForm,
    ]);
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

  test('SegmentationCache HIT: "double meat" reaches the mapper as the turkey', async () => {
    cacheHit(TURKEY.text, TURKEY.split);
    const response = await POST(parseRequest({ text: TURKEY.text }));
    expect(response.status).toBe(200);
    expect(callStructuredLlm).not.toHaveBeenCalled();
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(2);
    expect(calls()).toEqual([
      ['a turkey sub', 'turkey sub'],
      ['double meat', 'turkey'],
    ]);
  });

  test('fresh LLM: same reading', async () => {
    llmReturns(TURKEY.split);
    const response = await POST(parseRequest({ text: TURKEY.text }));
    expect(response.status).toBe(200);
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(2);
    expect(calls()).toEqual([
      ['a turkey sub', 'turkey sub'],
      ['double meat', 'turkey'],
    ]);
  });

  test('SegmentationCache HIT: with a quantity item between, the calls include "2 turkey sub" and double meat as turkey', async () => {
    cacheHit(TURKEY_TWO.text, TURKEY_TWO.split);
    await POST(parseRequest({ text: TURKEY_TWO.text }));
    expect(calls()).toEqual(expect.arrayContaining([['2 turkey sub', expect.anything()], ['double meat', 'turkey']]));
    expect(calls().map(c => c[0])).toContain('2 turkey sub');
  });

  test('fresh LLM: with a quantity item between, same reading', async () => {
    llmReturns(TURKEY_TWO.split);
    await POST(parseRequest({ text: TURKEY_TWO.text }));
    expect(calls().map(c => c[0])).toContain('2 turkey sub');
    expect(calls()).toEqual(expect.arrayContaining([['double meat', 'turkey']]));
  });

  test('control: "extra cheese" is untouched on the cache-hit path', async () => {
    cacheHit(BURGER.text, BURGER.split);
    await POST(parseRequest({ text: BURGER.text }));
    expect(calls()).toEqual(expect.arrayContaining([['extra cheese', 'extra cheese']]));
  });

  test('control: "extra cheese" is untouched on the fresh-LLM path', async () => {
    llmReturns(BURGER.split);
    await POST(parseRequest({ text: BURGER.text }));
    expect(calls()).toEqual(expect.arrayContaining([['extra cheese', 'extra cheese']]));
  });
});
