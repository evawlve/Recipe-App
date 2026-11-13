/**
 * /api/nlp/parse - s453 C3P: a measured recipe bills its ingredients, not the dish (cache-hit path, mapper mocked).
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

const RICE = {
  text: 'fried rice with 2 cups leftover rice, 2 eggs, 1/2 cup frozen peas and carrots, 1 tbsp sesame oil',
  split: [
    seg('fried rice', 'fried rice'),
    seg('2 cups leftover rice', 'rice'),
    seg('2 eggs', 'eggs'),
    seg('1/2 cup frozen peas', 'frozen peas'),
    seg('1/2 cup carrots', 'carrots'),
    seg('1 tbsp sesame oil', 'sesame oil'),
  ],
};
const HOMEMADE = {
  text: 'homemade fried rice with 2 cups leftover rice, 2 eggs, 1/2 cup frozen peas and carrots, 1 tbsp sesame oil',
  split: [seg('homemade fried rice', 'fried rice'), ...RICE.split.slice(1)],
};

function parseRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/nlp/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'adminAPI_dev_key_bypass' },
    body: JSON.stringify(body),
  });
}

describe('/api/nlp/parse measured recipe head drop', () => {
  const { prisma } = require('@/lib/db');
  const { requestAiNutrition } = require('@/lib/mapping/ai-nutrition-backfill');
  const { logger } = require('@/lib/logger');
  let spies: jest.SpyInstance[] = [];
  let infoSpy: jest.SpyInstance;

  const aiCalls = (): string[] => requestAiNutrition.mock.calls.map((c: unknown[]) => c[0] as string);
  const dropLines = () =>
    infoSpy.mock.calls.filter((c: unknown[]) => c[0] === 'nlp_parse.measured_recipe_head_drop');
  const cacheHit = (text: string, split: Seg[]) =>
    prisma.segmentationCache.findUnique.mockResolvedValue({
      lineKey: text,
      parserVersion: SEG_PARSER_VERSION,
      segmentsJson: split,
      hitCount: 3,
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

  test('H13.d1: the mapper sees the five ingredients, not the dish; one log line { count: 1 }', async () => {
    cacheHit(RICE.text, RICE.split);
    const response = await POST(parseRequest({ text: RICE.text }));
    expect(response.status).toBe(200);
    expect(aiCalls()).toEqual(RICE.split.slice(1).map(s => s.rawText));
    expect(dropLines()).toHaveLength(1);
    expect(dropLines()[0][1]).toEqual({ count: 1 });
  });

  test('H13.homemade-ctl: a homemade marker keeps the dish, no such log line', async () => {
    cacheHit(HOMEMADE.text, HOMEMADE.split);
    const response = await POST(parseRequest({ text: HOMEMADE.text }));
    expect(response.status).toBe(200);
    expect(aiCalls()[0]).toBe('homemade fried rice'); // the shipped dish-part pass owns the rest
    expect(dropLines()).toHaveLength(0);
  });
});
