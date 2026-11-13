/**
 * /api/nlp/parse - s455 DS1: a stuttered modifier bills the sugar-free food, not a phantom sugar (cache-hit path, mapper mocked).
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
const LINE = "five chocolate rice cakes one oikos triple 0 yogurt 200 g of mixed berries 1 tablespoon of sugar sugar-free maple syrup";
const SPLIT: Seg[] = [
  {
    "brand": "",
    "rawText": "Five chocolate rice cakes",
    "mealType": "snacks",
    "normalizedForm": "chocolate rice cakes"
  },
  {
    "brand": "oikos",
    "rawText": "one oikos triple 0 yogurt",
    "mealType": "snacks",
    "normalizedForm": "triple 0 yogurt"
  },
  {
    "brand": "",
    "rawText": "200 g of mixed berries",
    "mealType": "snacks",
    "normalizedForm": "mixed berries"
  },
  {
    "brand": "",
    "rawText": "1 tablespoon of sugar",
    "mealType": "snacks",
    "normalizedForm": "sugar"
  },
  {
    "brand": "",
    "rawText": "sugar-free maple syrup",
    "mealType": "snacks",
    "normalizedForm": "sugar-free maple syrup"
  }
];

function parseRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/nlp/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'adminAPI_dev_key_bypass' },
    body: JSON.stringify(body),
  });
}

describe('/api/nlp/parse modifier stutter fold', () => {
  const { prisma } = require('@/lib/db');
  const { requestAiNutrition } = require('@/lib/mapping/ai-nutrition-backfill');
  const { logger } = require('@/lib/logger');
  let spies: jest.SpyInstance[] = [];
  let infoSpy: jest.SpyInstance;

  const aiCalls = (): string[] => requestAiNutrition.mock.calls.map((c: unknown[]) => c[0] as string);
  const foldLines = () => infoSpy.mock.calls.filter((c: unknown[]) => c[0] === 'nlp_parse.modifier_stutter_fold');
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

  test('sc392: the mapper sees "1 tablespoon of sugar-free maple syrup" and never "1 tablespoon of sugar"; one log line { count: 1 }', async () => {
    cacheHit(LINE, SPLIT);
    const response = await POST(parseRequest({ text: LINE }));
    expect(response.status).toBe(200);
    expect(aiCalls()).toContain('1 tablespoon of sugar-free maple syrup');
    expect(aiCalls()).not.toContain('1 tablespoon of sugar');
    expect(aiCalls()).toHaveLength(4);
    expect(foldLines()).toHaveLength(1);
    expect(foldLines()[0][1]).toEqual({ count: 1 });
  });
});
