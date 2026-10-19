/**
 * /api/nlp/parse - S240 (MGR 17:14Z b): a removed part the segmenter split off (`no sour cream or cheese`)
 * never reaches the mapper; the control line (`oatmeal with no sugar or 2 bananas`) keeps the numbered food.
 * Shipped route layer on the SegmentationCache-hit AND the fresh-AI path.
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
const seg = (rawText: string, normalizedForm: string): Seg => ({ rawText, mealType: 'lunch', brand: '', normalizedForm });

const BURRITO = {
  text: 'a chicken burrito with no sour cream or cheese',
  split: [seg('a chicken burrito', 'chicken burrito'), seg('sour cream', 'sour cream'), seg('cheese', 'cheddar cheese')],
  mapped: ['a chicken burrito'],
};
const CONTROL = {
  text: 'oatmeal with no sugar or 2 bananas',
  split: [seg('oatmeal', 'oatmeal'), seg('sugar', 'sugar'), seg('2 bananas', 'bananas')],
  mapped: ['oatmeal', '2 bananas'],
};

function parseRequest(body: object): NextRequest {
  return new NextRequest('http://localhost:3000/api/nlp/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': 'adminAPI_dev_key_bypass' },
    body: JSON.stringify(body),
  });
}

describe('/api/nlp/parse removed part split off by the segmenter', () => {
  const { prisma } = require('@/lib/db');
  const { callStructuredLlm } = require('@/lib/ai/structured-client');
  const { mapIngredientWithFallback } = require('@/lib/mapping/map-ingredient-with-fallback');
  const { logger } = require('@/lib/logger');
  let spies: jest.SpyInstance[] = [];

  const mapperCalls = (): string[] => mapIngredientWithFallback.mock.calls.map((c: unknown[]) => c[0] as string);

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
    ['burrito: no sour cream or cheese', BURRITO],
    ['control: oatmeal with no sugar or 2 bananas', CONTROL],
  ])('%s', (_name, line) => {
    test('SegmentationCache HIT', async () => {
      prisma.segmentationCache.findUnique.mockResolvedValue({
        lineKey: line.text,
        parserVersion: SEG_PARSER_VERSION,
        segmentsJson: line.split,
        hitCount: 3,
      });
      const response = await POST(parseRequest({ text: line.text }));
      expect(response.status).toBe(200);
      expect(callStructuredLlm).not.toHaveBeenCalled();
      expect(mapIngredientWithFallback).toHaveBeenCalledTimes(line.mapped.length);
      expect(mapperCalls()).toEqual(line.mapped);
    });

    test('fresh AI path', async () => {
      callStructuredLlm.mockResolvedValue({
        status: 'success',
        content: { items: line.split },
        provider: 'openrouter',
        model: 'openai/gpt-4o-mini',
      });
      const response = await POST(parseRequest({ text: line.text }));
      expect(response.status).toBe(200);
      expect(mapIngredientWithFallback).toHaveBeenCalledTimes(line.mapped.length);
      expect(mapperCalls()).toEqual(line.mapped);
    });
  });
});
