/**
 * /api/nlp/parse - a spoken self-correction bills the corrected value, not both.
 *
 * S202 row 4, 8(d) (seat C69), Diego's narrowed cut (2026-10-17). The SHIPPED route layer with the mapper
 * mocked: it records every rawText it is called with. The pass runs on the SegmentationCache-hit AND the
 * fresh-LLM path (the cache upsert keeps the UNCORRECTED split).
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

const PANCAKES = {
  text: 'four pancakes, wait no, three pancakes',
  key: 'four pancakes, wait no, three pancakes',
  split: [seg('four pancakes', 'pancakes'), seg('three pancakes', 'pancakes')],
};
const PLAIN = {
  text: 'eggs and toast, then later a banana',
  split: [seg('eggs', 'eggs'), seg('toast', 'toast'), seg('a banana', 'banana')],
};

function parseRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/nlp/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'adminAPI_dev_key_bypass' },
    body: JSON.stringify(body),
  });
}

describe('/api/nlp/parse self-correction', () => {
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

  test('SegmentationCache HIT: the corrected quantity is the ONLY pancake item the mapper sees', async () => {
    prisma.segmentationCache.findUnique.mockResolvedValue({
      lineKey: PANCAKES.key,
      parserVersion: SEG_PARSER_VERSION,
      segmentsJson: PANCAKES.split,
      hitCount: 3,
    });
    const response = await POST(parseRequest({ text: PANCAKES.text }));
    expect(response.status).toBe(200);
    expect(callStructuredLlm).not.toHaveBeenCalled();
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(1);
    expect(aiCalls()).toEqual(['3 pancakes']);
  });

  test('fresh LLM: same reading, and the cache upsert carries the UNCORRECTED split', async () => {
    llmReturns(PANCAKES.split);
    const response = await POST(parseRequest({ text: PANCAKES.text }));
    expect(response.status).toBe(200);
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(1);
    expect(aiCalls()).toEqual(['3 pancakes']);
    expect(prisma.segmentationCache.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.segmentationCache.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { lineKey_parserVersion: { lineKey: PANCAKES.key, parserVersion: SEG_PARSER_VERSION } },
        create: expect.objectContaining({ segmentsJson: PANCAKES.split }),
      }),
    );
  });

  test('the surviving item keeps its normalizedForm', async () => {
    llmReturns(PANCAKES.split);
    await POST(parseRequest({ text: PANCAKES.text }));
    expect(mapperNormalized()).toEqual(['pancakes']);
  });

  test('one logger line per correcting request: event, count and kinds - no user text', async () => {
    llmReturns(PANCAKES.split);
    await POST(parseRequest({ text: PANCAKES.text }));
    const lines = infoSpy.mock.calls.filter((c: unknown[]) => c[0] === 'nlp_parse.self_correction');
    expect(lines).toHaveLength(1);
    expect(lines[0][1]).toEqual({ count: 1, kinds: expect.any(Array) });
  });

  test('a line with no correction word is unchanged: three items reach the mapper, no correction line', async () => {
    llmReturns(PLAIN.split);
    await POST(parseRequest({ text: PLAIN.text }));
    expect(mapIngredientWithFallback).toHaveBeenCalledTimes(3);
    expect(infoSpy.mock.calls.filter((c: unknown[]) => c[0] === 'nlp_parse.self_correction')).toHaveLength(0);
  });
});
